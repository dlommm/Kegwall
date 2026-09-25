import type Database from 'better-sqlite3';

/**
 * Line cleaning log (design 6e): one row per cleaning per tap. "Due" is
 * derived — a line wants cleaning after 15 gallons poured or 4 weeks elapsed
 * since the last logged cleaning (whichever comes first), per the handoff.
 * An active, nonempty tap with no cleaning on record and pour history reads as due.
 * Empty taps and taps with ignored reminders retain history without prompting.
 */

export const CLEANING_INTERVAL_DAYS = 28;
export const CLEANING_INTERVAL_GALLONS = 15;
const ML_PER_GALLON = 3785.411784;

export interface LineCleaning {
  id: number;
  tapId: number;
  ts: string;
  note: string | null;
}

function rowToCleaning(r: any): LineCleaning {
  return { id: r.id, tapId: r.tap_id, ts: r.ts, note: r.note };
}

/**
 * Log a cleaning. `cleanedAt` (redesign 4a — backdating) defaults to now; a PAST timestamp
 * is honored so `gallonsSince`/`daysSince` recompute from that date (pours after it count
 * toward the next cleaning). Future dates should be rejected by the caller.
 */
export function logCleaning(
  db: Database.Database, tapId: number, note?: string | null, cleanedAt?: string,
): LineCleaning {
  const res = db.prepare('INSERT INTO line_cleanings (tap_id, ts, note) VALUES (?, ?, ?)')
    .run(tapId, cleanedAt ?? new Date().toISOString(), note ?? null);
  return rowToCleaning(db.prepare('SELECT * FROM line_cleanings WHERE id = ?').get(Number(res.lastInsertRowid)));
}

export function listCleanings(db: Database.Database, tapId: number, limit = 20): LineCleaning[] {
  return db.prepare('SELECT * FROM line_cleanings WHERE tap_id = ? ORDER BY ts DESC LIMIT ?')
    .all(tapId, limit).map(rowToCleaning);
}

export interface CleaningStatus {
  tapId: number;
  lastCleanedAt: string | null;
  gallonsSince: number;
  daysSince: number | null;
  due: boolean;
  ignored?: boolean;
  inactive?: boolean;
}

/** A tap's cleaning status: gallons poured + days elapsed since the last
 * logged cleaning (all history when never cleaned). */
export function cleaningStatus(db: Database.Database, tapId: number, now: Date = new Date()): CleaningStatus {
  const last = db.prepare('SELECT ts FROM line_cleanings WHERE tap_id = ? ORDER BY ts DESC LIMIT 1')
    .get(tapId) as { ts: string } | undefined;
  const since = last?.ts ?? null;
  const volumeRow = db.prepare(`
    SELECT COALESCE(SUM(p.volume_ml), 0) AS total
    FROM pours p
    JOIN kegs k ON k.id = p.keg_id
    WHERE k.tap_id = ?${since ? ' AND p.ts >= ?' : ''}
  `).get(...(since ? [tapId, since] : [tapId])) as { total: number };
  const gallonsSince = volumeRow.total / ML_PER_GALLON;
  const daysSince = since
    ? Math.floor((now.getTime() - new Date(since).getTime()) / (24 * 3600 * 1000))
    : null;
  const tap = db.prepare('SELECT cleaning_ignored FROM taps WHERE id = ?').get(tapId) as { cleaning_ignored: number } | undefined;
  const ignored = !!tap?.cleaning_ignored;
  const active = db.prepare("SELECT id FROM kegs WHERE tap_id = ? AND status = 'on_tap' AND vol_start_ml > vol_dispensed_ml LIMIT 1").get(tapId);
  const due = !ignored && !!active && (gallonsSince >= CLEANING_INTERVAL_GALLONS
    || (daysSince !== null && daysSince >= CLEANING_INTERVAL_DAYS)
    || (since === null && volumeRow.total > 0));
  return {
    tapId, lastCleanedAt: since, gallonsSince: Math.round(gallonsSince * 10) / 10, daysSince, due, ignored, inactive: !active,
  };
}
