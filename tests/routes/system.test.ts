import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app.js';
import { recordHostStats } from '../../src/server/db/hostStatsRepo.js';
import { createUser } from '../../src/server/db/users.js';
import { isNewerVersion, readDisplayMode } from '../../src/server/routes/system.js';

let app: FastifyInstance;
let dataDir: string;
let adminCookies: Record<string, string>;
let viewerCookies: Record<string, string>;

async function login(username: string, password: string): Promise<Record<string, string>> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  const c = res.cookies.find((x) => x.name === 'session')!;
  return { [c.name]: c.value };
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ktdash-'));
  app = await buildApp({
    dataDir, version: '1.2.3', updateTimeoutMs: 300, rebootRequiredPath: join(dataDir, 'no-reboot-required'),
  });
  await createUser(app.ctx.db, { username: 'admin', displayName: 'Admin', password: 'hunter22', role: 'admin' });
  await createUser(app.ctx.db, { username: 'view', displayName: 'View', password: 'hunter22', role: 'viewer' });
  adminCookies = await login('admin', 'hunter22');
  viewerCookies = await login('view', 'hunter22');
});
afterEach(async () => { await app.close(); });

/** A local stand-in for the GitHub releases API / the Watchtower HTTP API. */
async function fakeServer(setup: (f: FastifyInstance) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const f = Fastify();
  setup(f);
  await f.listen({ port: 0, host: '127.0.0.1' });
  const address = f.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => f.close() };
}

describe('isNewerVersion', () => {
  it('compares numerically per segment, not as strings', () => {
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true);
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
  });
});

describe('GET /api/system/version', () => {
  it('requires auth, answers viewers, and echoes the boot version', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/system/version' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/api/system/version', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: '1.2.3' });
  });
});

describe('POST /api/system/update-check', () => {
  it('reports a newer release with a constructed notes URL, skipping prerelease tags', async () => {
    const fake = await fakeServer((f) => {
      f.get('/repos/:owner/:repo/releases', async () => [
        { tag_name: 'v2.0.0-rc.1' }, // prerelease — skipped
        { tag_name: 'v1.4.0', draft: true }, // draft — skipped
        { tag_name: 'v1.3.0' },
        { tag_name: 'v1.2.3' },
      ]);
    });
    app.ctx.settings.set('updateCheckBaseUrl', fake.url);
    app.ctx.settings.set('updateCheckWebUrl', 'https://example.test');
    app.ctx.settings.set('updateCheckProjectPath', 'me/proj');

    const res = await app.inject({
      method: 'POST', url: '/api/system/update-check', cookies: adminCookies, payload: {},
    });
    expect(res.json()).toEqual({
      ok: true,
      current: '1.2.3',
      latest: '1.3.0',
      updateAvailable: true,
      notesUrl: 'https://example.test/me/proj/releases/tag/v1.3.0',
    });
    await fake.close();
  });

  it('reports up-to-date when the newest release matches the running version', async () => {
    const fake = await fakeServer((f) => {
      f.get('/repos/:owner/:repo/releases', async () => [{ tag_name: 'v1.2.3' }]);
    });
    app.ctx.settings.set('updateCheckBaseUrl', fake.url);
    const res = await app.inject({
      method: 'POST', url: '/api/system/update-check', cookies: adminCookies, payload: {},
    });
    expect(res.json()).toMatchObject({ ok: true, updateAvailable: false });
    await fake.close();
  });

  it('degrades gracefully on upstream errors, empty feeds, and timeouts', async () => {
    const erroring = await fakeServer((f) => {
      f.get('/repos/:owner/:repo/releases', async (_req, reply) => reply.code(500).send({}));
    });
    app.ctx.settings.set('updateCheckBaseUrl', erroring.url);
    let res = await app.inject({ method: 'POST', url: '/api/system/update-check', cookies: adminCookies, payload: {} });
    expect(res.json()).toMatchObject({ ok: false, current: '1.2.3' });
    await erroring.close();

    const empty = await fakeServer((f) => {
      f.get('/repos/:owner/:repo/releases', async () => []);
    });
    app.ctx.settings.set('updateCheckBaseUrl', empty.url);
    res = await app.inject({ method: 'POST', url: '/api/system/update-check', cookies: adminCookies, payload: {} });
    expect(res.json()).toMatchObject({ ok: false, message: expect.stringContaining('No releases') });
    await empty.close();

    const sleeping = await fakeServer((f) => {
      f.get('/repos/:owner/:repo/releases', async () => new Promise(() => {})); // never answers
    });
    app.ctx.settings.set('updateCheckBaseUrl', sleeping.url);
    res = await app.inject({ method: 'POST', url: '/api/system/update-check', cookies: adminCookies, payload: {} });
    expect(res.json()).toMatchObject({ ok: false });
    await sleeping.close();
  });

  it('is admin-only', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/system/update-check', cookies: viewerCookies, payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/system/update', () => {
  it('409s until an update mode is configured', async () => {
    let res = await app.inject({ method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(409);

    app.ctx.settings.set('updates', { mode: 'off' });
    res = await app.inject({ method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(409);
  });

  it('native mode writes the trigger file with the requested version (or latest)', async () => {
    app.ctx.settings.set('updates', { mode: 'native' });
    let res = await app.inject({ method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json().mode).toBe('native');
    const trigger = join(dataDir, 'update-requested');
    expect(readFileSync(trigger, 'utf8')).toBe('latest');

    res = await app.inject({
      method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: { version: '2.0.0' },
    });
    expect(res.statusCode).toBe(202);
    expect(readFileSync(trigger, 'utf8')).toBe('2.0.0');
  });

  it('rejects a malformed version string before anything touches disk', async () => {
    app.ctx.settings.set('updates', { mode: 'native' });
    const res = await app.inject({
      method: 'POST', url: '/api/system/update', cookies: adminCookies,
      payload: { version: '2.0.0; rm -rf /' },
    });
    expect(res.statusCode).toBe(400);
    expect(existsSync(join(dataDir, 'update-requested'))).toBe(false);
  });

  it('watchtower mode posts the bearer token; a fast 2xx and a TIMEOUT both count as accepted', async () => {
    const seen: string[] = [];
    const fake = await fakeServer((f) => {
      f.post('/v1/update', async (req) => {
        seen.push(req.headers.authorization ?? '');
        return {};
      });
    });
    app.ctx.settings.set('updates', {
      mode: 'watchtower', watchtowerUrl: fake.url, watchtowerToken: 'sekrit',
    });
    let res = await app.inject({ method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json().mode).toBe('watchtower');
    expect(seen).toEqual(['Bearer sekrit']);
    await fake.close();

    // Sleeping watchtower = it's busy pulling and recreating THIS container — the
    // abort must be treated as acceptance, not failure.
    const sleeping = await fakeServer((f) => {
      f.post('/v1/update', async () => new Promise(() => {}));
    });
    app.ctx.settings.set('updates', {
      mode: 'watchtower', watchtowerUrl: sleeping.url, watchtowerToken: 'sekrit',
    });
    res = await app.inject({ method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(202);
    await sleeping.close();
  });

  it('surfaces a rejected token and an unreachable watchtower as upstream failures', async () => {
    const rejecting = await fakeServer((f) => {
      f.post('/v1/update', async (_req, reply) => reply.code(401).send({}));
    });
    app.ctx.settings.set('updates', {
      mode: 'watchtower', watchtowerUrl: rejecting.url, watchtowerToken: 'wrong',
    });
    let res = await app.inject({ method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toContain('token');
    await rejecting.close();

    app.ctx.settings.set('updates', {
      mode: 'watchtower', watchtowerUrl: 'http://127.0.0.1:1', watchtowerToken: 'x',
    });
    res = await app.inject({ method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(502);
  });

  it('watchtower mode without url/token is a validation error', async () => {
    app.ctx.settings.set('updates', { mode: 'watchtower' });
    const res = await app.inject({ method: 'POST', url: '/api/system/update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/system/stats', () => {
  it('requires auth and answers viewers with the full deterministic shape', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/system/stats' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/api/system/stats', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cpu.cores).toBeGreaterThan(0);
    expect(body.memory.totalBytes).toBeGreaterThan(0);
    expect(body.disk).not.toBeNull(); // dataDir is a real tmp dir on a real volume
    expect(body.uptimeSec).toBeGreaterThan(0);
    expect(body.rebootRequired).toBe(false); // no /var/run/reboot-required on dev/CI
    expect(body.osManaged).toBe(false); // updates unset
    // vcgencmd is absent on dev Macs and CI runners — nulls, never errors.
    if (process.platform !== 'linux') {
      expect(body.throttle).toBeNull();
      expect(body.watts).toBeNull();
    }
  });

  it('flips osManaged with the updates mode', async () => {
    app.ctx.settings.set('updates', { mode: 'native' });
    const res = await app.inject({ method: 'GET', url: '/api/system/stats', cookies: viewerCookies });
    expect(res.json().osManaged).toBe(true);
  });

  it('warns about undervoltage exactly once per process', async () => {
    await app.close();
    app = await buildApp({
      dataDir,
      version: '1.2.3',
      readThrottle: async () => ({
        undervoltedNow: false, freqCappedNow: false, throttledNow: false,
        undervoltedSinceBoot: true, freqCappedSinceBoot: false, throttledSinceBoot: false,
      }),
    });
    adminCookies = await login('admin', 'hunter22');
    await app.inject({ method: 'GET', url: '/api/system/stats', cookies: adminCookies });
    await app.inject({ method: 'GET', url: '/api/system/stats', cookies: adminCookies });
    const warns = app.ctx.db.prepare(
      "SELECT COUNT(*) c FROM logs WHERE level = 'warn' AND message LIKE 'Undervoltage%'",
    ).get() as { c: number };
    expect(warns.c).toBe(1);
    // And the flags surface to the client.
    const res = await app.inject({ method: 'GET', url: '/api/system/stats', cookies: adminCookies });
    expect(res.json().throttle.undervoltedSinceBoot).toBe(true);
  });
});

describe('GET /api/system/urls', () => {
  it('is admin-only and echoes the configured port', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/system/urls', cookies: viewerCookies })).statusCode).toBe(403);
    await app.close();
    app = await buildApp({ dataDir, version: '1.2.3', port: 8123 });
    adminCookies = await login('admin', 'hunter22');
    const res = await app.inject({ method: 'GET', url: '/api/system/urls', cookies: adminCookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.port).toBe(8123);
    expect(typeof body.hostname).toBe('string');
    expect(Array.isArray(body.addresses)).toBe(true);
    // 'unknown' on bare-metal dev machines, 'docker' when the suite itself runs in a
    // container (the CI runner does — /.dockerenv exists there). Never 'native'
    // without the env var, which the next test covers deterministically.
    expect(['unknown', 'docker']).toContain(body.install);
  });

  it("reports install 'native' when KEGWALL_INSTALL=native (set by the Pi installer's unit)", async () => {
    process.env.KEGWALL_INSTALL = 'native';
    try {
      const res = await app.inject({ method: 'GET', url: '/api/system/urls', cookies: adminCookies });
      expect(res.json().install).toBe('native');
    } finally {
      delete process.env.KEGWALL_INSTALL;
    }
  });

  it("reports displayMode 'none' with no kiosk marker present", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/urls', cookies: adminCookies });
    expect(res.json().displayMode).toBe('none');
  });

  it('reports the display mode the kiosk installer stamped into the marker file', async () => {
    const marker = join(dataDir, 'display-mode');
    process.env.KEGWALL_DISPLAY_MODE_MARKER = marker;
    try {
      writeFileSync(marker, 'native\n');
      expect((await app.inject({ method: 'GET', url: '/api/system/urls', cookies: adminCookies })).json().displayMode).toBe('native');
      writeFileSync(marker, 'chromium\n');
      expect((await app.inject({ method: 'GET', url: '/api/system/urls', cookies: adminCookies })).json().displayMode).toBe('chromium');
    } finally {
      delete process.env.KEGWALL_DISPLAY_MODE_MARKER;
    }
  });
});

describe('readDisplayMode', () => {
  it('returns none for a missing marker, and ignores a garbage value', () => {
    process.env.KEGWALL_DISPLAY_MODE_MARKER = join(dataDir, 'does-not-exist');
    try {
      expect(readDisplayMode()).toBe('none');
      const marker = join(dataDir, 'display-mode-garbage');
      process.env.KEGWALL_DISPLAY_MODE_MARKER = marker;
      writeFileSync(marker, 'weston\n');
      expect(readDisplayMode()).toBe('none');
    } finally {
      delete process.env.KEGWALL_DISPLAY_MODE_MARKER;
    }
  });
});

describe('POST /api/system/os-update', () => {
  it('409s unless updates mode is native AND osUpdates is enabled', async () => {
    // updates unset entirely
    let res = await app.inject({ method: 'POST', url: '/api/system/os-update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('native');

    // watchtower is not native
    app.ctx.settings.set('updates', { mode: 'watchtower', watchtowerUrl: 'http://127.0.0.1:1', watchtowerToken: 'x' });
    res = await app.inject({ method: 'POST', url: '/api/system/os-update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(409);

    // native but osUpdates off/unset
    app.ctx.settings.set('updates', { mode: 'native' });
    res = await app.inject({ method: 'POST', url: '/api/system/os-update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('Settings');
    app.ctx.settings.set('osUpdates', { mode: 'off', autoReboot: false });
    res = await app.inject({ method: 'POST', url: '/api/system/os-update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(409);
  });

  it("writes 'run' or 'run-reboot' per the autoReboot setting", async () => {
    app.ctx.settings.set('updates', { mode: 'native' });
    app.ctx.settings.set('osUpdates', { mode: 'manual', autoReboot: false });
    let res = await app.inject({ method: 'POST', url: '/api/system/os-update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(readFileSync(join(dataDir, 'os-update-requested'), 'utf8')).toBe('run');

    app.ctx.settings.set('osUpdates', { mode: 'auto', autoReboot: true });
    res = await app.inject({ method: 'POST', url: '/api/system/os-update', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(readFileSync(join(dataDir, 'os-update-requested'), 'utf8')).toBe('run-reboot');
  });

  it('is admin-only', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/system/os-update', cookies: viewerCookies, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/system/reboot', () => {
  it('409s outside native mode and writes the reboot trigger inside it', async () => {
    let res = await app.inject({ method: 'POST', url: '/api/system/reboot', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(existsSync(join(dataDir, 'reboot-requested'))).toBe(false);

    app.ctx.settings.set('updates', { mode: 'native' });
    res = await app.inject({ method: 'POST', url: '/api/system/reboot', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(readFileSync(join(dataDir, 'reboot-requested'), 'utf8')).toBe('reboot');
  });

  it('is admin-only', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/system/reboot', cookies: viewerCookies, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/system/update-status', () => {
  it('reports null with no status file, the phase while one exists, and null again for empty', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/system/update-status', cookies: viewerCookies });
    expect(res.json()).toEqual({ phase: null });

    writeFileSync(join(dataDir, 'update-status'), 'installing\n');
    res = await app.inject({ method: 'GET', url: '/api/system/update-status', cookies: viewerCookies });
    expect(res.json()).toEqual({ phase: 'installing' });

    writeFileSync(join(dataDir, 'update-status'), '');
    res = await app.inject({ method: 'GET', url: '/api/system/update-status', cookies: viewerCookies });
    expect(res.json()).toEqual({ phase: null });
  });

  it('clears a stale status file left by a crashed updater at boot', async () => {
    writeFileSync(join(dataDir, 'update-status'), 'building');
    await app.close();
    app = await buildApp({ dataDir, version: '1.2.3' });
    viewerCookies = await login('view', 'hunter22');
    const res = await app.inject({ method: 'GET', url: '/api/system/update-status', cookies: viewerCookies });
    expect(res.json()).toEqual({ phase: null });
  });

  it('requires auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/system/update-status' })).statusCode).toBe(401);
  });
});

describe('GET /api/system/stats/history', () => {
  it('serves recorded samples to viewers, bucketed shape intact', async () => {
    recordHostStats(app.ctx.db, {
      ts: new Date().toISOString(), cpuPct: 12, memPct: 34, diskPct: 56, tempC: null, watts: null,
    });
    const res = await app.inject({ method: 'GET', url: '/api/system/stats/history?hours=24', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    const { points } = res.json();
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ cpuPct: 12, memPct: 34, diskPct: 56, tempC: null });
  });

  it('rejects an out-of-range hours query and requires auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/system/stats/history' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/api/system/stats/history?hours=0', cookies: viewerCookies });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/system/kiosk-restart', () => {
  it('409s outside native mode and writes the trigger inside it', async () => {
    let res = await app.inject({ method: 'POST', url: '/api/system/kiosk-restart', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(existsSync(join(dataDir, 'kiosk-restart-requested'))).toBe(false);

    app.ctx.settings.set('updates', { mode: 'native' });
    res = await app.inject({ method: 'POST', url: '/api/system/kiosk-restart', cookies: adminCookies, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(readFileSync(join(dataDir, 'kiosk-restart-requested'), 'utf8')).toBe('restart');
  });

  it('is admin-only', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/system/kiosk-restart', cookies: viewerCookies, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});
