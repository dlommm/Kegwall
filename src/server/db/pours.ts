import type Database from 'better-sqlite3';
import type { Pour } from './kegs.js';
import { NotFoundError } from '../core/errors.js';

function rowToPour(r: any): Pour {
  return {
    id: r.id, kegId: r.keg_id, ts: r.ts, volumeMl: r.volume_ml,
    durationMs: r.duration_ms, source: r.source, drinkerId: r.drinker_id,
  };
}

export function listPours(db: Database.Database, filter: {
  kegId?: number; since?: string; until?: string; limit?: number;
} = {}): Pour[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.kegId !== undefined) { clauses.push('keg_id = ?'); params.push(filter.kegId); }
  if (filter.since) { clauses.push('ts >= ?'); params.push(filter.since); }
  if (filter.until) { clauses.push('ts <= ?'); params.push(filter.until); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ?? 500;
  return db.prepare(`SELECT * FROM pours ${where} ORDER BY ts DESC LIMIT ?`)
    .all(...params, limit).map(rowToPour);
}

export function recentUnclaimedPours(db: Database.Database, windowMinutes: number): Pour[] {
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  return db.prepare(
    'SELECT * FROM pours WHERE drinker_id IS NULL AND ts >= ? ORDER BY ts DESC')
    .all(cutoff).map(rowToPour);
}

export function setPourDrinker(db: Database.Database, pourId: number, drinkerId: number | null): Pour {
  const res = db.prepare('UPDATE pours SET drinker_id = ? WHERE id = ?').run(drinkerId, pourId);
  if (res.changes === 0) throw new NotFoundError(`pour ${pourId}`);
  return rowToPour(db.prepare('SELECT * FROM pours WHERE id = ?').get(pourId));
}
