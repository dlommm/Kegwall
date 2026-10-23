import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { attachMilestones } from '../../src/server/core/milestones.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg } from '../../src/server/db/kegs.js';

let db: Database.Database;
let bus: EventBus;
let moments: unknown[];
let banners: unknown[];
let tapId: number;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
  attachMilestones(db, bus);
  moments = [];
  banners = [];
  bus.on('wall_moment', (e) => moments.push(e));
  bus.on('wall_banner', (e) => banners.push(e));
  tapId = createTap(db, { number: 12 }).id;
});

describe('wall moments (Kegwall V2)', () => {
  it('announces a kicked keg with the next on-deck beer, and tags the banner', () => {
    const gone = createBeer(db, { name: 'Gourd Times' });
    const next = createBeer(db, { name: 'Harvest Märzen' });
    const keg = createKeg(db, { beerId: gone.id, sizeMl: 19000, volStartMl: 19000, tapId });
    db.prepare("UPDATE kegs SET status = 'kicked' WHERE id = ?").run(keg.id);
    const deck = createKeg(db, { beerId: next.id, sizeMl: 19000, volStartMl: 19000, tapId });
    db.prepare("UPDATE kegs SET status = 'on_deck' WHERE id = ?").run(deck.id);
    bus.emit('keg_kicked', { tapId, kegId: keg.id, beerId: gone.id, ts: '2026-10-22T21:00:00.000Z' });
    expect(moments).toEqual([expect.objectContaining({ kind: 'kicked', tapNumber: 12, beerName: 'Gourd Times', nextBeerName: 'Harvest Märzen' })]);
    expect(banners).toEqual([expect.objectContaining({ kind: 'celebrate', moment: 'kicked' })]);
  });

  it('announces a newly tapped keg', () => {
    const beer = createBeer(db, { name: 'Harvest Märzen', style: 'Märzen', abv: 5.8, srm: 11 });
    bus.emit('keg_tapped', { tapId, kegId: 1, beerId: beer.id, ts: '2026-10-22T21:00:00.000Z' });
    expect(moments).toEqual([expect.objectContaining({ kind: 'tapped', tapNumber: 12, beerName: 'Harvest Märzen', abv: 5.8, srm: 11 })]);
  });

  it("celebrates a pourer's 100th pour, but not their 99th", () => {
    const base = { pourId: 1, tapId, tapNumber: 12, volumeMl: 400, durationMs: null, ts: '2026-10-22T21:00:00.000Z' };
    bus.emit('pour_recorded', { ...base, pourerName: 'Priya', pourerPourCount: 99 });
    bus.emit('pour_recorded', { ...base, pourerName: 'Priya', pourerPourCount: 100 });
    expect(moments).toEqual([expect.objectContaining({ kind: 'milestone', scope: 'pourer', count: 100, pourerName: 'Priya' })]);
  });
});
