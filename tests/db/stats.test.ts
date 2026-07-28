import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createDrinker } from '../../src/server/db/users.js';
import {
  poursByDay, hourHistogram, activeKegStats, beersByVolume, leaderboard,
} from '../../src/server/db/stats.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
});

/** A fixed "now" for every test in this file — Task 9's stats functions all accept an
 * optional `now` (defaulting to `new Date()`) precisely so tests can pin it and build
 * pour timestamps as exact offsets, rather than racing the real wall clock. */
const NOW = new Date('2026-07-27T15:00:00.000Z');

function isoDaysAgo(days: number, hour = 12): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe('stats repo', () => {
  describe('poursByDay', () => {
    it('zero-fills every day in range, oldest first, when there are no pours at all', () => {
      const rows = poursByDay(db, 7, NOW);
      expect(rows).toHaveLength(7);
      expect(rows.every((r) => r.count === 0 && r.volumeMl === 0)).toBe(true);
      expect(rows[0]!.date).toBe('2026-07-21');
      expect(rows[6]!.date).toBe('2026-07-27');
    });

    it('aggregates count and volume per day and zero-fills gap days', () => {
      const beer = createBeer(db, { name: 'Pils' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });

      // Today: two pours. 2 days ago: one pour. Nothing in between (yesterday, gap day).
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(0, 10), volumeMl: 300, source: 'udp' });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(0, 14), volumeMl: 200, source: 'udp' });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(2, 9), volumeMl: 400, source: 'udp' });

      const rows = poursByDay(db, 7, NOW);
      const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
      expect(byDate['2026-07-27']).toEqual({ date: '2026-07-27', count: 2, volumeMl: 500 });
      expect(byDate['2026-07-25']).toEqual({ date: '2026-07-25', count: 1, volumeMl: 400 });
      expect(byDate['2026-07-26']).toEqual({ date: '2026-07-26', count: 0, volumeMl: 0 });
    });

    it('excludes pours older than the requested day range', () => {
      const beer = createBeer(db, { name: 'Pils' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(10), volumeMl: 999, source: 'udp' });

      const rows = poursByDay(db, 7, NOW);
      expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(0);
    });

    it('supports the 30 and 90 day ranges', () => {
      expect(poursByDay(db, 30, NOW)).toHaveLength(30);
      expect(poursByDay(db, 90, NOW)).toHaveLength(90);
    });
  });

  describe('hourHistogram', () => {
    it('returns all 24 hours, zero-filled, on an empty DB', () => {
      const rows = hourHistogram(db, NOW);
      expect(rows).toHaveLength(24);
      expect(rows.map((r) => r.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
      expect(rows.every((r) => r.count === 0)).toBe(true);
    });

    it('buckets pours by hour-of-day over the trailing 30 days', () => {
      const beer = createBeer(db, { name: 'Pils' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });

      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(1, 18), volumeMl: 300, source: 'udp' });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(5, 18), volumeMl: 300, source: 'udp' });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(2, 9), volumeMl: 300, source: 'udp' });

      const rows = hourHistogram(db, NOW);
      expect(rows[18]!.count).toBe(2);
      expect(rows[9]!.count).toBe(1);
      expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(3);
    });

    it('excludes pours older than 30 days', () => {
      const beer = createBeer(db, { name: 'Pils' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(31, 12), volumeMl: 300, source: 'udp' });

      const rows = hourHistogram(db, NOW);
      expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(0);
    });
  });

  describe('activeKegStats', () => {
    it('returns an empty array when there are no on_tap kegs', () => {
      expect(activeKegStats(db, NOW)).toEqual([]);
    });

    it('computes levelPct/remainingMl matching the wall\'s own formula and burn/projection math', () => {
      const beer = createBeer(db, { name: 'Citra IPA', srm: 6 });
      const tap = createTap(db, { number: 3 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 20000, tapId: tap.id });

      // 3 pours inside the trailing 7 days: 1000 + 2000 + 3000 = 6000mL -> dailyBurnMl = 6000/7.
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 1000, source: 'udp' });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(3), volumeMl: 2000, source: 'udp' });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(6), volumeMl: 3000, source: 'udp' });
      // Outside the trailing-7d window entirely — must not count toward the burn rate.
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(9), volumeMl: 50000, source: 'udp' });

      const rows = activeKegStats(db, NOW);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.kegId).toBe(keg.id);
      expect(row.beerName).toBe('Citra IPA');
      expect(row.tapNumber).toBe(3);
      expect(row.srm).toBe(6);
      // remainingMl = 20000 - (1000+2000+3000+50000) = -36000 -> clamped to 0.
      expect(row.remainingMl).toBe(0);
      expect(row.levelPct).toBe(0);
      const expectedBurn = Math.round(6000 / 7);
      expect(row.dailyBurnMl).toBe(expectedBurn);
    });

    it('projects a kick date from remaining volume over the daily burn rate', () => {
      const beer = createBeer(db, { name: 'Lager' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });

      // 7000mL dispensed so far, 7000mL burned in the trailing week -> dailyBurnMl = 1000.
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 7000, source: 'udp' });

      const row = activeKegStats(db, NOW)[0]!;
      expect(row.remainingMl).toBe(12000);
      expect(row.dailyBurnMl).toBe(1000);
      // 12000mL remaining / 1000mL per day = 12 days from NOW (2026-07-27) -> 2026-08-08.
      expect(row.projectedKickDate).toBe('2026-08-08');
    });

    it('projectedKickDate is null when the trailing 7-day burn rate is zero', () => {
      const beer = createBeer(db, { name: 'Stout' });
      const tap = createTap(db, { number: 2 });
      createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      // No pours at all -> zero burn rate.
      const row = activeKegStats(db, NOW)[0]!;
      expect(row.dailyBurnMl).toBe(0);
      expect(row.projectedKickDate).toBeNull();
    });

    it('excludes on_deck, kicked, and archived kegs', () => {
      const beer = createBeer(db, { name: 'Saison' });
      const tap = createTap(db, { number: 4 });
      createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id, status: 'on_deck' });
      expect(activeKegStats(db, NOW)).toEqual([]);
    });

    it('orders active kegs by tap number', () => {
      const beer = createBeer(db, { name: 'Beer' });
      const tap5 = createTap(db, { number: 5 });
      const tap1 = createTap(db, { number: 1 });
      createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap5.id });
      createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap1.id });
      const rows = activeKegStats(db, NOW);
      expect(rows.map((r) => r.tapNumber)).toEqual([1, 5]);
    });
  });

  describe('beersByVolume', () => {
    it('returns an empty array on an empty DB', () => {
      expect(beersByVolume(db, 90, NOW)).toEqual([]);
    });

    it('aggregates volume and pour count per beer, descending by volume', () => {
      const ipa = createBeer(db, { name: 'IPA', srm: 8 });
      const stout = createBeer(db, { name: 'Stout', srm: 35 });
      const tap = createTap(db, { number: 1 });
      const ipaKeg = createKeg(db, { beerId: ipa.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      const stoutKeg = createKeg(db, {
        beerId: stout.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id, status: 'on_deck',
      });

      recordPourTx(db, { kegId: ipaKeg.id, ts: isoDaysAgo(1), volumeMl: 300, source: 'udp' });
      recordPourTx(db, { kegId: ipaKeg.id, ts: isoDaysAgo(2), volumeMl: 300, source: 'udp' });
      recordPourTx(db, { kegId: stoutKeg.id, ts: isoDaysAgo(1), volumeMl: 900, source: 'udp' });

      const rows = beersByVolume(db, 90, NOW);
      expect(rows).toEqual([
        { beerName: 'Stout', srm: 35, volumeMl: 900, pourCount: 1 },
        { beerName: 'IPA', srm: 8, volumeMl: 600, pourCount: 2 },
      ]);
    });

    it('excludes pours outside the requested day window', () => {
      const beer = createBeer(db, { name: 'IPA' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(100), volumeMl: 300, source: 'udp' });
      expect(beersByVolume(db, 90, NOW)).toEqual([]);
    });
  });

  describe('leaderboard', () => {
    it('returns an empty array on an empty DB', () => {
      expect(leaderboard(db, 'all', NOW)).toEqual([]);
    });

    it('only counts claimed pours, grouped by drinker, descending by volume', () => {
      const beer = createBeer(db, { name: 'IPA' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      const alice = createDrinker(db, { displayName: 'Alice', avatarColor: '#ff0000' });
      const bob = createDrinker(db, { displayName: 'Bob' });

      recordPourTx(db, {
        kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 300, source: 'udp', drinkerId: alice.id,
      });
      recordPourTx(db, {
        kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 900, source: 'udp', drinkerId: bob.id,
      });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 5000, source: 'udp' }); // unclaimed

      const rows = leaderboard(db, 'all', NOW);
      expect(rows).toEqual([
        { drinkerId: bob.id, displayName: 'Bob', avatarColor: null, pourCount: 1, volumeMl: 900 },
        { drinkerId: alice.id, displayName: 'Alice', avatarColor: '#ff0000', pourCount: 1, volumeMl: 300 },
      ]);
    });

    it('aggregates multiple pours from the same drinker', () => {
      const beer = createBeer(db, { name: 'IPA' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      const alice = createDrinker(db, { displayName: 'Alice' });
      recordPourTx(db, {
        kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 300, source: 'udp', drinkerId: alice.id,
      });
      recordPourTx(db, {
        kegId: keg.id, ts: isoDaysAgo(2), volumeMl: 200, source: 'udp', drinkerId: alice.id,
      });
      const rows = leaderboard(db, 'all', NOW);
      expect(rows).toEqual([{
        drinkerId: alice.id, displayName: 'Alice', avatarColor: null, pourCount: 2, volumeMl: 500,
      }]);
    });

    it('honors the week window (trailing 7 days)', () => {
      const beer = createBeer(db, { name: 'IPA' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      const alice = createDrinker(db, { displayName: 'Alice' });
      recordPourTx(db, {
        kegId: keg.id, ts: isoDaysAgo(3), volumeMl: 300, source: 'udp', drinkerId: alice.id,
      });
      recordPourTx(db, {
        kegId: keg.id, ts: isoDaysAgo(10), volumeMl: 5000, source: 'udp', drinkerId: alice.id,
      });
      const rows = leaderboard(db, 'week', NOW);
      expect(rows).toEqual([{
        drinkerId: alice.id, displayName: 'Alice', avatarColor: null, pourCount: 1, volumeMl: 300,
      }]);
    });

    it('honors the month window (trailing 30 days)', () => {
      const beer = createBeer(db, { name: 'IPA' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      const alice = createDrinker(db, { displayName: 'Alice' });
      recordPourTx(db, {
        kegId: keg.id, ts: isoDaysAgo(20), volumeMl: 300, source: 'udp', drinkerId: alice.id,
      });
      recordPourTx(db, {
        kegId: keg.id, ts: isoDaysAgo(40), volumeMl: 5000, source: 'udp', drinkerId: alice.id,
      });
      const rows = leaderboard(db, 'month', NOW);
      expect(rows).toEqual([{
        drinkerId: alice.id, displayName: 'Alice', avatarColor: null, pourCount: 1, volumeMl: 300,
      }]);
    });
  });
});
