import type Database from 'better-sqlite3';

/**
 * Task 9 (admin Stats page): five read-only aggregation queries over pours/kegs/beers/
 * users. Every function takes an optional `now` (defaulting to `new Date()`) purely so
 * tests can pin "the current moment" and build fixture timestamps as exact offsets from
 * it — production call sites (routes/stats.ts) never pass it, so they always aggregate
 * against the real wall clock.
 *
 * `pours.ts` stores `ts` as a `Date#toISOString()` string (`YYYY-MM-DDTHH:MM:SS.sssZ`,
 * always UTC/"Z"). Every CALENDAR bucketing over those timestamps — hour-of-day
 * (`hourHistogram`), calendar day (`poursByDay`), day labels (`projectedKickDate`) —
 * converts to the server's LOCAL timezone first: see `hourHistogram`'s doc comment for
 * the full rationale (Task 9 review, Finding 2). Rolling trailing-N-day WINDOWS, by
 * contrast, stay plain UTC instant comparisons — a window boundary is a moment, not a
 * calendar label, so no conversion applies.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Formats a moment as the server's LOCAL `YYYY-MM-DD` — the day-label counterpart of
 * `hourHistogram`'s localtime hour bucketing (same rationale, see its doc comment).
 * `Date`'s local getters resolve against the same process timezone SQLite's
 * `'localtime'` modifier uses, so JS-side labels and SQL-side `date(ts, 'localtime')`
 * buckets always agree.
 */
function localDayStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface PoursByDay {
  /** `YYYY-MM-DD`, the server's LOCAL calendar day — see `poursByDay`. */
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
  /** `YYYY-MM-DD` (server-LOCAL calendar day, same convention as `poursByDay`), or
   * `null` when `dailyBurnMl` is 0 (nothing to project from). */
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
  /** Mean pour-quality score (see core/pourQuality.ts) over the drinker's SCORED pours
   * in the window, rounded; null when none of their pours carries a score. */
  avgQuality: number | null;
  /** How many of the drinker's pours in the window carry a quality score — lets
   * consumers require a minimum sample size before crowning "smoothest pour". */
  qualityCount: number;
}

/**
 * `GET /api/stats/pours` — pour count + volume per LOCAL calendar day, over the trailing
 * `days` days INCLUDING today, oldest first. Days with no pours are zero-filled (the
 * plan's "fill gap days with zeros") so the client's bar chart never has to special-case
 * a missing entry.
 *
 * Bucketed in the SERVER's LOCAL timezone via `date(ts, 'localtime')`, not by slicing the
 * UTC `ts` string — the same class of bug `hourHistogram` fixes for hour-of-day (Task 9
 * review, Finding 2): sliced by UTC, a 7pm Friday pour in PDT (02:00Z Saturday) silently
 * landed on SATURDAY's bar for any non-UTC install. The zero-fill labels are built with
 * `localDayStr` (see above) so they land in the exact same buckets SQLite produces.
 */
export function poursByDay(db: Database.Database, days: number, now = new Date()): PoursByDay[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    dates.push(localDayStr(new Date(now.getTime() - i * MS_PER_DAY)));
  }
  const rows = db.prepare(`
    SELECT date(ts, 'localtime') AS day, COUNT(*) AS count,
           COALESCE(SUM(volume_ml), 0) AS volume_ml
    FROM pours WHERE date(ts, 'localtime') >= ? GROUP BY day
  `).all(dates[0]) as { day: string; count: number; volume_ml: number }[];

  const byDate = new Map<string, { count: number; volumeMl: number }>();
  for (const date of dates) byDate.set(date, { count: 0, volumeMl: 0 });
  for (const row of rows) {
    const bucket = byDate.get(row.day);
    if (bucket) {
      bucket.count = row.count;
      bucket.volumeMl = row.volume_ml;
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
 * The burn-rate kick projection shared by `activeKegStats` (admin) and the live tap snapshot
 * (Kegwall V2 walls: "kicks in ~3 days"). See `activeKegStats` for why the divisor is
 * `min(7, max(1, daysSinceTapped))` rather than a flat 7.
 */
export function projectKick(input: {
  remainingMl: number; burnLast7DaysMl: number; dateTapped: string | null; now: Date;
}): { dailyBurnMl: number; projectedKickDate: string | null } {
  const { remainingMl, burnLast7DaysMl, dateTapped, now } = input;
  // `createKeg` always stamps `date_tapped` on insert (see db/kegs.ts), so a `null`
  // here would only ever come from a malformed/legacy row — fall back to the full
  // trailing window (the old, pre-fix behavior) rather than dividing by a bogus value.
  const daysSinceTapped = dateTapped
    ? Math.ceil((now.getTime() - new Date(dateTapped).getTime()) / MS_PER_DAY)
    : 7;
  const burnDivisor = Math.min(7, Math.max(1, daysSinceTapped));
  const dailyBurnMl = Math.round(burnLast7DaysMl / burnDivisor);
  // localDayStr, not a toISOString() slice — the UTC date of an evening-local moment is
  // already tomorrow, which read as a kick date one day late (same UTC-vs-local class as
  // poursByDay/hourHistogram).
  const projectedKickDate = dailyBurnMl > 0
    ? localDayStr(new Date(now.getTime() + (remainingMl / dailyBurnMl) * MS_PER_DAY))
    : null;
  return { dailyBurnMl, projectedKickDate };
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
    const { dailyBurnMl, projectedKickDate } = projectKick({
      remainingMl, burnLast7DaysMl: total, dateTapped: r.date_tapped, now,
    });
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
           COUNT(p.id) AS pour_count, COALESCE(SUM(p.volume_ml), 0) AS volume_ml,
           AVG(p.quality) AS avg_quality, COUNT(p.quality) AS quality_count
    FROM pours p
    JOIN users u ON u.id = p.drinker_id
    WHERE ${clauses.join(' AND ')}
    GROUP BY u.id
    ORDER BY volume_ml DESC
  `).all(...params) as {
    drinker_id: number; display_name: string; avatar_color: string | null;
    pour_count: number; volume_ml: number; avg_quality: number | null; quality_count: number;
  }[];
  return rows.map((r) => ({
    drinkerId: r.drinker_id, displayName: r.display_name, avatarColor: r.avatar_color,
    pourCount: r.pour_count, volumeMl: r.volume_ml,
    avgQuality: r.avg_quality != null ? Math.round(r.avg_quality) : null,
    qualityCount: r.quality_count,
  }));
}

export interface BiggestClaimedPour {
  drinkerId: number;
  displayName: string;
  volumeMl: number;
  ts: string;
}

/** The single largest claimed pour in the window — the leaderboard footer's
 * "biggest pour" superlative. Null when no claimed pours exist in the window. */
export function biggestClaimedPour(
  db: Database.Database, window: 'week' | 'month' | 'all', now = new Date(),
): BiggestClaimedPour | null {
  const clauses = ['p.drinker_id IS NOT NULL'];
  const params: unknown[] = [];
  if (window !== 'all') {
    clauses.push('p.ts >= ?');
    params.push(new Date(now.getTime() - LEADERBOARD_WINDOW_DAYS[window] * MS_PER_DAY).toISOString());
  }
  const r = db.prepare(`
    SELECT p.drinker_id AS drinker_id, u.display_name AS display_name,
           p.volume_ml AS volume_ml, p.ts AS ts
    FROM pours p
    JOIN users u ON u.id = p.drinker_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY p.volume_ml DESC
    LIMIT 1
  `).get(...params) as {
    drinker_id: number; display_name: string; volume_ml: number; ts: string;
  } | undefined;
  return r ? {
    drinkerId: r.drinker_id, displayName: r.display_name, volumeMl: r.volume_ml, ts: r.ts,
  } : null;
}

// --- Pour Wall overhaul Phase 6: Analytics KPIs + busiest-hours heatmap ------

export interface AnalyticsKpis {
  pours: number;
  volumeMl: number;
  /** Kegs kicked inside the window (by `kicked_at`; kegs kicked before migration 024 carry
   * their last pour's time). */
  kegsKicked: number;
  avgQuality: number | null;
  /** Mean cost of a pint over the window's pours, from keg cost tracking
   * (design 6d) — null when no poured-from keg in the window has a cost. */
  costPerPintCents: number | null;
  /** Remaining-beer value across every on-tap keg with a cost. `analyticsKpis()` always
   * computes a number; null only ever appears ON THE WIRE, when routes/featurePack.ts
   * redacts the money KPIs for viewer accounts (pricing.showCostsToViewers off). */
  valueOnTapCents: number | null;
}

/** The Analytics page's KPI row (design 10a), over the trailing `days` window. */
export function analyticsKpis(db: Database.Database, days: number, now = new Date()): AnalyticsKpis {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY).toISOString();
  const totals = db.prepare(
    'SELECT COUNT(*) c, COALESCE(SUM(volume_ml), 0) v, AVG(quality) q FROM pours WHERE ts >= ?',
  ).get(cutoff) as { c: number; v: number; q: number | null };
  const kicked = (db.prepare(
    `SELECT COUNT(*) c FROM kegs WHERE status = 'kicked' AND kicked_at >= ?`,
  ).get(cutoff) as { c: number }).c;
  const cost = db.prepare(`
    SELECT SUM(p.volume_ml * 1.0 / k.vol_start_ml * k.cost_cents) AS spent_cents,
           SUM(p.volume_ml) AS costed_ml
    FROM pours p JOIN kegs k ON k.id = p.keg_id
    WHERE p.ts >= ? AND k.cost_cents IS NOT NULL AND k.vol_start_ml > 0
  `).get(cutoff) as { spent_cents: number | null; costed_ml: number | null };
  const ML_PER_PINT_LOCAL = 473.176;
  const costPerPintCents = cost.spent_cents != null && cost.costed_ml && cost.costed_ml > 0
    ? Math.round(cost.spent_cents / (cost.costed_ml / ML_PER_PINT_LOCAL))
    : null;
  const valueOnTap = db.prepare(`
    SELECT COALESCE(SUM(MAX(0, (vol_start_ml - vol_dispensed_ml)) * 1.0 / vol_start_ml * cost_cents), 0) v
    FROM kegs WHERE status = 'on_tap' AND cost_cents IS NOT NULL AND vol_start_ml > 0
  `).get() as { v: number };
  return {
    pours: totals.c,
    volumeMl: totals.v,
    kegsKicked: kicked,
    avgQuality: totals.q != null ? Math.round(totals.q) : null,
    costPerPintCents,
    valueOnTapCents: Math.round(valueOnTap.v),
  };
}

/** Lifetime per-beer stats for the analytics Beers tab's Beer-history table (redesign 4e/4j).
 *  Viewer-safe (no owner cost). */
export interface BeerHistoryRow {
  beerId: number;
  beerName: string;
  firstTap: string | null;
  kegs: number;
  totalMl: number;
  avgRating: number | null;
  ratingCount: number;
  /** % of this beer's pours that were claimed by a drinker, or null when it had no pours. */
  claimPct: number | null;
}

export function beerHistory(db: Database.Database): BeerHistoryRow[] {
  const rows = db.prepare(`
    SELECT b.id AS beerId, b.name AS beerName,
           MIN(k.date_tapped) AS firstTap,
           COUNT(DISTINCT k.id) AS kegs,
           COALESCE(SUM(p.volume_ml), 0) AS totalMl,
           AVG(p.rating) AS avgRating,
           SUM(CASE WHEN p.rating IS NOT NULL THEN 1 ELSE 0 END) AS ratingCount,
           SUM(CASE WHEN p.drinker_id IS NOT NULL THEN 1 ELSE 0 END) AS claimedPours,
           COUNT(p.id) AS totalPours
    FROM beers b
    LEFT JOIN kegs k ON k.beer_id = b.id
    LEFT JOIN pours p ON p.keg_id = k.id
    GROUP BY b.id
    HAVING kegs > 0 OR totalPours > 0
    ORDER BY totalMl DESC, b.name COLLATE NOCASE
  `).all() as any[];
  return rows.map((r) => ({
    beerId: r.beerId,
    beerName: r.beerName,
    firstTap: r.firstTap ?? null,
    kegs: r.kegs,
    totalMl: r.totalMl,
    avgRating: r.avgRating != null ? Math.round(r.avgRating * 10) / 10 : null,
    ratingCount: r.ratingCount,
    claimPct: r.totalPours > 0 ? Math.round((r.claimedPours / r.totalPours) * 100) : null,
  }));
}

/** A single pour, hydrated with its beer / tap / drinker, for the analytics Pours-history
 *  table (redesign 4e/4j). No owner cost — viewer-safe. */
export interface PourHistoryRow {
  id: number;
  ts: string;
  tapNumber: number | null;
  beerName: string;
  drinkerName: string | null;
  volumeMl: number;
  quality: number | null;
  source: string;
}

/** Lifetime per-pourer stats for the analytics People tab's Pourer-history table (redesign
 *  4e/4j). Claimed pours only. Viewer-safe. */
export interface PourerHistoryRow {
  drinkerId: number;
  displayName: string;
  pours: number;
  volumeMl: number;
  avgPourMl: number;
  avgQuality: number | null;
  favorite: string | null;
  lastPour: string | null;
}

export function pourerHistory(db: Database.Database): PourerHistoryRow[] {
  const rows = db.prepare(`
    SELECT u.id AS drinkerId, u.display_name AS displayName,
           COUNT(p.id) AS pours, COALESCE(SUM(p.volume_ml), 0) AS volumeMl,
           AVG(p.quality) AS avgQuality, MAX(p.ts) AS lastPour,
           (SELECT b2.name FROM pours p2
              JOIN kegs k2 ON k2.id = p2.keg_id
              JOIN beers b2 ON b2.id = k2.beer_id
             WHERE p2.drinker_id = u.id
             GROUP BY b2.id ORDER BY COUNT(*) DESC, b2.name COLLATE NOCASE LIMIT 1) AS favorite
    FROM users u
    JOIN pours p ON p.drinker_id = u.id
    WHERE u.is_drinker = 1
    GROUP BY u.id
    HAVING pours > 0
    ORDER BY volumeMl DESC, u.display_name COLLATE NOCASE
  `).all() as any[];
  return rows.map((r) => ({
    drinkerId: r.drinkerId,
    displayName: r.displayName,
    pours: r.pours,
    volumeMl: r.volumeMl,
    avgPourMl: r.pours > 0 ? Math.round(r.volumeMl / r.pours) : 0,
    avgQuality: r.avgQuality != null ? Math.round(r.avgQuality) : null,
    favorite: r.favorite ?? null,
    lastPour: r.lastPour ?? null,
  }));
}

/** Recent pours (newest first) over the trailing `days` window, capped at `limit`. */
export function pourHistory(
  db: Database.Database, days: number, limit = 200, now = new Date(),
): PourHistoryRow[] {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY).toISOString();
  return db.prepare(`
    SELECT p.id AS id, p.ts AS ts, t.number AS tapNumber, b.name AS beerName,
           u.display_name AS drinkerName, p.volume_ml AS volumeMl, p.quality AS quality,
           p.source AS source
    FROM pours p
    JOIN kegs k ON k.id = p.keg_id
    JOIN beers b ON b.id = k.beer_id
    LEFT JOIN taps t ON t.id = k.tap_id
    LEFT JOIN users u ON u.id = p.drinker_id
    WHERE p.ts >= ?
    ORDER BY p.ts DESC
    LIMIT ?
  `).all(cutoff, limit).map((r: any) => ({
    id: r.id,
    ts: r.ts,
    tapNumber: r.tapNumber ?? null,
    beerName: r.beerName,
    drinkerName: r.drinkerName ?? null,
    volumeMl: r.volumeMl,
    quality: r.quality ?? null,
    source: r.source,
  }));
}

/** Monthly keg spend row for the analytics Kegs & cost tab (redesign 4e/4j). OWNER COST —
 *  admin-only route. */
export interface MonthlySpendRow {
  month: string;
  kegs: number;
  spendCents: number;
  pricePerPintCents: number | null;
}

/** Owner spend grouped by purchase month (YYYY-MM), newest first, over all history.
 *
 * `purchased_at` is an operator-entered date-only string (the swap wizard's
 * `<input type="date">`) — already a local calendar date, so its month is a plain substr;
 * running it through `'localtime'` would treat it as midnight UTC and shift it back a day
 * (and at month boundaries, a month) in any west-of-UTC timezone. The `created_at`
 * fallback is a full UTC ISO timestamp, so IT gets the localtime conversion — a bare
 * substr filed a keg created the evening of July 31 local (already Aug 1 in UTC) under
 * August's spend (same UTC-vs-local class as `poursByDay`/`hourHistogram`). */
export function monthlySpend(db: Database.Database): MonthlySpendRow[] {
  const ML_PER_PINT_LOCAL = 473.176;
  const rows = db.prepare(`
    SELECT COALESCE(substr(purchased_at, 1, 7), strftime('%Y-%m', created_at, 'localtime')) AS month,
           COUNT(*) AS kegs,
           COALESCE(SUM(cost_cents), 0) AS spendCents,
           COALESCE(SUM(size_ml), 0) AS totalMl
    FROM kegs
    WHERE cost_cents IS NOT NULL
    GROUP BY month
    ORDER BY month DESC
  `).all() as any[];
  return rows.map((r) => {
    const pints = r.totalMl / ML_PER_PINT_LOCAL;
    return {
      month: r.month,
      kegs: r.kegs,
      spendCents: r.spendCents,
      pricePerPintCents: pints > 0 ? Math.round(r.spendCents / pints) : null,
    };
  });
}

/** Per-keg cost row for the analytics Kegs & cost tab (redesign 4e/4j). Carries OWNER COST —
 *  its route is admin-only; never serialize this to a public surface. */
export interface KegCostRow {
  kegId: number;
  beerName: string;
  supplierName: string | null;
  status: string;
  costCents: number | null;
  depositCents: number | null;
  sizeMl: number;
  volStartMl: number;
  volDispensedMl: number;
  purchasedAt: string | null;
  dateTapped: string | null;
  /** % of the keg's starting volume that's been poured. */
  pouredPct: number;
  /** Owner cost ÷ pints in the keg, in cents; null when cost is untracked. */
  pricePerPintCents: number | null;
  /** Remaining-beer value (remaining fraction × cost), in cents; null when untracked. */
  valueLeftCents: number | null;
}

export function kegCostRows(db: Database.Database): KegCostRow[] {
  const ML_PER_PINT_LOCAL = 473.176;
  const rows = db.prepare(`
    SELECT k.id, b.name AS beer_name, s.name AS supplier_name, k.status,
           k.cost_cents, k.deposit_cents, k.size_ml, k.vol_start_ml, k.vol_dispensed_ml,
           k.purchased_at, k.date_tapped
    FROM kegs k
    JOIN beers b ON b.id = k.beer_id
    LEFT JOIN suppliers s ON s.id = k.supplier_id
    ORDER BY COALESCE(k.date_tapped, k.created_at) DESC
  `).all() as any[];
  return rows.map((r) => {
    const pints = r.size_ml / ML_PER_PINT_LOCAL;
    const pouredPct = r.vol_start_ml > 0
      ? Math.round((r.vol_dispensed_ml / r.vol_start_ml) * 100) : 0;
    const pricePerPintCents = r.cost_cents != null && pints > 0
      ? Math.round(r.cost_cents / pints) : null;
    const remainingFrac = r.vol_start_ml > 0
      ? Math.max(0, (r.vol_start_ml - r.vol_dispensed_ml) / r.vol_start_ml) : 0;
    const valueLeftCents = r.cost_cents != null ? Math.round(remainingFrac * r.cost_cents) : null;
    return {
      kegId: r.id,
      beerName: r.beer_name,
      supplierName: r.supplier_name ?? null,
      status: r.status,
      costCents: r.cost_cents ?? null,
      depositCents: r.deposit_cents ?? null,
      sizeMl: r.size_ml,
      volStartMl: r.vol_start_ml,
      volDispensedMl: r.vol_dispensed_ml,
      purchasedAt: r.purchased_at ?? null,
      dateTapped: r.date_tapped ?? null,
      pouredPct,
      pricePerPintCents,
      valueLeftCents,
    };
  });
}

/** Busiest-hours heatmap (design 10a): day-of-week (0=Sun) × hour counts over
 * the trailing `days` window, local time — same localtime convention as
 * `hourHistogram` above. */
export function hourHeatmap(db: Database.Database, days: number, now = new Date()): number[][] {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY).toISOString();
  const rows = db.prepare(`
    SELECT CAST(strftime('%w', ts, 'localtime') AS INTEGER) AS dow,
           CAST(strftime('%H', ts, 'localtime') AS INTEGER) AS hour,
           COUNT(*) AS count
    FROM pours WHERE ts >= ? GROUP BY dow, hour
  `).all(cutoff) as { dow: number; hour: number; count: number }[];
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const row of rows) {
    if (row.dow >= 0 && row.dow < 7 && row.hour >= 0 && row.hour < 24) {
      grid[row.dow]![row.hour] = row.count;
    }
  }
  return grid;
}
