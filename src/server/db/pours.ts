import type Database from 'better-sqlite3';
import type { Pour } from './kegs.js';
import { NotFoundError } from '../core/errors.js';

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
} = {}): Pour[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.kegId !== undefined) { clauses.push('keg_id = ?'); params.push(filter.kegId); }
  if (filter.since) { clauses.push('ts >= ?'); params.push(filter.since); }
  if (filter.until) { clauses.push('ts <= ?'); params.push(filter.until); }
  if (filter.unclaimed) clauses.push('drinker_id IS NULL');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ?? 500;
  return db.prepare(`SELECT * FROM pours ${where} ORDER BY ts DESC LIMIT ?`)
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

/** Rate-after-claim (design 6a): stamps 1-5 stars + quick tags on a pour. */
export function ratePour(db: Database.Database, pourId: number, rating: number, tags: string[]): Pour {
  const res = db.prepare('UPDATE pours SET rating = ?, rating_tags = ? WHERE id = ?')
    .run(rating, JSON.stringify(tags), pourId);
  if (res.changes === 0) throw new NotFoundError(`pour ${pourId}`);
  return rowToPour(db.prepare('SELECT * FROM pours WHERE id = ?').get(pourId));
}

export function setPourDrinker(db: Database.Database, pourId: number, drinkerId: number | null): Pour {
  const res = db.prepare('UPDATE pours SET drinker_id = ? WHERE id = ?').run(drinkerId, pourId);
  if (res.changes === 0) throw new NotFoundError(`pour ${pourId}`);
  return rowToPour(db.prepare('SELECT * FROM pours WHERE id = ?').get(pourId));
}
