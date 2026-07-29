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

describe('locations (design 11a)', () => {
  it('creates, lists, renames and deletes locations', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/locations', payload: { name: 'Garage Bar' }, cookies,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const listed = (await app.inject({ method: 'GET', url: '/api/locations', cookies })).json();
    expect(listed.map((l: any) => l.name)).toEqual(['Garage Bar']);

    await app.inject({
      method: 'PATCH', url: `/api/locations/${id}`, payload: { name: 'Lake House' }, cookies,
    });
    expect((await app.inject({ method: 'GET', url: '/api/locations', cookies })).json()[0].name).toBe('Lake House');

    expect((await app.inject({ method: 'DELETE', url: `/api/locations/${id}`, cookies })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/locations', cookies })).json()).toEqual([]);
  });

  it('deleting a location unscopes its monitors rather than deleting them', async () => {
    const db = app.ctx.db;
    const location = (await app.inject({
      method: 'POST', url: '/api/locations', payload: { name: 'Garage' }, cookies,
    })).json();
    const monitor = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 });
    await app.inject({
      method: 'PATCH',
      url: `/api/monitors/${monitor.id}/identity`,
      payload: { name: 'Main kegerator', locationId: location.id },
      cookies,
    });
    await app.inject({ method: 'DELETE', url: `/api/locations/${location.id}`, cookies });
    const monitors = (await app.inject({ method: 'GET', url: '/api/monitors', cookies })).json();
    expect(monitors[0].name).toBe('Main kegerator');
    expect(monitors[0].locationId).toBeNull();
  });

  it('monitor identity: sets a friendly name, rejects unknown locations', async () => {
    const monitor = upsertMonitor(app.ctx.db, { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 });
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/monitors/${monitor.id}/identity`,
      payload: { name: 'Main kegerator' },
      cookies,
    });
    expect(renamed.json().name).toBe('Main kegerator');

    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/monitors/${monitor.id}/identity`,
      payload: { locationId: 999 },
      cookies,
    });
    expect(bad.statusCode).toBe(404);
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
