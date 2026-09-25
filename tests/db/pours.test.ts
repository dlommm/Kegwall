import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createDrinker } from '../../src/server/db/users.js';
import { listPours, recentUnclaimedPours, setPourDrinker } from '../../src/server/db/pours.js';
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
