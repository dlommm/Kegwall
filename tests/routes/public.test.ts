import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createSupplier } from '../../src/server/db/suppliers.js';
import { createDrinker, createUser } from '../../src/server/db/users.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { setWallDevices } from '../../src/server/db/wallDevices.js';
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
  // Wall scoping is strict (no assigned devices = no taps), so the shared fixture wall
  // gets a bound device covering the seeded tap.
  const wallId = (db.prepare(`SELECT id FROM walls WHERE slug = 'main'`).get() as any).id;
  const monitor = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 });
  bindMonitorToTap(db, monitor.id, tap.id);
  setWallDevices(db, wallId, [{ type: 'kegtron_pro', identifier: 'dev1' }]);
});
afterEach(async () => { await app.close(); });

describe('public routes', () => {
  it('public menu drops hidden taps and never leaks any keg owner-cost field', async () => {
    const db = app.ctx.db;
    // Seed EVERY owner-cost field so a regression that forgets one is caught.
    const supplierId = createSupplier(db, { name: 'Joes Distributing' }).id;
    db.prepare(`UPDATE kegs SET cost_cents = 12345, deposit_cents = 3000,
      supplier_id = ?, purchased_at = '2026-05-20'`).run(supplierId);
    const hiddenBeer = createBeer(db, { name: 'Secret Stout' });
    const hiddenTap = createTap(db, { number: 9, hidden: true });
    createKeg(db, { beerId: hiddenBeer.id, sizeMl: 19000, volStartMl: 19000, tapId: hiddenTap.id });

    const res = await app.inject({ method: 'GET', url: '/api/public/menu' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taps.some((t: any) => t.tapNumber === 9)).toBe(false); // hidden tap absent
    for (const t of body.taps) {
      if (t.keg) {
        expect(t.keg.costCents).toBeNull(); // operator cost never leaks
        expect(t.keg.depositCents).toBeNull();
        expect(t.keg.supplierId).toBeNull();
        expect(t.keg.purchasedAt).toBeNull();
      }
    }
    // Belt and suspenders: the raw serialized body carries none of the seeded values.
    expect(res.body).not.toContain('12345');
    expect(res.body).not.toContain('2026-05-20');
  });

  it('serves the computed display price when pricing is enabled, never the owner cost', async () => {
    const db = app.ctx.db;
    // 47,318 mL (≈100 pints) keg at $131.00; markup 245% → $4.50/pint at $0.25 rounding.
    db.prepare('UPDATE kegs SET cost_cents = 13100, size_ml = 47318').run();
    app.ctx.settings.set('pricing', { enabled: true, markupPct: 245, rounding: 0.25 });

    const res = await app.inject({ method: 'GET', url: '/api/public/menu' });
    const priced = res.json().taps.find((t: any) => t.keg);
    expect(priced.pricePerPintCents).toBe(450);
    expect(priced.keg.costCents).toBeNull(); // cost still stripped
    expect(res.body).not.toContain('13100'); // raw cost never on the wire
  });

  it('omits the display price (null) when pricing is disabled', async () => {
    const db = app.ctx.db;
    db.prepare('UPDATE kegs SET cost_cents = 13100').run();
    // pricing defaults to disabled
    const res = await app.inject({ method: 'GET', url: '/api/public/menu' });
    const priced = res.json().taps.find((t: any) => t.keg);
    expect(priced.pricePerPintCents).toBeNull();
  });

  it('serves wall data by slug and 404s unknown walls', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/wall/main' });
    expect(res.statusCode).toBe(200);
    expect(res.json().taps[0].beer.name).toBe('Citra IPA');
    expect(res.json().units).toBe('us');
    expect((await app.inject({ method: 'GET', url: '/api/public/wall/nope' })).statusCode).toBe(404);
  });

  it('wall device scoping: the payload carries allowedTapIds, and a wall with NO '
    + 'assigned devices serves NO taps (strict)', async () => {
    const db = app.ctx.db;
    const scoped = await app.inject({ method: 'GET', url: '/api/public/wall/main' });
    expect(scoped.json().allowedTapIds).toHaveLength(1);

    db.prepare(`INSERT INTO walls (slug, name, config) VALUES ('bare', 'Bare', '{}')`).run();
    const bare = await app.inject({ method: 'GET', url: '/api/public/wall/bare' });
    expect(bare.statusCode).toBe(200);
    expect(bare.json().taps).toEqual([]);
    expect(bare.json().allowedTapIds).toEqual([]);
  });

  it('wall device scoping: only taps bound to the wall\'s assigned devices appear, '
    + 'and the same device can feed two walls', async () => {
    const db = app.ctx.db;
    // A second tap fed by a DIFFERENT device, not assigned to 'main'.
    const beer2 = createBeer(db, { name: 'Rival Lager' });
    const tap2 = createTap(db, { number: 2 });
    createKeg(db, { beerId: beer2.id, sizeMl: 19000, volStartMl: 19000, tapId: tap2.id });
    const rival = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'rival', portIndex: 0 });
    bindMonitorToTap(db, rival.id, tap2.id);

    const main = await app.inject({ method: 'GET', url: '/api/public/wall/main' });
    expect(main.json().taps.map((t: any) => t.beer.name)).toEqual(['Citra IPA']);

    // dev1 on a second wall too — device→wall is many-to-many.
    db.prepare(`INSERT INTO walls (slug, name, config) VALUES ('second', 'Second', '{}')`).run();
    const secondId = (db.prepare(`SELECT id FROM walls WHERE slug = 'second'`).get() as any).id;
    setWallDevices(db, secondId, [{ type: 'kegtron_pro', identifier: 'dev1' }]);
    const second = await app.inject({ method: 'GET', url: '/api/public/wall/second' });
    expect(second.json().taps.map((t: any) => t.beer.name)).toEqual(['Citra IPA']);
  });

  it('serves the menu with site name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/menu' });
    expect(res.json().siteName).toBe('My Taproom');
    expect(res.json().taps).toHaveLength(1);
    expect(res.json().units).toBe('us');
  });

  it('reflects the configured display units on wall and menu payloads', async () => {
    app.ctx.settings.set('displayUnits', 'metric');
    const wall = await app.inject({ method: 'GET', url: '/api/public/wall/main' });
    expect(wall.json().units).toBe('metric');
    const menu = await app.inject({ method: 'GET', url: '/api/public/menu' });
    expect(menu.json().units).toBe('metric');
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

  it('rejects claiming a pour older than the claim window (server-side, not just UI)', async () => {
    const db = app.ctx.db;
    // Age the seeded pour well past the 10-minute claim window.
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE pours SET ts = ? WHERE id = ?').run(old, pourId);
    const res = await app.inject({
      method: 'POST', url: '/api/public/claim', payload: { pourId, drinkerId },
    });
    expect(res.statusCode).toBe(409);
    // And it stays unclaimed.
    const row = db.prepare('SELECT drinker_id FROM pours WHERE id = ?').get(pourId) as any;
    expect(row.drinker_id).toBeNull();
  });

  it('rejects claiming as a non-drinker user id', async () => {
    const db = app.ctx.db;
    const loginUser = createUser(db, {
      username: 'admin', displayName: 'Admin', password: 'hunter22', role: 'admin', isDrinker: false,
    });
    const res = await app.inject({
      method: 'POST', url: '/api/public/claim',
      payload: { pourId, drinkerId: loginUser.id },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects claiming with a nonexistent drinkerId', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/public/claim',
      payload: { pourId, drinkerId: 999999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s claiming an unknown pourId', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/public/claim',
      payload: { pourId: 999999, drinkerId },
    });
    expect(res.statusCode).toBe(404);
  });
});
