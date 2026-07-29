import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createDrinker } from '../../src/server/db/users.js';
import { recordTelemetrySampled } from '../../src/server/db/telemetry.js';

let app: FastifyInstance;
let adminCookies: { session: string };
let viewerCookies: { session: string };

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  adminCookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };
  await app.inject({
    method: 'POST', url: '/api/users', cookies: adminCookies,
    payload: { username: 'vw', displayName: 'Vw', password: 'password1', role: 'viewer' },
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'vw', password: 'password1' },
  });
  viewerCookies = { session: login.cookies.find((c: any) => c.name === 'session')!.value };
});
afterEach(async () => { await app.close(); });

describe('GET /api/stats/pours', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/pours' });
    expect(res.statusCode).toBe(401);
  });

  it('allows a viewer-role user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/pours', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
  });

  it('defaults to 30 days and zero-fills an empty DB', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/pours', cookies: adminCookies });
    expect(res.json()).toHaveLength(30);
  });

  it('honors ?days=7 and ?days=90', async () => {
    const seven = await app.inject({ method: 'GET', url: '/api/stats/pours?days=7', cookies: adminCookies });
    expect(seven.json()).toHaveLength(7);
    const ninety = await app.inject({ method: 'GET', url: '/api/stats/pours?days=90', cookies: adminCookies });
    expect(ninety.json()).toHaveLength(90);
  });

  it('400s on an unsupported ?days= value', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/pours?days=14', cookies: adminCookies });
    expect(res.statusCode).toBe(400);
  });

  it('reflects a real pour in the correct shape', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'Pils' });
    const tap = createTap(db, { number: 1 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 300, source: 'udp' });

    const res = await app.inject({ method: 'GET', url: '/api/stats/pours?days=7', cookies: adminCookies });
    const rows = res.json();
    const today = rows[rows.length - 1];
    expect(today).toMatchObject({ count: 1, volumeMl: 300 });
    expect(Object.keys(today).sort()).toEqual(['count', 'date', 'volumeMl'].sort());
  });
});

describe('GET /api/stats/hours', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/hours' });
    expect(res.statusCode).toBe(401);
  });

  it('returns all 24 hours, zero-filled, on an empty DB', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/hours', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(24);
    expect(rows.map((r: any) => r.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });
});

describe('GET /api/stats/kegs', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/kegs' });
    expect(res.statusCode).toBe(401);
  });

  it('returns [] on an empty DB', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/kegs', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns burn/projection fields for an active keg', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'IPA', srm: 8 });
    const tap = createTap(db, { number: 2 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 700, source: 'udp' });

    const res = await app.inject({ method: 'GET', url: '/api/stats/kegs', cookies: adminCookies });
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kegId: keg.id, beerName: 'IPA', tapNumber: 2, srm: 8, remainingMl: 18300,
    });
    expect(rows[0].dailyBurnMl).toBeGreaterThan(0);
    expect(typeof rows[0].projectedKickDate).toBe('string');
  });

  it('projectedKickDate is null with no pours', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'Lager' });
    const tap = createTap(db, { number: 1 });
    createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });

    const res = await app.inject({ method: 'GET', url: '/api/stats/kegs', cookies: adminCookies });
    expect(res.json()[0].projectedKickDate).toBeNull();
  });
});

describe('GET /api/stats/beers', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/beers' });
    expect(res.statusCode).toBe(401);
  });

  it('returns [] on an empty DB, defaulting to 90 days', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/beers', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('aggregates volume by beer, descending', async () => {
    const db = app.ctx.db;
    const ipa = createBeer(db, { name: 'IPA', srm: 8 });
    const stout = createBeer(db, { name: 'Stout', srm: 35 });
    const tap = createTap(db, { number: 1 });
    const ipaKeg = createKeg(db, { beerId: ipa.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
    const stoutKeg = createKeg(db, {
      beerId: stout.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id, status: 'on_deck',
    });
    recordPourTx(db, { kegId: ipaKeg.id, ts: new Date().toISOString(), volumeMl: 300, source: 'udp' });
    recordPourTx(db, { kegId: stoutKeg.id, ts: new Date().toISOString(), volumeMl: 900, source: 'udp' });

    const res = await app.inject({ method: 'GET', url: '/api/stats/beers', cookies: adminCookies });
    const rows = res.json();
    expect(rows).toEqual([
      { beerName: 'Stout', srm: 35, volumeMl: 900, pourCount: 1 },
      { beerName: 'IPA', srm: 8, volumeMl: 300, pourCount: 1 },
    ]);
  });

  it('400s on an unsupported ?days= value', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/beers?days=1', cookies: adminCookies });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/stats/temps', () => {
  async function makeProMonitor(identifier: string): Promise<number> {
    app.ctx.bus.emit('device_discovered', {
      monitor: { type: 'kegtron_pro', identifier, portIndex: 0 },
      serial: identifier,
      meta: {},
    });
    const list = await app.inject({ method: 'GET', url: '/api/monitors', cookies: adminCookies });
    return (list.json() as any[]).find((m) => m.identifier === identifier).id;
  }

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/temps?monitorId=1' });
    expect(res.statusCode).toBe(401);
  });

  it('400s when monitorId is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/temps', cookies: adminCookies });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown monitor id', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/stats/temps?monitorId=999999', cookies: adminCookies,
    });
    expect(res.statusCode).toBe(404);
  });

  it('reuses listTelemetry, defaulting to a 48h window', async () => {
    const monitorId = await makeProMonitor('mon-a');
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 60 * 60 * 1000); // 60h ago
    recordTelemetrySampled(app.ctx.db, monitorId, 4.2, 50, now.toISOString());
    recordTelemetrySampled(app.ctx.db, monitorId, 3.0, 40, old.toISOString());

    const res = await app.inject({
      method: 'GET', url: `/api/stats/temps?monitorId=${monitorId}`, cookies: viewerCookies,
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ temp: 4.2, humidity: 50 });
  });

  it('honors an explicit ?hours=', async () => {
    const monitorId = await makeProMonitor('mon-b');
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 60 * 60 * 1000); // 60h ago
    recordTelemetrySampled(app.ctx.db, monitorId, 3.0, 40, old.toISOString());

    const res = await app.inject({
      method: 'GET', url: `/api/stats/temps?monitorId=${monitorId}&hours=72`, cookies: adminCookies,
    });
    expect(res.json()).toHaveLength(1);
  });
});

describe('GET /api/stats/leaderboard', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/leaderboard' });
    expect(res.statusCode).toBe(401);
  });

  it('returns [] on an empty DB, defaulting to the week window', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/leaderboard', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('only counts claimed pours, descending by volume', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'IPA' });
    const tap = createTap(db, { number: 1 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
    const alice = createDrinker(db, { displayName: 'Alice', avatarColor: '#ff0000' });
    recordPourTx(db, {
      kegId: keg.id, ts: new Date().toISOString(), volumeMl: 300, source: 'udp', drinkerId: alice.id,
    });
    recordPourTx(db, { kegId: keg.id, ts: new Date().toISOString(), volumeMl: 9000, source: 'udp' });

    const res = await app.inject({
      method: 'GET', url: '/api/stats/leaderboard?window=all', cookies: adminCookies,
    });
    expect(res.json()).toEqual([{
      drinkerId: alice.id, displayName: 'Alice', avatarColor: '#ff0000', pourCount: 1, volumeMl: 300, avgQuality: null, qualityCount: 0,
    }]);
  });

  it('400s on an unsupported ?window= value', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/stats/leaderboard?window=year', cookies: adminCookies,
    });
    expect(res.statusCode).toBe(400);
  });
});
