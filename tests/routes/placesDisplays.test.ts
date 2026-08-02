import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../../src/server/db/users.js';
import { upsertMonitor } from '../../src/server/db/monitors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
let cookies: Record<string, string>;

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  createUser(app.ctx.db, {
    username: 'admin', displayName: 'Admin', password: 'hunter22', role: 'admin',
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'hunter22' },
  });
  const sessionCookie = login.cookies.find((c) => c.name === 'session')!;
  cookies = { [sessionCookie.name]: sessionCookie.value };
});
afterEach(async () => { await app.close(); });

describe('monitor device name', () => {
  it('renames every port row of the physical device, and clears with an empty string', async () => {
    const db = app.ctx.db;
    const port0 = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 });
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'dev1', portIndex: 1 });
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'other', portIndex: 0 });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/monitors/${port0.id}/identity`,
      payload: { name: 'Main kegerator' },
      cookies,
    });
    expect(renamed.json().name).toBe('Main kegerator');

    const monitors = (await app.inject({ method: 'GET', url: '/api/monitors', cookies })).json();
    const dev1 = monitors.filter((m: any) => m.identifier === 'dev1');
    expect(dev1).toHaveLength(2);
    for (const m of dev1) expect(m.name).toBe('Main kegerator');
    expect(monitors.find((m: any) => m.identifier === 'other').name).toBeNull();

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/monitors/${port0.id}/identity`,
      payload: { name: '' },
      cookies,
    });
    expect(cleared.json().name).toBeNull();
  });

  it('404s an unknown monitor id', async () => {
    const missing = await app.inject({
      method: 'PATCH', url: '/api/monitors/999/identity', payload: { name: 'X' }, cookies,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('disabling a Govee sensor persists device-wide, evicts its wall chip, and re-enables', async () => {
    const db = app.ctx.db;
    const sensor = upsertMonitor(db, { type: 'govee_sensor', identifier: 'AA:BB', portIndex: 0 });
    app.ctx.bus.emit('sensor_reading', {
      sensorId: 'AA:BB', name: 'Keg room', tempC: 4, humidity: 50, ts: new Date().toISOString(),
    });
    expect((await app.inject({ method: 'GET', url: '/api/public/sensors' })).json()).toHaveLength(1);

    const disabled = await app.inject({
      method: 'PATCH', url: `/api/monitors/${sensor.id}/identity`,
      payload: { enabled: false }, cookies,
    });
    expect(disabled.json().enabled).toBe(false);
    // The chip endpoint is empty immediately — registry entry evicted AND the
    // disabled monitor row excluded.
    expect((await app.inject({ method: 'GET', url: '/api/public/sensors' })).json()).toEqual([]);

    const enabled = await app.inject({
      method: 'PATCH', url: `/api/monitors/${sensor.id}/identity`,
      payload: { enabled: true }, cookies,
    });
    expect(enabled.json().enabled).toBe(true);
  });
});

describe('displays (design 7c)', () => {
  it('creates a display with a pairing code, assigns a wall, pairs publicly', async () => {
    app.ctx.db.prepare(`INSERT INTO walls (slug, name, config) VALUES ('main', 'Main', '{}')`).run();
    const wallId = (app.ctx.db.prepare("SELECT id FROM walls WHERE slug = 'main'").get() as any).id;

    const created = await app.inject({
      method: 'POST', url: '/api/displays', payload: { name: 'Living room TV' }, cookies,
    });
    expect(created.statusCode).toBe(201);
    const display = created.json();
    expect(display.code).toMatch(/^[A-Z2-9]{6}$/);

    await app.inject({
      method: 'PATCH',
      url: `/api/displays/${display.id}`,
      payload: { wallId, overrides: { look: 'ledger', takeoverStyle: 'dock' } },
      cookies,
    });

    // Public pairing by code, case-insensitive.
    const paired = await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: display.code.toLowerCase() },
    });
    expect(paired.statusCode).toBe(200);
    expect(paired.json()).toMatchObject({
      id: display.id, wallSlug: 'main', overrides: { look: 'ledger', takeoverStyle: 'dock' },
    });

    // The paired TV's refresh endpoint + last-seen touch.
    const view = await app.inject({ method: 'GET', url: `/api/public/display/${display.id}` });
    expect(view.json().wallSlug).toBe('main');
    const listed = (await app.inject({ method: 'GET', url: '/api/displays', cookies })).json();
    expect(listed[0].lastSeen).not.toBeNull();
  });

  it('404s pairing with a bogus code and unknown display views', async () => {
    expect((await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: 'NOPE99' },
    })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/public/display/999' })).statusCode).toBe(404);
  });

  it('rejects an invalid override look', async () => {
    const display = (await app.inject({
      method: 'POST', url: '/api/displays', payload: { name: 'TV' }, cookies,
    })).json();
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/displays/${display.id}`,
      payload: { overrides: { look: 'brutalist' } },
      cookies,
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('display-token gating (sub-project A)', () => {
  async function makePairedDisplay(): Promise<{ id: number; token: string }> {
    const created = (await app.inject({
      method: 'POST', url: '/api/displays', cookies, payload: { name: 'Bar TV' },
    })).json();
    const paired = (await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: created.code },
    })).json();
    expect(paired.token).toMatch(/^[0-9a-f]{64}$/); // token returned once
    return { id: created.id, token: paired.token };
  }

  function enforce() {
    app.ctx.settings.set('displays', { enforceToken: true });
  }

  beforeEach(() => {
    app.ctx.db.prepare(`INSERT INTO walls (slug, name, config) VALUES ('main', 'Main', '{}')`).run();
  });

  it('while enforcement is OFF, the gated reads stay public (dormant default)', async () => {
    expect((await app.inject({ url: '/api/public/menu' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/public/wall/main' })).statusCode).toBe(200);
  });

  it('while enforcement is ON, gated reads 401 without a token and 200 with one', async () => {
    const { token } = await makePairedDisplay();
    enforce();
    for (const url of ['/api/public/menu', '/api/public/wall/main', '/api/public/leaderboard']) {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: { 'x-display-token': token } })).statusCode).toBe(200);
    }
  });

  it('while enforcement is ON, the token is also accepted via the ?displayToken= query', async () => {
    const { token } = await makePairedDisplay();
    enforce();
    expect((await app.inject({ url: `/api/public/menu?displayToken=${token}` })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/public/menu?displayToken=wrong' })).statusCode).toBe(401);
  });

  it('display/:id stops being enumerable once enforced (needs a token)', async () => {
    const { id, token } = await makePairedDisplay();
    enforce();
    expect((await app.inject({ url: `/api/public/display/${id}` })).statusCode).toBe(401);
    expect((await app.inject({
      url: `/api/public/display/${id}`, headers: { 'x-display-token': token },
    })).statusCode).toBe(200);
  });

  it('the guest phone claim flow stays public even when enforcement is ON', async () => {
    await makePairedDisplay();
    enforce();
    // recent-pours (the phone claim page's read) is never gated.
    expect((await app.inject({ url: '/api/public/recent-pours' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/public/pourers' })).statusCode).toBe(200);
  });

  it('a logged-in staff session can read gated endpoints without a display token (admin pages)', async () => {
    enforce();
    // No display token, but the admin session cookie is present → allowed.
    expect((await app.inject({ url: '/api/public/menu', cookies })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/public/wall/main', cookies })).statusCode).toBe(200);
  });
});
