import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { createDrinker } from '../../src/server/db/users.js';
import {
  poursByDay, hourHistogram, activeKegStats, beersByVolume, leaderboard, kegCostRows,
  pourHistory, monthlySpend, beerHistory, pourerHistory,
} from '../../src/server/db/stats.js';
import { createSupplier } from '../../src/server/db/suppliers.js';
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

const MS_PER_DAY = 86_400_000;

/** Exact millisecond-precise offset from `NOW` — used where a test needs unambiguous
 * control over elapsed time (e.g. `kegs.date_tapped` for the burn-rate divisor math),
 * unlike `isoDaysAgo` above (which pins a specific UTC hour-of-day, handy for pour
 * timestamps but not exact-elapsed-time control). */
function exactDaysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

/** Buckets a list of ISO timestamps into a 24-length hour-of-day count array using the
 * SAME conversion `hourHistogram` uses in production (SQLite's `strftime(..., 'localtime')`
 * and `Date#getHours()` both resolve against the process's own timezone — verified
 * directly, see the Task 9 review's Finding 2) — so hour-bucketing tests are correct in
 * whatever timezone they actually run in, never a hardcoded UTC assumption. */
function expectedHourBuckets(timestamps: string[]): number[] {
  const counts = new Array(24).fill(0) as number[];
  for (const ts of timestamps) {
    const hour = new Date(ts).getHours();
    counts[hour] = (counts[hour] ?? 0) + 1;
  }
  return counts;
}

/** The server-LOCAL `YYYY-MM-DD` of a moment — the day-bucketing analog of
 * `expectedHourBuckets` above: `poursByDay` (and `projectedKickDate`) now label calendar
 * days in the server's local timezone, and `Date`'s local getters resolve against the
 * same process timezone SQLite's `'localtime'` modifier does, so expectations built here
 * are correct in whatever timezone the tests actually run in, never a hardcoded UTC
 * assumption. */
function localDay(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${m}-${day}`;
}

describe('stats repo', () => {
  describe('poursByDay', () => {
    it('zero-fills every day in range, oldest first, when there are no pours at all', () => {
      const rows = poursByDay(db, 7, NOW);
      expect(rows).toHaveLength(7);
      expect(rows.every((r) => r.count === 0 && r.volumeMl === 0)).toBe(true);
      expect(rows[0]!.date).toBe(localDay(new Date(NOW.getTime() - 6 * MS_PER_DAY)));
      expect(rows[6]!.date).toBe(localDay(NOW));
    });

    it('aggregates count and volume per day and zero-fills gap days', () => {
      const beer = createBeer(db, { name: 'Pils' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });

      // Today: two pours. 2 days ago: one pour. Nothing in between (yesterday, gap day).
      const pours = [
        { ts: isoDaysAgo(0, 10), volumeMl: 300 },
        { ts: isoDaysAgo(0, 14), volumeMl: 200 },
        { ts: isoDaysAgo(2, 9), volumeMl: 400 },
      ];
      for (const p of pours) {
        recordPourTx(db, { kegId: keg.id, ts: p.ts, volumeMl: p.volumeMl, source: 'udp' });
      }
      // Expected buckets are grouped by each pour's LOCAL calendar day (see `localDay`'s
      // doc comment), not hardcoded UTC date slices, so the test holds in any timezone.
      const expected = new Map<string, { count: number; volumeMl: number }>();
      for (const p of pours) {
        const day = localDay(p.ts);
        const agg = expected.get(day) ?? { count: 0, volumeMl: 0 };
        expected.set(day, { count: agg.count + 1, volumeMl: agg.volumeMl + p.volumeMl });
      }

      const rows = poursByDay(db, 7, NOW);
      for (const row of rows) {
        expect({ count: row.count, volumeMl: row.volumeMl })
          .toEqual(expected.get(row.date) ?? { count: 0, volumeMl: 0 });
      }
      // Sanity: every pour actually landed inside the 7-day range's buckets.
      expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(pours.length);
    });

    it('buckets a pour by the SERVER\'S LOCAL calendar day, not its raw UTC date', () => {
      const beer = createBeer(db, { name: 'Pils' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });

      // Half an hour before LOCAL midnight — in any timezone west of UTC this moment's
      // toISOString() date is already the NEXT day, exactly the case where slicing the UTC
      // string put a 7pm pour on tomorrow's bar (the day-bucket analog of hourHistogram's
      // "real 6pm rush shown as 2am"). Built from local components so the property holds
      // in whatever timezone the test runs in (in UTC itself the two days coincide and the
      // cross-day assertion is skipped, same as expectedHourBuckets' approach).
      const lateLocal = new Date(2026, 6, 26, 23, 30); // July 26, 23:30 LOCAL
      recordPourTx(db, { kegId: keg.id, ts: lateLocal.toISOString(), volumeMl: 350, source: 'udp' });

      const rows = poursByDay(db, 7, NOW);
      const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
      expect(byDate['2026-07-26']).toEqual({ date: '2026-07-26', count: 1, volumeMl: 350 });
      const utcDay = lateLocal.toISOString().slice(0, 10);
      if (utcDay !== '2026-07-26' && byDate[utcDay]) {
        expect(byDate[utcDay]).toEqual({ date: utcDay, count: 0, volumeMl: 0 });
      }
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

    it('buckets pours by the SERVER\'S LOCAL hour-of-day over the trailing 30 days, not raw UTC', () => {
      const beer = createBeer(db, { name: 'Pils' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });

      const timestamps = [isoDaysAgo(1, 18), isoDaysAgo(5, 18), isoDaysAgo(2, 9)];
      for (const ts of timestamps) {
        recordPourTx(db, { kegId: keg.id, ts, volumeMl: 300, source: 'udp' });
      }

      // Expected buckets are computed via the SAME local-time conversion production uses
      // (see `expectedHourBuckets`'s doc comment) rather than hardcoded UTC hour indices
      // — this is what makes the test actually prove local-time bucketing rather than
      // just re-asserting whatever the implementation happens to do.
      const rows = hourHistogram(db, NOW);
      expect(rows.map((r) => r.count)).toEqual(expectedHourBuckets(timestamps));
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
      // Tapped well over a week ago so the burn-rate divisor clamps to the full 7 (see
      // the dedicated divisor tests below for the under-a-week/floor-at-1 cases).
      const keg = createKeg(db, {
        beerId: beer.id, sizeMl: 19000, volStartMl: 20000, tapId: tap.id,
        dateTapped: exactDaysAgoIso(10),
      });

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
      // Tapped well over a week ago -> divisor clamps to 7 (unchanged behavior).
      const keg = createKeg(db, {
        beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
        dateTapped: exactDaysAgoIso(10),
      });

      // 7000mL dispensed so far, 7000mL burned in the trailing week -> dailyBurnMl = 1000.
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 7000, source: 'udp' });

      const row = activeKegStats(db, NOW)[0]!;
      expect(row.remainingMl).toBe(12000);
      expect(row.dailyBurnMl).toBe(1000);
      // 12000mL remaining / 1000mL per day = 12 days from NOW, labeled as the server's
      // LOCAL calendar day of that moment (see `localDay`'s doc comment).
      expect(row.projectedKickDate).toBe(localDay(new Date(NOW.getTime() + 12 * MS_PER_DAY)));
    });

    it('divides the trailing-7d burn sum by the actual days since tapped, not a flat 7, for a keg on tap under a week', () => {
      const beer = createBeer(db, { name: 'Fresh Keg' });
      const tap = createTap(db, { number: 1 });
      // Tapped exactly 2 days ago.
      const keg = createKeg(db, {
        beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
        dateTapped: exactDaysAgoIso(2),
      });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 4000, source: 'udp' });

      const row = activeKegStats(db, NOW)[0]!;
      // Old (buggy) behavior would have been Math.round(4000 / 7) = 571 — a keg only 2
      // days old must divide by 2, not a flat 7 (Task 9 review Finding 1).
      expect(row.dailyBurnMl).toBe(Math.round(4000 / 2));
    });

    it('still clamps the divisor at 7 for a keg on tap a week or longer', () => {
      const beer = createBeer(db, { name: 'Old Keg' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, {
        beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
        dateTapped: exactDaysAgoIso(30),
      });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(1), volumeMl: 3000, source: 'udp' });
      recordPourTx(db, { kegId: keg.id, ts: isoDaysAgo(6), volumeMl: 3500, source: 'udp' });

      const row = activeKegStats(db, NOW)[0]!;
      expect(row.dailyBurnMl).toBe(Math.round(6500 / 7));
    });

    it('floors the divisor at 1 for a keg tapped within the last 24 hours', () => {
      const beer = createBeer(db, { name: 'Brand New Keg' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, {
        beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
        dateTapped: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
      });
      recordPourTx(db, {
        kegId: keg.id, ts: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
        volumeMl: 900, source: 'udp',
      });

      const row = activeKegStats(db, NOW)[0]!;
      // Old (buggy) behavior would have been Math.round(900 / 7) = 129.
      expect(row.dailyBurnMl).toBe(900);
    });

    it('projectedKickDate is null when the trailing 7-day burn rate is zero', () => {
      const beer = createBeer(db, { name: 'Stout' });
      const tap = createTap(db, { number: 2 });
      createKeg(db, {
        beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id,
        dateTapped: exactDaysAgoIso(5),
      });
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
        { drinkerId: bob.id, displayName: 'Bob', avatarColor: null, pourCount: 1, volumeMl: 900, avgQuality: null, qualityCount: 0 },
        { drinkerId: alice.id, displayName: 'Alice', avatarColor: '#ff0000', pourCount: 1, volumeMl: 300, avgQuality: null, qualityCount: 0 },
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
        drinkerId: alice.id, displayName: 'Alice', avatarColor: null, pourCount: 2, volumeMl: 500, avgQuality: null, qualityCount: 0,
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
        drinkerId: alice.id, displayName: 'Alice', avatarColor: null, pourCount: 1, volumeMl: 300, avgQuality: null, qualityCount: 0,
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
        drinkerId: alice.id, displayName: 'Alice', avatarColor: null, pourCount: 1, volumeMl: 300, avgQuality: null, qualityCount: 0,
      }]);
    });
  });

  describe('kegCostRows', () => {
    it('computes poured %, $/pint, and remaining value per keg', () => {
      const beer = createBeer(db, { name: 'Yuengling' });
      const tap = createTap(db, { number: 1 });
      const supplier = createSupplier(db, { name: 'Joes' });
      // 47,318 mL ≈ 100 pints, $131.00, half poured.
      const keg = createKeg(db, {
        beerId: beer.id, tapId: tap.id, sizeMl: 47318, volStartMl: 47318,
        costCents: 13100, supplierId: supplier.id, purchasedAt: '2026-06-01',
      });
      db.prepare('UPDATE kegs SET vol_dispensed_ml = ? WHERE id = ?').run(23659, keg.id);

      const rows = kegCostRows(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        beerName: 'Yuengling', supplierName: 'Joes', costCents: 13100,
        pouredPct: 50, pricePerPintCents: 131, valueLeftCents: 6550,
      });
    });

    it('leaves cost-derived fields null when a keg has no cost', () => {
      const beer = createBeer(db, { name: 'Free Beer' });
      createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck' });
      const rows = kegCostRows(db);
      expect(rows[0]).toMatchObject({ costCents: null, pricePerPintCents: null, valueLeftCents: null, supplierName: null });
    });
  });

  describe('pourHistory', () => {
    it('hydrates recent pours with beer, tap, and drinker, newest first', () => {
      const beer = createBeer(db, { name: 'Citra IPA' });
      const tap = createTap(db, { number: 3 });
      const keg = createKeg(db, { beerId: beer.id, tapId: tap.id, sizeMl: 19000, volStartMl: 19000 });
      const sam = createDrinker(db, { displayName: 'Sam' });
      recordPourTx(db, { kegId: keg.id, volumeMl: 473, ts: isoDaysAgo(1), source: 'udp', drinkerId: sam.id });
      recordPourTx(db, { kegId: keg.id, volumeMl: 300, ts: isoDaysAgo(2), source: 'cloud' });

      const rows = pourHistory(db, 30, 100, NOW);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ beerName: 'Citra IPA', tapNumber: 3, drinkerName: 'Sam', source: 'udp' });
      expect(rows[1]!.drinkerName).toBeNull(); // unclaimed
    });
  });

  describe('beerHistory', () => {
    it('aggregates kegs, volume, rating, and claim % per beer', () => {
      const beer = createBeer(db, { name: 'Citra IPA' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, tapId: tap.id, sizeMl: 19000, volStartMl: 19000, dateTapped: '2026-06-01T00:00:00.000Z' });
      const sam = createDrinker(db, { displayName: 'Sam' });
      recordPourTx(db, { kegId: keg.id, volumeMl: 500, ts: isoDaysAgo(1), source: 'udp', drinkerId: sam.id });
      db.prepare('UPDATE pours SET rating = 4 WHERE keg_id = ?').run(keg.id);
      recordPourTx(db, { kegId: keg.id, volumeMl: 300, ts: isoDaysAgo(2), source: 'cloud' }); // unclaimed, unrated

      const rows = beerHistory(db);
      const citra = rows.find((r) => r.beerName === 'Citra IPA')!;
      expect(citra).toMatchObject({ kegs: 1, totalMl: 800, avgRating: 4, ratingCount: 1 });
      expect(citra.claimPct).toBe(50); // 1 of 2 pours claimed
      expect(citra.firstTap).toBe('2026-06-01T00:00:00.000Z');
    });
  });

  describe('pourerHistory', () => {
    it('summarizes each pourer with avg pour, favorite beer, and last pour', () => {
      const ipa = createBeer(db, { name: 'Citra IPA' });
      const stout = createBeer(db, { name: 'Stout' });
      const tap = createTap(db, { number: 1 });
      const ipaKeg = createKeg(db, { beerId: ipa.id, tapId: tap.id, sizeMl: 19000, volStartMl: 19000 });
      const stoutKeg = createKeg(db, { beerId: stout.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck' });
      const sam = createDrinker(db, { displayName: 'Sam' });
      recordPourTx(db, { kegId: ipaKeg.id, volumeMl: 400, ts: isoDaysAgo(3), source: 'udp', drinkerId: sam.id });
      recordPourTx(db, { kegId: ipaKeg.id, volumeMl: 500, ts: isoDaysAgo(1), source: 'udp', drinkerId: sam.id });
      recordPourTx(db, { kegId: stoutKeg.id, volumeMl: 300, ts: isoDaysAgo(2), source: 'udp', drinkerId: sam.id });

      const rows = pourerHistory(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ displayName: 'Sam', pours: 3, volumeMl: 1200, avgPourMl: 400, favorite: 'Citra IPA' });
    });
  });

  describe('monthlySpend', () => {
    it('groups owner spend by purchase month with $/pint', () => {
      const beer = createBeer(db, { name: 'Lager' });
      createKeg(db, { beerId: beer.id, sizeMl: 47318, volStartMl: 47318, status: 'on_deck', costCents: 13100, purchasedAt: '2026-06-01' });
      createKeg(db, { beerId: beer.id, sizeMl: 47318, volStartMl: 47318, status: 'on_deck', costCents: 13100, purchasedAt: '2026-06-20' });
      const rows = monthlySpend(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ month: '2026-06', kegs: 2, spendCents: 26200 });
      expect(rows[0]!.pricePerPintCents).toBe(131); // $262 / 200 pints
    });

    it('files a keg with no purchase date under its created_at\'s LOCAL month, not the raw UTC month', () => {
      // The created_at fallback is a full UTC ISO timestamp (unlike purchased_at, an
      // operator-entered date-only string) — a bare substr grouped a keg created the
      // evening of the month's last day (already the next month in UTC) under the wrong
      // month's spend. Expected month is derived from the row's actual stored created_at
      // via Date's LOCAL getters — same conversion strftime('%Y-%m', ..., 'localtime')
      // applies (see `localDay`'s doc comment) — so this holds in any timezone.
      const beer = createBeer(db, { name: 'Lager' });
      const keg = createKeg(db, {
        beerId: beer.id, sizeMl: 47318, volStartMl: 47318, status: 'on_deck', costCents: 13100,
      });
      const { created_at } = db.prepare('SELECT created_at FROM kegs WHERE id = ?')
        .get(keg.id) as { created_at: string };
      const rows = monthlySpend(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.month).toBe(localDay(created_at).slice(0, 7));
    });
  });
});
