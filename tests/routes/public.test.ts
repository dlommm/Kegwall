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
let pourId: number;
let drinkerId: number;

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const db = app.ctx.db;
  const beer = createBeer(db, { name: 'Citra IPA' });
  const tap = createTap(db, { number: 1 });
  const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
  pourId = recordPourTx(db, {
    kegId: keg.id, ts: new Date().toISOString(), volumeMl: 400, source: 'cloud',
  }).pour.id;
  drinkerId = createDrinker(db, { displayName: 'Sam' }).id;
  db.prepare(`INSERT INTO walls (slug, name, config) VALUES ('main', 'Main', '{}')`).run();
});
afterEach(async () => { await app.close(); });

describe('public routes', () => {
  it('serves wall data by slug and 404s unknown walls', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/wall/main' });
    expect(res.statusCode).toBe(200);
    expect(res.json().taps[0].beer.name).toBe('Citra IPA');
    expect((await app.inject({ method: 'GET', url: '/api/public/wall/nope' })).statusCode).toBe(404);
  });

  it('serves the menu with site name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/menu' });
    expect(res.json().siteName).toBe('My Taproom');
    expect(res.json().taps).toHaveLength(1);
  });

  it('lists recent pours and claims one exactly once', async () => {
    const recent = await app.inject({ method: 'GET', url: '/api/public/recent-pours' });
    expect(recent.json()).toHaveLength(1);
    const claim = await app.inject({
      method: 'POST', url: '/api/public/claim', payload: { pourId, drinkerId },
    });
    expect(claim.statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST', url: '/api/public/claim', payload: { pourId, drinkerId },
    });
    expect(again.statusCode).toBe(409);
  });
});
