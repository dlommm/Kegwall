import type Database from 'better-sqlite3';
import type { Pour } from './kegs.js';
import { NotFoundError } from '../core/errors.js';
import { DEDUPE_WINDOW_MS, volumesMatch } from '../core/pourDedupe.js';

/** Design 3b: guests can claim a pour for this many minutes after it happens; older
 * pours are assigned by an editor on the admin Pours page. Shared with the menu's
 * claim copy so the two can't drift. */
export const CLAIM_WINDOW_MINUTES = 10;

function rowToPour(r: any): Pour {
  return {
    id: r.id, kegId: r.keg_id, ts: r.ts, volumeMl: r.volume_ml,
    durationMs: r.duration_ms, source: r.source, drinkerId: r.drinker_id,
    quality: r.quality ?? null,
    rating: r.rating ?? null,
    ratingTags: r.rating_tags ? JSON.parse(r.rating_tags) : null,
  };
}

export function listPours(db: Database.Database, filter: {
  kegId?: number; since?: string; until?: string; limit?: number; unclaimed?: boolean;
  drinkerId?: number; beforeId?: number;
} = {}): Pour[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.kegId !== undefined) { clauses.push('keg_id = ?'); params.push(filter.kegId); }
  if (filter.since) { clauses.push('ts >= ?'); params.push(filter.since); }
  if (filter.until) { clauses.push('ts <= ?'); params.push(filter.until); }
  if (filter.unclaimed) clauses.push('drinker_id IS NULL');
  if (filter.drinkerId !== undefined) { clauses.push('drinker_id = ?'); params.push(filter.drinkerId); }
  if (filter.beforeId !== undefined) {
    // Keyset cursor for "load more": rows strictly after the cursor pour in the
    // (ts DESC, id DESC) order, so pages never overlap or skip same-timestamp rows.
    const cursor = db.prepare('SELECT ts FROM pours WHERE id = ?').get(filter.beforeId) as { ts: string } | undefined;
    if (!cursor) throw new NotFoundError(`pour ${filter.beforeId}`);
    clauses.push('(ts < ? OR (ts = ? AND id < ?))');
    params.push(cursor.ts, cursor.ts, filter.beforeId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ?? 500;
  return db.prepare(`SELECT * FROM pours ${where} ORDER BY ts DESC, id DESC LIMIT ?`)
    .all(...params, limit).map(rowToPour);
}

/** Latest pour's `{ts, volumeMl}` per keg for a set of kegs, in ONE query — the batch
 * form of `listPours({kegId, limit: 1})`'s use in `StateManager.getTapStates()` (which
 * runs on every `pour_progress` packet, so a per-tap query was measurably hot). SQLite's
 * bare-column-with-a-single-MAX-aggregate behavior makes `ts`/`volume_ml` come from the
 * max-`ts` row per group — the same row the per-keg `ORDER BY ts DESC LIMIT 1` returns. */
export function latestPourByKeg(
  db: Database.Database, kegIds: number[],
): Map<number, { ts: string; volumeMl: number }> {
  const map = new Map<number, { ts: string; volumeMl: number }>();
  if (kegIds.length === 0) return map;
  const rows = db.prepare(
    `SELECT keg_id, ts, volume_ml, MAX(ts) FROM pours
      WHERE keg_id IN (${kegIds.map(() => '?').join(', ')}) GROUP BY keg_id`,
  ).all(...kegIds) as { keg_id: number; ts: string; volume_ml: number }[];
  for (const r of rows) map.set(r.keg_id, { ts: r.ts, volumeMl: r.volume_ml });
  return map;
}

/**
 * An already-RECORDED pour on any keg this tap has had, within the dedupe window of `ts`
 * and a matching volume — the persisted half of duplicate suppression. The in-memory
 * `PourDeduper` resets on every restart / source rebuild, but the Kegtron cloud backfill
 * then replays every serving since its cursor, including pours the live feed (WS diff or
 * UDP) already recorded; this catches those. Searches every keg on the tap, since a
 * replayed pour may predate a keg swap. `julianday` tolerates both stored ts spellings
 * (`…:00Z` from mdash, `…:00.000Z` from live sources).
 */
export function findRecordedTwin(
  db: Database.Database, tapId: number, ts: string, volumeMl: number,
): Pour | null {
  const tsMs = Date.parse(ts);
  if (Number.isNaN(tsMs)) return null;
  const from = new Date(tsMs - DEDUPE_WINDOW_MS - 1000).toISOString().slice(0, 19);
  const to = new Date(tsMs + DEDUPE_WINDOW_MS + 1000).toISOString().slice(0, 19);
  const rows = db.prepare(`
    SELECT * FROM pours
     WHERE keg_id IN (SELECT id FROM kegs WHERE tap_id = ?)
       AND ts >= ? AND ts <= ?
       AND ABS(julianday(ts) - julianday(?)) * 86400000 <= ?`)
    .all(tapId, from, `${to}Z`, ts, DEDUPE_WINDOW_MS);
  const match = rows.find((r: any) => volumesMatch(r.volume_ml, volumeMl));
  return match ? rowToPour(match) : null;
}

export function recentUnclaimedPours(db: Database.Database, windowMinutes: number): Pour[] {
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  return db.prepare(
    'SELECT * FROM pours WHERE drinker_id IS NULL AND ts >= ? ORDER BY ts DESC')
    .all(cutoff).map(rowToPour);
}

/** A drinker's lifetime claimed-pour count — the tablet done screen's "pour #N". */
export function countPoursForDrinker(db: Database.Database, drinkerId: number): number {
  return (db.prepare('SELECT COUNT(*) c FROM pours WHERE drinker_id = ?')
    .get(drinkerId) as any).c;
}

/** A drinker's most recent claimed-pour timestamp, or null — feeds the tablet's RECENT
 *  jumbo tiles (redesign 2d). */
export function lastPourForDrinker(db: Database.Database, drinkerId: number): string | null {
  const r = db.prepare('SELECT MAX(ts) ts FROM pours WHERE drinker_id = ?')
    .get(drinkerId) as { ts: string | null };
  return r.ts ?? null;
}

/** The beer a drinker last poured (name and SRM only: the kiosk colors their tab with it). */
export function lastBeerForDrinker(db: Database.Database, drinkerId: number): { name: string; srm: number | null } | null {
  const r = db.prepare(`
    SELECT b.name AS name, b.srm AS srm FROM pours p
    JOIN kegs k ON k.id = p.keg_id JOIN beers b ON b.id = k.beer_id
    WHERE p.drinker_id = ? ORDER BY p.ts DESC LIMIT 1
  `).get(drinkerId) as { name: string; srm: number | null } | undefined;
  return r ? { name: r.name, srm: r.srm } : null;
}

/** Rate-after-claim (design 6a): stamps 1-5 stars + quick tags on a pour. */
export function ratePour(db: Database.Database, pourId: number, rating: number, tags: string[]): Pour {
  const res = db.prepare('UPDATE pours SET rating = ?, rating_tags = ? WHERE id = ?')
    .run(rating, JSON.stringify(tags), pourId);
  if (res.changes === 0) throw new NotFoundError(`pour ${pourId}`);
  return rowToPour(db.prepare('SELECT * FROM pours WHERE id = ?').get(pourId));
}

/** Assigns (or, with `null`, unclaims) many pours in one transaction. All-or-nothing:
 * an unknown pour id rolls the whole batch back with a NotFoundError. */
export function setPoursDrinker(db: Database.Database, pourIds: number[], drinkerId: number | null): Pour[] {
  const ids = [...new Set(pourIds)];
  return db.transaction(() => ids.map((id) => setPourDrinker(db, id, drinkerId)))();
}

export function setPourDrinker(db: Database.Database, pourId: number, drinkerId: number | null): Pour {
  const res = db.prepare('UPDATE pours SET drinker_id = ? WHERE id = ?').run(drinkerId, pourId);
  if (res.changes === 0) throw new NotFoundError(`pour ${pourId}`);
  return rowToPour(db.prepare('SELECT * FROM pours WHERE id = ?').get(pourId));
}
