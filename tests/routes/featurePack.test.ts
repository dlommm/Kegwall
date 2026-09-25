import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createDrinker, createUser } from '../../src/server/db/users.js';
import net from 'node:net';
import { Aedes } from 'aedes';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
let cookies: Record<string, string>;
let kegId: number;
let tapId: number;

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const db = app.ctx.db;
  await createUser(db, {
    username: 'admin', displayName: 'Admin', password: 'hunter22', role: 'admin',
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'hunter22' },
  });
  const sessionCookie = login.cookies.find((c) => c.name === 'session')!;
  cookies = { [sessionCookie.name]: sessionCookie.value };
  const beer = createBeer(db, { name: 'Citra IPA' });
  const tap = createTap(db, { number: 1 });
  tapId = tap.id;
  kegId = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id }).id;
});
afterEach(async () => { await app.close(); });

describe('rate-after-claim (design 6a)', () => {
  it('rates a claimed pour and rejects unclaimed/late/invalid ones', async () => {
    const db = app.ctx.db;
    const sam = createDrinker(db, { displayName: 'Sam' });
    const claimed = recordPourTx(db, {
      kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp', drinkerId: sam.id,
    }).pour;
    const unclaimed = recordPourTx(db, {
      kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp',
    }).pour;
    const stale = recordPourTx(db, {
      kegId, ts: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), volumeMl: 400, source: 'udp', drinkerId: sam.id,
    }).pour;

    const ok = await app.inject({
      method: 'POST',
      url: `/api/public/pours/${claimed.id}/rate`,
      payload: { rating: 5, tags: ['Crisp', 'Perfect temp'], drinkerId: sam.id },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().rating).toBe(5);
    expect(ok.json().ratingTags).toEqual(['Crisp', 'Perfect temp']);

    expect((await app.inject({
      method: 'POST', url: `/api/public/pours/${unclaimed.id}/rate`, payload: { rating: 4, drinkerId: sam.id },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: `/api/public/pours/${stale.id}/rate`, payload: { rating: 4, drinkerId: sam.id },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: `/api/public/pours/${claimed.id}/rate`, payload: { rating: 9, drinkerId: sam.id },
    })).statusCode).toBe(400);

    // The rated pour now feeds the wall's per-beer average.
    const wallTaps = (await app.inject({ method: 'GET', url: '/api/public/menu' })).json().taps;
    expect(wallTaps[0].avgRating).toBe(5);
  });

  it('rejects a rating from someone other than the pour\'s claimant (403)', async () => {
    const db = app.ctx.db;
    const sam = createDrinker(db, { displayName: 'Sam' });
    const mallory = createDrinker(db, { displayName: 'Mallory' });
    const claimed = recordPourTx(db, {
      kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp', drinkerId: sam.id,
    }).pour;
    const res = await app.inject({
      method: 'POST', url: `/api/public/pours/${claimed.id}/rate`,
      payload: { rating: 5, drinkerId: mallory.id },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('passport (design 6a)', () => {
  it('returns stats, badges and recent pours for a pourer', async () => {
    const db = app.ctx.db;
    const sam = createDrinker(db, { displayName: 'Sam' });
    recordPourTx(db, {
      kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp', drinkerId: sam.id, quality: 95,
    });
    const res = await app.inject({ method: 'GET', url: `/api/public/passport/${sam.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pourCount).toBe(1);
    expect(body.volumeMl).toBe(400);
    expect(body.badges).toContain('First pour');
    expect(body.badges).toContain('Smooth operator');
    expect(body.recent[0].beerName).toBe('Citra IPA');

    expect((await app.inject({ method: 'GET', url: '/api/public/passport/999' })).statusCode).toBe(404);
  });
});

describe('session endpoints (design 6c)', () => {
  it('start → join → snapshot → end', async () => {
    const db = app.ctx.db;
    const sam = createDrinker(db, { displayName: 'Sam' });

    const started = await app.inject({
      method: 'POST', url: '/api/public/session/start', payload: { name: 'Game night' },
    });
    expect(started.statusCode).toBe(200);

    const joined = await app.inject({
      method: 'POST', url: '/api/public/session/join', payload: { drinkerId: sam.id },
    });
    expect(joined.json().members).toHaveLength(1);

    recordPourTx(db, {
      kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp', drinkerId: sam.id,
    });
    const current = (await app.inject({ method: 'GET', url: '/api/public/session' })).json();
    expect(current.totals[0]).toMatchObject({ name: 'Sam', pourCount: 1, volumeMl: 400 });

    const ended = await app.inject({ method: 'POST', url: '/api/public/session/end' });
    expect(ended.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/public/session' })).json()).toEqual({ active: false });
    expect((await app.inject({ method: 'POST', url: '/api/public/session/end' })).statusCode).toBe(409);
  });
});

describe('line cleaning endpoints (design 6e)', () => {
  it('logs a cleaning and reports per-tap status', async () => {
    const db = app.ctx.db;
    recordPourTx(db, { kegId, ts: new Date().toISOString(), volumeMl: 500, source: 'udp' });

    let statuses = (await app.inject({ method: 'GET', url: '/api/cleanings/status', cookies })).json();
    expect(statuses[0]).toMatchObject({ tapId, due: true });

    const logged = await app.inject({
      method: 'POST', url: `/api/taps/${tapId}/cleanings`, payload: { note: 'BLC' }, cookies,
    });
    expect(logged.statusCode).toBe(201);

    statuses = (await app.inject({ method: 'GET', url: '/api/cleanings/status', cookies })).json();
    expect(statuses[0].due).toBe(false);
    const detail = (await app.inject({ method: 'GET', url: `/api/taps/${tapId}/cleanings`, cookies })).json();
    expect(detail.cleanings[0].note).toBe('BLC');
  });

  it('backdates a cleaning to a past date and rejects a future one (redesign 4a)', async () => {
    const backdated = await app.inject({
      method: 'POST', url: `/api/taps/${tapId}/cleanings`, cookies,
      payload: { cleanedAt: '2026-06-01T12:00:00.000Z' },
    });
    expect(backdated.statusCode).toBe(201);
    expect(backdated.json().ts).toBe('2026-06-01T12:00:00.000Z');

    const future = new Date(Date.now() + 86400000).toISOString();
    const rejected = await app.inject({
      method: 'POST', url: `/api/taps/${tapId}/cleanings`, cookies, payload: { cleanedAt: future },
    });
    expect(rejected.statusCode).toBe(400);
  });
});

describe('analytics endpoints (design 10a)', () => {
  it('serves KPIs and the heatmap grid', async () => {
    recordPourTx(app.ctx.db, { kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp' });
    const kpis = (await app.inject({ method: 'GET', url: '/api/stats/kpis?days=30', cookies })).json();
    expect(kpis.pours).toBe(1);
    const heatmap = (await app.inject({ method: 'GET', url: '/api/stats/heatmap', cookies })).json();
    expect(heatmap.grid).toHaveLength(7);
  });
});

describe('connection doctor (design 11e)', () => {
  it('cloud check reports the missing key cleanly', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/doctor/cloud', payload: {}, cookies });
    expect(res.json()).toMatchObject({ ok: false, detail: 'No Kegtron cloud API key configured' });
  });

  it('the UDP-path listen counts only genuine UDP packet statuses, never cloud events', async () => {
    const promise = app.inject({
      method: 'POST', url: '/api/doctor/listen', payload: { seconds: 3 }, cookies,
    });
    // Give the route a beat to subscribe, then emit a mix of signals.
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    // Cloud-style live events MUST NOT count — the original implementation counted
    // these, and Kegtron's cloud notify made a dead UDP path look alive (observed:
    // 41 cloud events while UDP had been silent for 35 minutes).
    app.ctx.bus.emit('pour_progress', {
      monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 }, curServMl: 100, ts: 'x',
    });
    app.ctx.bus.emit('volume_update', {
      monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 },
      volStartMl: 19000, volDispensedMl: 100, sizeMl: 19000, ts: 'x',
    });
    // Real UDP packet statuses (udpSource.ts emits one per parsed packet) DO count.
    app.ctx.bus.emit('source_status', {
      source: 'kegtron_udp', healthy: true, detail: 'last packet from 2001011234 at x', ts: 'x',
    });
    app.ctx.bus.emit('source_status', {
      source: 'kegtron_udp', healthy: true, detail: 'last packet from 2001011234 at y', ts: 'y',
    });
    // Unhealthy UDP statuses and other sources' statuses don't count either.
    app.ctx.bus.emit('source_status', {
      source: 'kegtron_udp', healthy: false, detail: 'socket error: boom', ts: 'z',
    });
    app.ctx.bus.emit('source_status', {
      source: 'gen1_ble', healthy: true, detail: 'last advert from aa:bb at z', ts: 'z',
    });
    // Raw datagrams captured for the wire-level view (malformed included).
    app.ctx.bus.emit('udp_packet_raw', { raw: '{"serialNum":"2001011234"}', ts: 'w' });
    const res = await promise;
    expect(res.json().total).toBe(2);
    expect(res.json().perMonitor[0]).toMatchObject({ monitor: '2001011234', events: 2 });
    expect(res.json().rawSamples).toEqual([{ raw: '{"serialNum":"2001011234"}', ts: 'w' }]);
  }, 10_000);

  it('udp-history summarizes the receipt timeline; udp-raw serves the packet ring', async () => {
    const { bumpUdpActivity } = await import('../../src/server/db/udpActivity.js');
    const minute = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 16);
    bumpUdpActivity(app.ctx.db, minute, 'dev427', 240);
    const history = await app.inject({ method: 'GET', url: '/api/doctor/udp-history?hours=24', cookies });
    expect(history.statusCode).toBe(200);
    expect(history.json().devices[0]).toMatchObject({ serial: 'dev427', totalPackets: 240 });

    app.ctx.bus.emit('udp_packet_raw', { raw: '{"serialNum":"dev427"}', serial: 'dev427', ts: 'x' });
    app.ctx.bus.emit('udp_packet_raw', { raw: 'garbage', ts: 'y' });
    const rawRes = await app.inject({ method: 'GET', url: '/api/doctor/udp-raw', cookies });
    // Newest first; malformed packets appear without a serial.
    expect(rawRes.json().packets[0]).toEqual({ raw: 'garbage', ts: 'y' });
    expect(rawRes.json().packets[1]).toMatchObject({ serial: 'dev427' });
  });

  it('env check reports Docker state with a hint', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/doctor/env', cookies });
    expect(typeof res.json().inDocker).toBe('boolean');
    expect(res.json().hint.length).toBeGreaterThan(0);
  });

  it('govee check reports the missing key', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/doctor/govee', payload: {}, cookies });
    expect(res.json()).toMatchObject({ ok: false });
  });
});

describe('POST /api/doctor/mqtt (HA wizard connection test)', () => {
  let broker: Aedes | undefined;
  let server: net.Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    if (broker) await new Promise<void>((r) => broker!.close(() => r()));
    server = undefined; broker = undefined;
  });

  async function startBroker(): Promise<number> {
    broker = await Aedes.createBroker();
    server = net.createServer(broker.handle);
    await new Promise<void>((r) => server!.listen(0, r));
    return (server!.address() as { port: number }).port;
  }

  it('returns ok:true against a live broker (admin)', async () => {
    const port = await startBroker();
    const res = await app.inject({
      method: 'POST', url: '/api/doctor/mqtt', cookies,
      payload: { url: `mqtt://127.0.0.1:${port}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('returns ok:false with a friendly detail against a dead port', async () => {
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, r));
    const deadPort = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));

    const res = await app.inject({
      method: 'POST', url: '/api/doctor/mqtt', cookies,
      payload: { url: `mqtt://127.0.0.1:${deadPort}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(typeof res.json().detail).toBe('string');
  });

  it('is editor-gated (401 unauthenticated)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/doctor/mqtt', payload: { url: 'mqtt://127.0.0.1:1883' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('cleaning reminder controls', () => {
  it('ignores and resumes reminders without recording a cleaning', async () => {
    recordPourTx(app.ctx.db, { kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp' });
    const url = `/api/taps/${tapId}/cleanings/reminders`;
    const ignored = await app.inject({ method: 'PUT', url, cookies, payload: { ignored: true } });
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json()).toMatchObject({ ignored: true, due: false, lastCleanedAt: null });
    const statuses = (await app.inject({ method: 'GET', url: '/api/cleanings/status', cookies })).json();
    expect(statuses[0]).toMatchObject({ ignored: true, due: false });
    const resumed = await app.inject({ method: 'PUT', url, cookies, payload: { ignored: false } });
    expect(resumed.json()).toMatchObject({ ignored: false, due: true, lastCleanedAt: null });
    expect((await app.inject({ method: 'GET', url: `/api/taps/${tapId}/cleanings`, cookies })).json().cleanings).toEqual([]);
    expect((await app.inject({ method: 'PUT', url, cookies, payload: { ignored: 'yes' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/taps/999/cleanings/reminders', cookies, payload: { ignored: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url, payload: { ignored: true } })).statusCode).toBe(401);
  });

  it('suppresses empty and kicked taps, restoring due state when a full keg is tapped', async () => {
    const db = app.ctx.db;
    recordPourTx(db, { kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp' });
    const status = async () => (await app.inject({ method: 'GET', url: `/api/taps/${tapId}/cleanings`, cookies })).json().status;
    expect((await status()).due).toBe(true);
    db.prepare('UPDATE kegs SET vol_dispensed_ml = vol_start_ml WHERE id = ?').run(kegId);
    expect(await status()).toMatchObject({ due: false, inactive: true });
    db.prepare("UPDATE kegs SET status = 'kicked' WHERE id = ?").run(kegId);
    expect(await status()).toMatchObject({ due: false, inactive: true });
    const beer = createBeer(db, { name: 'Replacement' });
    createKeg(db, { beerId: beer.id, tapId, sizeMl: 19000, volStartMl: 19000 });
    expect(await status()).toMatchObject({ due: true, inactive: false });
  });
});

it('lists older unclaimed pours before applying the admin page limit', async () => {
  const old = recordPourTx(app.ctx.db, { kegId, ts: '2026-01-01T00:00:00.000Z', volumeMl: 400, source: 'udp' }).pour;
  const drinker = createDrinker(app.ctx.db, { displayName: 'Sam' });
  recordPourTx(app.ctx.db, { kegId, ts: new Date().toISOString(), volumeMl: 400, source: 'udp', drinkerId: drinker.id });
  const response = await app.inject({ method: 'GET', url: '/api/pours?unclaimed=true&limit=1', cookies });
  expect(response.statusCode).toBe(200);
  expect(response.json().map((pour: { id: number }) => pour.id)).toEqual([old.id]);
});
