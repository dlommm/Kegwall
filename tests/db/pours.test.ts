import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createTap } from '../../src/server/db/taps.js';
import { createDrinker } from '../../src/server/db/users.js';
import {
  listPours, recentUnclaimedPours, setPourDrinker, setPoursDrinker, findRecordedTwin,
} from '../../src/server/db/pours.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
let kegId: number;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  const beer = createBeer(db, { name: 'X' });
  kegId = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000 }).id;
});

function pourAt(ts: string, volumeMl = 300) {
  return recordPourTx(db, { kegId, ts, volumeMl, source: 'cloud' }).pour;
}

describe('pours repo', () => {
  it('filters by keg and time range with limit', () => {
    pourAt('2026-07-27T01:00:00.000Z');
    pourAt('2026-07-27T02:00:00.000Z');
    const rows = listPours(db, { kegId, since: '2026-07-27T01:30:00.000Z' });
    expect(rows).toHaveLength(1);
  });

  it('finds recent unclaimed pours only inside the window', () => {
    const now = Date.now();
    pourAt(new Date(now - 5 * 60_000).toISOString());   // 5 min ago
    pourAt(new Date(now - 60 * 60_000).toISOString());  // 1 h ago
    expect(recentUnclaimedPours(db, 15)).toHaveLength(1);
  });

  it('claims and unclaims a pour', () => {
    const drinker = createDrinker(db, { displayName: 'Sam' });
    const pour = pourAt(new Date().toISOString());
    expect(setPourDrinker(db, pour.id, drinker.id).drinkerId).toBe(drinker.id);
    expect(setPourDrinker(db, pour.id, null).drinkerId).toBeNull();
  });
});

it('filters unclaimed pours before limiting, including old pours', () => {
  const drinker = createDrinker(db, { displayName: 'Sam' });
  const old = pourAt('2026-01-01T00:00:00.000Z');
  const recent = pourAt('2026-09-01T00:00:00.000Z');
  setPourDrinker(db, recent.id, drinker.id);
  expect(listPours(db, { unclaimed: true, limit: 1 }).map((p) => p.id)).toEqual([old.id]);
});

it('pages with a beforeId keyset cursor without skipping same-timestamp pours', () => {
  const ts = '2026-09-01T00:00:00.000Z';
  const a = pourAt(ts); const b = pourAt(ts); const c = pourAt(ts);
  const older = pourAt('2026-08-01T00:00:00.000Z');
  const first = listPours(db, { limit: 2 }).map((p) => p.id);
  expect(first).toEqual([c.id, b.id]);
  const second = listPours(db, { limit: 2, beforeId: b.id }).map((p) => p.id);
  expect(second).toEqual([a.id, older.id]);
  expect(() => listPours(db, { beforeId: 99_999 })).toThrow(/pour 99999/);
});

it('filters by drinker', () => {
  const sam = createDrinker(db, { displayName: 'Sam' });
  const mine = pourAt('2026-09-01T00:00:00.000Z');
  pourAt('2026-09-02T00:00:00.000Z');
  setPourDrinker(db, mine.id, sam.id);
  expect(listPours(db, { drinkerId: sam.id }).map((p) => p.id)).toEqual([mine.id]);
});

it('bulk-assigns atomically, rolling back when any pour is missing', () => {
  const sam = createDrinker(db, { displayName: 'Sam' });
  const p1 = pourAt('2026-09-01T00:00:00.000Z');
  const p2 = pourAt('2026-09-02T00:00:00.000Z');
  expect(setPoursDrinker(db, [p1.id, p2.id, p1.id], sam.id).map((p) => p.drinkerId)).toEqual([sam.id, sam.id]);
  expect(() => setPoursDrinker(db, [p1.id, 99_999], null)).toThrow(/pour 99999/);
  expect(listPours(db, { drinkerId: sam.id })).toHaveLength(2);
});

it('finds an already-recorded twin pour on any keg of the tap, across ts spellings', () => {
  const tap = createTap(db, { number: 9 });
  const beer = createBeer(db, { name: 'Y' });
  const oldKeg = createKeg(db, { beerId: beer.id, tapId: tap.id, sizeMl: 19000, volStartMl: 19000 });
  const recorded = recordPourTx(db, { kegId: oldKeg.id, ts: '2026-09-01T12:00:00.123Z', volumeMl: 400, source: 'udp' }).pour;
  db.prepare("UPDATE kegs SET status = 'kicked' WHERE id = ?").run(oldKeg.id);
  createKeg(db, { beerId: beer.id, tapId: tap.id, sizeMl: 19000, volStartMl: 19000 });

  // The cloud's copy: second-precision ts, slightly different volume, keg swapped since.
  expect(findRecordedTwin(db, tap.id, '2026-09-01T12:00:30Z', 390)?.id).toBe(recorded.id);
  expect(findRecordedTwin(db, tap.id, '2026-09-01T12:05:00Z', 400)).toBeNull(); // outside window
  expect(findRecordedTwin(db, tap.id, '2026-09-01T12:00:10Z', 250)).toBeNull(); // different pour
  expect(findRecordedTwin(db, tap.id + 1, '2026-09-01T12:00:10Z', 400)).toBeNull(); // other tap
  expect(findRecordedTwin(db, tap.id, 'garbage', 400)).toBeNull();
});
