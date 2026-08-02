import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createDrinker } from '../../src/server/db/users.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
let kegId: number;

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const db = app.ctx.db;
  const beer = createBeer(db, { name: 'Citra IPA' });
  const tap = createTap(db, { number: 1 });
  kegId = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id }).id;
});
afterEach(async () => { await app.close(); });

describe('public pourer signup (Pour Wall overhaul Phase 3)', () => {
  it('creates a passwordless pourer from name + color', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/pourers',
      payload: { name: 'Sam', color: '#5FD9BC' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.displayName).toBe('Sam');
    expect(body.avatarColor).toBe('#5FD9BC');

    const drinkers = (await app.inject({ method: 'GET', url: '/api/public/drinkers' })).json();
    expect(drinkers.some((d: any) => d.id === body.id)).toBe(true);
  });

  it('rejects blank names and malformed colors', async () => {
    expect((await app.inject({
      method: 'POST', url: '/api/public/pourers', payload: { name: '   ' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/api/public/pourers', payload: { name: 'Sam', color: 'red;}' },
    })).statusCode).toBe(400);
  });

  it('lists pourers with lifetime pour counts', async () => {
    const db = app.ctx.db;
    const sam = createDrinker(db, { displayName: 'Sam' });
    const ts = new Date().toISOString();
    recordPourTx(db, {
      kegId, ts, volumeMl: 400, source: 'udp', drinkerId: sam.id,
    });
    const res = await app.inject({ method: 'GET', url: '/api/public/pourers' });
    const entry = res.json().find((p: any) => p.id === sam.id);
    expect(entry.pourCount).toBe(1);
    // lastPourAt feeds the tablet RECENT tiles (redesign 2d).
    expect(entry.lastPourAt).toBe(ts);
    const noPours = res.json().find((p: any) => p.pourCount === 0);
    if (noPours) expect(noPours.lastPourAt).toBeNull();
  });
});

describe('tablet arming endpoints', () => {
  it('arms, reports, and disarms a pourer', async () => {
    const sam = createDrinker(app.ctx.db, { displayName: 'Sam' });
    const armed = await app.inject({
      method: 'POST', url: '/api/public/tablet/arm', payload: { drinkerId: sam.id },
    });
    expect(armed.statusCode).toBe(200);
    expect(armed.json().armed).toBe(true);

    const status = (await app.inject({ method: 'GET', url: '/api/public/tablet/arm' })).json();
    expect(status).toMatchObject({ armed: true, drinkerId: sam.id });

    await app.inject({ method: 'DELETE', url: '/api/public/tablet/arm' });
    expect((await app.inject({ method: 'GET', url: '/api/public/tablet/arm' })).json().armed).toBe(false);
  });

  it('rejects arming a non-pourer', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/public/tablet/arm', payload: { drinkerId: 9999 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('public leaderboard', () => {
  it('returns quality-bearing entries and superlatives', async () => {
    const db = app.ctx.db;
    const sam = createDrinker(db, { displayName: 'Sam' });
    const jt = createDrinker(db, { displayName: 'JT' });
    const now = Date.now();
    // Sam: 3 scored pours (avg 94) + the biggest single pour.
    for (const [i, q] of [95, 94, 93].entries()) {
      recordPourTx(db, {
        kegId, ts: new Date(now - i * 60_000).toISOString(), volumeMl: 400 + i, source: 'udp', drinkerId: sam.id, quality: q,
      });
    }
    recordPourTx(db, {
      kegId, ts: new Date(now - 5 * 60_000).toISOString(), volumeMl: 900, source: 'udp', drinkerId: sam.id,
    });
    // JT: more pours, no quality.
    for (let i = 0; i < 5; i += 1) {
      recordPourTx(db, {
        kegId, ts: new Date(now - i * 30_000).toISOString(), volumeMl: 100, source: 'udp', drinkerId: jt.id,
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/public/leaderboard?window=month' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const samEntry = body.entries.find((e: any) => e.displayName === 'Sam');
    expect(samEntry.avgQuality).toBe(94);
    expect(samEntry.qualityCount).toBe(3);
    expect(body.superlatives.mostPours.displayName).toBe('JT');
    expect(body.superlatives.smoothest).toMatchObject({ displayName: 'Sam', avgQuality: 94 });
    expect(body.superlatives.biggestPour).toMatchObject({ displayName: 'Sam', volumeMl: 900 });
  });

  it('handles an empty board', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/leaderboard' });
    const body = res.json();
    expect(body.entries).toEqual([]);
    expect(body.superlatives).toEqual({
      mostPours: null, smoothest: null, biggestPour: null, gameWinner: null,
    });
  });
});

describe('claim window (design 3b: 10 minutes)', () => {
  it('recent-pours only lists pours from the last 10 minutes', async () => {
    const db = app.ctx.db;
    recordPourTx(db, {
      kegId, ts: new Date(Date.now() - 9 * 60_000).toISOString(), volumeMl: 300, source: 'udp',
    });
    recordPourTx(db, {
      kegId, ts: new Date(Date.now() - 11 * 60_000).toISOString(), volumeMl: 300, source: 'udp',
    });
    const res = await app.inject({ method: 'GET', url: '/api/public/recent-pours' });
    expect(res.json()).toHaveLength(1);
  });
});
