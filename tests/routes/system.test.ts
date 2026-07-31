import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/db/users.js';
import { isNewerVersion } from '../../src/server/routes/system.js';

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
  app = await buildApp({ dataDir, version: '1.2.3', updateTimeoutMs: 300 });
  createUser(app.ctx.db, { username: 'admin', displayName: 'Admin', password: 'hunter22', role: 'admin' });
  createUser(app.ctx.db, { username: 'view', displayName: 'View', password: 'hunter22', role: 'viewer' });
  adminCookies = await login('admin', 'hunter22');
  viewerCookies = await login('view', 'hunter22');
});
afterEach(async () => { await app.close(); });

/** A local stand-in for the GitLab releases API / the Watchtower HTTP API. */
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
      f.get('/api/v4/projects/:id/releases', async () => [
        { tag_name: 'v2.0.0-rc.1' }, // prerelease — skipped
        { tag_name: 'v1.3.0' },
        { tag_name: 'v1.2.3' },
      ]);
    });
    app.ctx.settings.set('updateCheckBaseUrl', fake.url);
    app.ctx.settings.set('updateCheckProjectPath', 'me/proj');

    const res = await app.inject({
      method: 'POST', url: '/api/system/update-check', cookies: adminCookies, payload: {},
    });
    expect(res.json()).toEqual({
      ok: true,
      current: '1.2.3',
      latest: '1.3.0',
      updateAvailable: true,
      notesUrl: `${fake.url}/me/proj/-/releases/v1.3.0`,
    });
    await fake.close();
  });

  it('reports up-to-date when the newest release matches the running version', async () => {
    const fake = await fakeServer((f) => {
      f.get('/api/v4/projects/:id/releases', async () => [{ tag_name: 'v1.2.3' }]);
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
      f.get('/api/v4/projects/:id/releases', async (_req, reply) => reply.code(500).send({}));
    });
    app.ctx.settings.set('updateCheckBaseUrl', erroring.url);
    let res = await app.inject({ method: 'POST', url: '/api/system/update-check', cookies: adminCookies, payload: {} });
    expect(res.json()).toMatchObject({ ok: false, current: '1.2.3' });
    await erroring.close();

    const empty = await fakeServer((f) => {
      f.get('/api/v4/projects/:id/releases', async () => []);
    });
    app.ctx.settings.set('updateCheckBaseUrl', empty.url);
    res = await app.inject({ method: 'POST', url: '/api/system/update-check', cookies: adminCookies, payload: {} });
    expect(res.json()).toMatchObject({ ok: false, message: expect.stringContaining('No releases') });
    await empty.close();

    const sleeping = await fakeServer((f) => {
      f.get('/api/v4/projects/:id/releases', async () => new Promise(() => {})); // never answers
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
