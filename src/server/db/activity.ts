import type Database from 'better-sqlite3';

/**
 * A single row in the admin dashboard's activity feed (Task 3 of the Phase 4 plan):
 * either a recorded pour or a keg being placed on tap (a fresh keg or an on-deck keg
 * promoted by the swap wizard — see `swapKeg` in `./kegs.ts`). Deliberately carries
 * structured fields rather than a pre-rendered sentence — "text-ready fields not
 * prose" per the plan — so the client owns copy/tone (sentence case, plain verbs) and
 * this stays reusable for anything else that wants the same event stream.
 */
export interface ActivityEvent {
  ts: string;
  kind: 'pour' | 'keg_tapped';
  beerName: string;
  tapNumber: number | null;
  /** The pour's volume in mL. Always `null` for a `keg_tapped` event — a freshly tapped
   * keg hasn't dispensed anything yet, so there's no meaningful volume to report. */
  volumeMl: number | null;
}

/**
 * Merges the most recent pours and keg-tap events into one feed, newest first, capped
 * at `limit` (default 20, per the plan). Each source query is independently sorted
 * DESC and capped at `limit` before merging — since both streams are already sorted,
 * the globally-newest `limit` rows can never come from beyond the `limit`'th row of
 * either individual stream, so this two-query-then-merge approach is exact, not an
 * approximation.
 *
 * A keg only counts as "tapped" once it's actually on_tap (or later kicked off it) —
 * `status = 'on_deck'` is explicitly excluded even though `createKeg` always stamps
 * `date_tapped` on insert regardless of status (see that function's doc comment): an
 * on-deck keg is queued, not yet poured from, so it must not show up as a "Tapped ..."
 * event until the swap wizard actually promotes it (which re-stamps `date_tapped` at
 * promotion time — see `swapKeg`'s `fromKegId` branch).
 */
export function listRecentActivity(db: Database.Database, limit = 20): ActivityEvent[] {
  const pourRows = db.prepare(`
    SELECT p.ts AS ts, p.volume_ml AS volume_ml, b.name AS beer_name, t.number AS tap_number
    FROM pours p
    JOIN kegs k ON k.id = p.keg_id
    JOIN beers b ON b.id = k.beer_id
    LEFT JOIN taps t ON t.id = k.tap_id
    ORDER BY p.ts DESC
    LIMIT ?
  `).all(limit) as { ts: string; volume_ml: number; beer_name: string; tap_number: number | null }[];

  const kegTapRows = db.prepare(`
    SELECT k.date_tapped AS ts, b.name AS beer_name, t.number AS tap_number
    FROM kegs k
    JOIN beers b ON b.id = k.beer_id
    JOIN taps t ON t.id = k.tap_id
    WHERE k.tap_id IS NOT NULL AND k.date_tapped IS NOT NULL AND k.status != 'on_deck'
    ORDER BY k.date_tapped DESC
    LIMIT ?
  `).all(limit) as { ts: string; beer_name: string; tap_number: number }[];

  const events: ActivityEvent[] = [
    ...pourRows.map((r): ActivityEvent => ({
      ts: r.ts, kind: 'pour', beerName: r.beer_name, tapNumber: r.tap_number, volumeMl: r.volume_ml,
    })),
    ...kegTapRows.map((r): ActivityEvent => ({
      ts: r.ts, kind: 'keg_tapped', beerName: r.beer_name, tapNumber: r.tap_number, volumeMl: null,
    })),
  ];

  events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return events.slice(0, limit);
}
