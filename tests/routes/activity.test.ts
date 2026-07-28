import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx, swapKeg } from '../../src/server/db/kegs.js';

let app: FastifyInstance;
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
afterEach(async () => { await app.close(); });

describe('GET /api/admin/activity', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/activity' });
    expect(res.statusCode).toBe(401);
  });

  it('allows a viewer-role user (the minimum role)', async () => {
    await app.inject({
      method: 'POST', url: '/api/users', cookies: adminCookies,
      payload: { username: 'v', displayName: 'V', password: 'password1', role: 'viewer' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'v', password: 'password1' },
    });
    const viewerCookies = { session: login.cookies.find((c: any) => c.name === 'session')!.value };
    const res = await app.inject({ method: 'GET', url: '/api/admin/activity', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
  });

  it('returns pour and keg-tapped events in the documented structured shape', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'Citra IPA' });
    const tap = createTap(db, { number: 3 });
    const keg = createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
      dateTapped: '2026-07-27T10:00:00.000Z',
    });
    recordPourTx(db, {
      kegId: keg.id, ts: '2026-07-27T11:00:00.000Z', volumeMl: 355, source: 'cloud',
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/activity', cookies: adminCookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    const pourEvent = body.find((e: any) => e.kind === 'pour');
    expect(pourEvent).toMatchObject({
      kind: 'pour', beerName: 'Citra IPA', tapNumber: 3, volumeMl: 355,
      ts: '2026-07-27T11:00:00.000Z',
    });
    expect(Object.keys(pourEvent).sort()).toEqual(
      ['beerName', 'kind', 'tapNumber', 'ts', 'volumeMl'].sort(),
    );

    const kegEvent = body.find((e: any) => e.kind === 'keg_tapped');
    expect(kegEvent).toMatchObject({
      kind: 'keg_tapped', beerName: 'Citra IPA', tapNumber: 3, volumeMl: null,
      ts: '2026-07-27T10:00:00.000Z',
    });
  });

  it('sorts merged pour and keg-tapped events by ts descending', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'Pils' });
    const tap = createTap(db, { number: 1 });
    const keg = createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
      dateTapped: '2026-07-27T09:00:00.000Z',
    });
    recordPourTx(db, {
      kegId: keg.id, ts: '2026-07-27T09:30:00.000Z', volumeMl: 200, source: 'udp',
    });
    recordPourTx(db, {
      kegId: keg.id, ts: '2026-07-27T08:00:00.000Z', volumeMl: 300, source: 'udp',
    });
    recordPourTx(db, {
      kegId: keg.id, ts: '2026-07-27T10:30:00.000Z', volumeMl: 100, source: 'udp',
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/activity', cookies: adminCookies });
    const body = res.json();
    const timestamps = body.map((e: any) => e.ts);
    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);
  });

  it('does not surface a keg still waiting on-deck (not yet actually tapped)', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'Stout' });
    const tap = createTap(db, { number: 2 });
    createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id, status: 'on_deck',
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/activity', cookies: adminCookies });
    expect(res.json()).toHaveLength(0);
  });

  it('limits the merged, sorted result to the most recent 20 events', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'Lager' });
    const tap = createTap(db, { number: 5 });
    const keg = createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
      dateTapped: '2026-07-01T00:00:00.000Z',
    });
    for (let i = 0; i < 25; i += 1) {
      recordPourTx(db, {
        kegId: keg.id,
        ts: `2026-07-27T${String(i).padStart(2, '0')}:00:00.000Z`,
        volumeMl: 100 + i,
        source: 'udp',
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/admin/activity', cookies: adminCookies });
    const body = res.json();
    expect(body).toHaveLength(20);
    // The 25 pours run hour-by-hour from 00:00 to 24:00 on 2026-07-27; the most recent 20
    // are hours 05 through 24 (index 24 down to 05).
    expect(body[0].ts).toBe('2026-07-27T24:00:00.000Z');
    expect(body[19].ts).toBe('2026-07-27T05:00:00.000Z');
  });

  it('reflects a promoted on-deck keg as a fresh keg_tapped event at promotion time', async () => {
    const db = app.ctx.db;
    const beer = createBeer(db, { name: 'Saison' });
    const tap = createTap(db, { number: 4 });
    createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
      dateTapped: '2026-07-01T00:00:00.000Z',
    });
    const onDeck = createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id, status: 'on_deck',
    });
    swapKeg(db, { tapId: tap.id, fromKegId: onDeck.id });

    const res = await app.inject({ method: 'GET', url: '/api/admin/activity', cookies: adminCookies });
    const body = res.json();
    const kegTapped = body.filter((e: any) => e.kind === 'keg_tapped');
    expect(kegTapped).toHaveLength(2);
  });
});
