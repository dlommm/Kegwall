import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { insertNotification, listNotifications } from '../../src/server/db/notificationsRepo.js';
import { upsertMonitor } from '../../src/server/db/monitors.js';
import { recordTelemetrySampled, listTelemetry } from '../../src/server/db/telemetry.js';

let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

describe('app', () => {
  it('responds to health check', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('sets a Content-Security-Policy and nosniff header on responses', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('SqliteError mapping in the global error handler', () => {
  let adminCookies: { session: string };

  beforeEach(async () => {
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
    const setup = await app.inject({
      method: 'POST', url: '/api/auth/setup',
      payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
    });
    const c = setup.cookies.find((c: any) => c.name === 'session')!;
    adminCookies = { session: c.value };
  });

  it('maps a duplicate wall slug UNIQUE violation to 409 conflict, naming the field', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/walls', cookies: adminCookies,
      payload: { slug: 'main', name: 'Main Wall', config: {} },
    });
    expect(first.statusCode).toBe(201);

    const dupe = await app.inject({
      method: 'POST', url: '/api/walls', cookies: adminCookies,
      payload: { slug: 'main', name: 'Second Wall', config: {} },
    });
    expect(dupe.statusCode).toBe(409);
    const body = dupe.json();
    expect(body.error).toBe('conflict');
    expect(body.message).toContain('walls.slug');
    // never leaks the raw SQL statement
    expect(body.message).not.toMatch(/INSERT INTO|UNIQUE constraint failed/i);
  });

  it('maps a duplicate tap number UNIQUE violation to 409 conflict, naming the field', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
    });
    expect(first.statusCode).toBe(201);

    const dupe = await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
    });
    expect(dupe.statusCode).toBe(409);
    const body = dupe.json();
    expect(body.error).toBe('conflict');
    expect(body.message).toContain('taps.number');
    expect(body.message).not.toMatch(/INSERT INTO|UNIQUE constraint failed/i);
  });

  it('maps a foreign key violation to 400 validation without leaking raw SQL', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/kegs', cookies: adminCookies,
      payload: { beerId: 999999, sizeMl: 19000, volStartMl: 19000 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('validation');
    expect(body.message).not.toMatch(/INSERT INTO|FOREIGN KEY constraint failed/i);
  });
});

// Final-review fix wave (I2): the plan-promised `pruneNotifications` (>90d) and the
// pre-existing, also-never-called `pruneTelemetry` (spec: "rows older than 90 days pruned
// at startup") were both built and tested in isolation but never actually invoked from
// anywhere -- both tables grew forever. Wired into `createContext()` (see context.ts),
// which every `buildApp()` call goes through (test or production, `startSources` or not)
// -- migrations already run there via `openDb()`, so pruning rides the same "every boot"
// path. Seeds via a throwaway connection closed BEFORE `buildApp()` opens its own (same
// close-then-reopen idiom as db.test.ts's pending-restore tests) so the prune runs against
// data already on disk when `createContext` calls `openDb()`.
describe('startup pruning (final-review I2: notifications + telemetry >90d)', () => {
  it('prunes notifications and telemetry rows older than 90 days when the app starts', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ktdash-'));

    const seedDb = openDb(dataDir);
    insertNotification(seedDb, { title: 'ancient', ts: '2020-01-01T00:00:00.000Z' });
    const fresh = insertNotification(seedDb, { title: 'fresh', ts: new Date().toISOString() });
    const monitorId = upsertMonitor(seedDb, { type: 'kegtron_pro', identifier: 'd', portIndex: 0 }).id;
    recordTelemetrySampled(seedDb, monitorId, 4, 50, '2020-01-01T00:00:00.000Z');
    recordTelemetrySampled(seedDb, monitorId, 4.5, 55, new Date().toISOString());
    seedDb.close();

    app = await buildApp({ dataDir });

    const remainingNotifications = listNotifications(app.ctx.db);
    expect(remainingNotifications.map((n) => n.id)).toEqual([fresh.id]);

    const remainingTelemetry = listTelemetry(app.ctx.db, monitorId, '1970-01-01T00:00:00.000Z');
    expect(remainingTelemetry).toHaveLength(1);
  });

  it('a fresh install with no rows at all prunes cleanly (0 removed, no error)', async () => {
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
    expect(listNotifications(app.ctx.db)).toEqual([]);
  });
});
