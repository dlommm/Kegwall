import type Database from 'better-sqlite3';

/**
 * Task 9 (admin Stats page): five read-only aggregation queries over pours/kegs/beers/
 * users. Every function takes an optional `now` (defaulting to `new Date()`) purely so
 * tests can pin "the current moment" and build fixture timestamps as exact offsets from
 * it — production call sites (routes/stats.ts) never pass it, so they always aggregate
 * against the real wall clock.
 *
 * `pours.ts` stores `ts` as a `Date#toISOString()` string (`YYYY-MM-DDTHH:MM:SS.sssZ`,
 * always UTC/"Z"). Day bucketing (`poursByDay`) is done in JS via a plain substring slice
 * of that fixed-width string — simple, exact, UTC by construction. Hour-of-day bucketing
 * (`hourHistogram`) is different: see that function's own doc comment for why it converts
 * to the server's LOCAL hour instead (Task 9 review, Finding 2).
 */

const MS_PER_DAY = 86_400_000;

export interface PoursByDay {
  /** `YYYY-MM-DD`, UTC calendar day. */
  date: string;
  count: number;
  volumeMl: number;
}

export interface HourHistogram {
  /** The server's LOCAL hour-of-day, 0-23 — see `hourHistogram`'s doc comment. */
  hour: number;
  count: number;
}

export interface KegBurnStat {
  kegId: number;
  beerName: string;
  tapNumber: number;
  srm: number | null;
  levelPct: number;
  remainingMl: number;
  /** Average mL/day from pours recorded against this keg in the trailing 7 days,
   * divided by however many of those 7 days the keg has actually been tapped (clamped
   * to 1-7) — see `activeKegStats`'s doc comment for why. */
  dailyBurnMl: number;
  /** `YYYY-MM-DD`, or `null` when `dailyBurnMl` is 0 (nothing to project from). */
  projectedKickDate: string | null;
}

export interface BeerVolumeStat {
  beerName: string;
  srm: number | null;
  volumeMl: number;
  pourCount: number;
}

export interface LeaderboardEntry {
  drinkerId: number;
  displayName: string;
  avatarColor: string | null;
  pourCount: number;
  volumeMl: number;
}

/**
 * `GET /api/stats/pours` — pour count + volume per UTC calendar day, over the trailing
 * `days` days INCLUDING today, oldest first. Days with no pours are zero-filled (the
 * plan's "fill gap days with zeros") so the client's bar chart never has to special-case
 * a missing entry.
 */
export function poursByDay(db: Database.Database, days: number, now = new Date()): PoursByDay[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    dates.push(new Date(now.getTime() - i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  const cutoff = `${dates[0]}T00:00:00.000Z`;
  const rows = db.prepare('SELECT ts, volume_ml FROM pours WHERE ts >= ?').all(cutoff) as
    { ts: string; volume_ml: number }[];

  const byDate = new Map<string, { count: number; volumeMl: number }>();
  for (const date of dates) byDate.set(date, { count: 0, volumeMl: 0 });
  for (const row of rows) {
    const bucket = byDate.get(row.ts.slice(0, 10));
    if (bucket) {
      bucket.count += 1;
      bucket.volumeMl += row.volume_ml;
    }
  }
  return dates.map((date) => ({ date, ...byDate.get(date)! }));
}

/**
 * `GET /api/stats/hours` — pour count by hour-of-day (0-23) over the trailing 30 days,
 * every hour present even when its count is 0 (same zero-fill rationale as
 * `poursByDay`).
 *
 * Bucketed in the SERVER's LOCAL timezone, not raw UTC (Task 9 review, Finding 2): this
 * app is self-hosted on a LAN box, and the server's own clock/timezone
 * IS the taproom's — bucketing by UTC instead silently mislabeled a real 6pm rush as
 * "2am" for any non-UTC install, with no indication anything was off. SQLite's
 * `strftime(..., 'localtime')` modifier converts using the process's own timezone (`TZ`
 * env var, or the OS default when unset) — the SAME timezone Node's own `Date` methods
 * (e.g. `Date#getHours()`) resolve against, since both ultimately read the same
 * OS/ICU timezone database for this one process. That equivalence is what
 * `tests/db/stats.test.ts`'s `expectedHourBuckets` helper leans on: it computes expected
 * buckets via `Date#getHours()` rather than a hardcoded hour, so the test is correct in
 * whatever timezone it actually runs in, not just the one this was written in.
 */
export function hourHistogram(db: Database.Database, now = new Date()): HourHistogram[] {
  const cutoff = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();
  const rows = db.prepare(`
    SELECT CAST(strftime('%H', ts, 'localtime') AS INTEGER) AS hour, COUNT(*) AS count
    FROM pours WHERE ts >= ? GROUP BY hour
  `).all(cutoff) as { hour: number; count: number }[];
  const counts = new Array(24).fill(0) as number[];
  for (const row of rows) {
    if (Number.isInteger(row.hour) && row.hour >= 0 && row.hour < 24) counts[row.hour] = row.count;
  }
  return counts.map((count, hour) => ({ hour, count }));
}

/**
 * `GET /api/stats/kegs` — every currently-`on_tap` keg's level, remaining volume, a
 * burn rate, and a projected kick date.
 *
 * `dailyBurnMl` sums this keg's pours from the trailing 7 days and divides by
 * `min(7, max(1, daysSinceTapped))` — NOT a flat 7 (Task 9 review, Finding 1: a flat-7
 * divisor systematically UNDERSTATES the burn rate, and so OVERSTATES the projected kick
 * date, for any keg tapped less than a week ago — e.g. a keg tapped 2 days ago that's
 * already poured 4000mL reads as a leisurely 571mL/day flat-7, when the honest number is
 * 2000mL/day). `daysSinceTapped` is `Math.ceil` of the elapsed time from `kegs.date_tapped`
 * to `now` in days — `ceil` rather than `floor`/round means even a keg tapped minutes ago
 * still divides by (at least) 1, never by a near-zero fraction that would spike the rate
 * to something absurd; the `max(1, ...)` clamp is the same floor, belt-and-suspenders.
 * The `min(7, ...)` clamp caps it at the full week once a keg has been tapped that long,
 * matching the previous (correct in that one case) behavior exactly.
 *
 * `levelPct`/`remainingMl` use the exact same formula as `core/state.ts`'s
 * `getTapStates()` (kept in sync deliberately — this is the same number the wall/
 * dashboard already show, just re-derived here since that function returns a live
 * `TapState`, not a bare aggregation).
 */
export function activeKegStats(db: Database.Database, now = new Date()): KegBurnStat[] {
  const rows = db.prepare(`
    SELECT k.id AS keg_id, b.name AS beer_name, b.srm AS srm, t.number AS tap_number,
           k.vol_start_ml AS vol_start_ml, k.vol_dispensed_ml AS vol_dispensed_ml,
           k.date_tapped AS date_tapped
    FROM kegs k
    JOIN beers b ON b.id = k.beer_id
    JOIN taps t ON t.id = k.tap_id
    WHERE k.status = 'on_tap'
    ORDER BY t.number
  `).all() as {
    keg_id: number; beer_name: string; srm: number | null; tap_number: number;
    vol_start_ml: number; vol_dispensed_ml: number; date_tapped: string | null;
  }[];

  const burnCutoff = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString();
  const burnStmt = db.prepare(
    'SELECT COALESCE(SUM(volume_ml), 0) AS total FROM pours WHERE keg_id = ? AND ts >= ?',
  );

  return rows.map((r): KegBurnStat => {
    const levelPct = r.vol_start_ml > 0
      ? Math.max(0, Math.min(100,
          Math.round(((r.vol_start_ml - r.vol_dispensed_ml) / r.vol_start_ml) * 1000) / 10))
      : 0;
    const remainingMl = Math.max(0, r.vol_start_ml - r.vol_dispensed_ml);
    const { total } = burnStmt.get(r.keg_id, burnCutoff) as { total: number };
    // `createKeg` always stamps `date_tapped` on insert (see db/kegs.ts), so a `null`
    // here would only ever come from a malformed/legacy row — fall back to the full
    // trailing window (the old, pre-fix behavior) rather than dividing by a bogus value.
    const daysSinceTapped = r.date_tapped
      ? Math.ceil((now.getTime() - new Date(r.date_tapped).getTime()) / MS_PER_DAY)
      : 7;
    const burnDivisor = Math.min(7, Math.max(1, daysSinceTapped));
    const dailyBurnMl = Math.round(total / burnDivisor);
    const projectedKickDate = dailyBurnMl > 0
      ? new Date(now.getTime() + (remainingMl / dailyBurnMl) * MS_PER_DAY).toISOString().slice(0, 10)
      : null;
    return {
      kegId: r.keg_id, beerName: r.beer_name, tapNumber: r.tap_number, srm: r.srm,
      levelPct, remainingMl, dailyBurnMl, projectedKickDate,
    };
  });
}

/**
 * `GET /api/stats/beers` — total volume + pour count per beer over the trailing `days`
 * days, descending by volume. Aggregated from EVERY pour recorded against a beer's kegs
 * in the window regardless of keg status (on_tap/kicked/on_deck/archived) — this is a
 * historical "what did people drink" stat, not the "what's live right now" list
 * `activeKegStats` already covers. A beer with no pours in the window simply doesn't
 * appear (the join naturally excludes it) rather than showing a zero row.
 */
export function beersByVolume(db: Database.Database, days: number, now = new Date()): BeerVolumeStat[] {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY).toISOString();
  const rows = db.prepare(`
    SELECT b.name AS beer_name, b.srm AS srm,
           COALESCE(SUM(p.volume_ml), 0) AS volume_ml, COUNT(p.id) AS pour_count
    FROM pours p
    JOIN kegs k ON k.id = p.keg_id
    JOIN beers b ON b.id = k.beer_id
    WHERE p.ts >= ?
    GROUP BY b.id
    ORDER BY volume_ml DESC
  `).all(cutoff) as { beer_name: string; srm: number | null; volume_ml: number; pour_count: number }[];
  return rows.map((r) => ({
    beerName: r.beer_name, srm: r.srm, volumeMl: r.volume_ml, pourCount: r.pour_count,
  }));
}

const LEADERBOARD_WINDOW_DAYS: Record<'week' | 'month', number> = { week: 7, month: 30 };

/**
 * `GET /api/stats/leaderboard` — pour count + volume per drinker, claimed pours only
 * (`drinker_id IS NOT NULL` — an unclaimed pour has no drinker to credit), descending by
 * volume. `'week'`/`'month'` are trailing 7/30-day windows from `now` (matching
 * `activeKegStats`'s trailing-7-day burn rate, not a calendar week/month); `'all'` is
 * unbounded.
 */
export function leaderboard(
  db: Database.Database, window: 'week' | 'month' | 'all', now = new Date(),
): LeaderboardEntry[] {
  const clauses = ['p.drinker_id IS NOT NULL'];
  const params: unknown[] = [];
  if (window !== 'all') {
    clauses.push('p.ts >= ?');
    params.push(new Date(now.getTime() - LEADERBOARD_WINDOW_DAYS[window] * MS_PER_DAY).toISOString());
  }
  const rows = db.prepare(`
    SELECT u.id AS drinker_id, u.display_name AS display_name, u.avatar_color AS avatar_color,
           COUNT(p.id) AS pour_count, COALESCE(SUM(p.volume_ml), 0) AS volume_ml
    FROM pours p
    JOIN users u ON u.id = p.drinker_id
    WHERE ${clauses.join(' AND ')}
    GROUP BY u.id
    ORDER BY volume_ml DESC
  `).all(...params) as {
    drinker_id: number; display_name: string; avatar_color: string | null;
    pour_count: number; volume_ml: number;
  }[];
  return rows.map((r) => ({
    drinkerId: r.drinker_id, displayName: r.display_name, avatarColor: r.avatar_color,
    pourCount: r.pour_count, volumeMl: r.volume_ml,
  }));
}
