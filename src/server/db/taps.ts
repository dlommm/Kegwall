import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError } from '../core/errors.js';

export interface Tap {
  id: number; number: number; name: string | null;
  /** A drinker (`users.is_drinker = 1`) StateManager stamps onto a `pour_completed`
   * record for this tap when the pour would otherwise land unclaimed (see
   * core/state.ts). `null` means no default — the existing behavior. Phase 5 Task 0. */
  defaultDrinkerId: number | null;
}

function rowToTap(r: any): Tap {
  return { id: r.id, number: r.number, name: r.name, defaultDrinkerId: r.default_drinker_id };
}

export function createTap(db: Database.Database, input: {
  number: number; name?: string | null; defaultDrinkerId?: number | null;
}): Tap {
  const res = db.prepare('INSERT INTO taps (number, name, default_drinker_id) VALUES (?, ?, ?)')
    .run(input.number, input.name ?? null, input.defaultDrinkerId ?? null);
  return getTap(db, Number(res.lastInsertRowid))!;
}

export function getTap(db: Database.Database, id: number): Tap | null {
  const r = db.prepare('SELECT * FROM taps WHERE id = ?').get(id);
  return r ? rowToTap(r) : null;
}

export function listTaps(db: Database.Database): Tap[] {
  return db.prepare('SELECT * FROM taps ORDER BY number').all().map(rowToTap);
}

export function updateTap(db: Database.Database, id: number, input: {
  number?: number; name?: string | null; defaultDrinkerId?: number | null;
}): Tap {
  const existing = getTap(db, id);
  if (!existing) throw new NotFoundError(`tap ${id}`);
  db.prepare('UPDATE taps SET number = ?, name = ?, default_drinker_id = ? WHERE id = ?')
    .run(
      input.number ?? existing.number,
      input.name === undefined ? existing.name : input.name,
      input.defaultDrinkerId === undefined ? existing.defaultDrinkerId : input.defaultDrinkerId,
      id,
    );
  return getTap(db, id)!;
}

/**
 * `kegs.tap_id` and `monitors.tap_id` both `REFERENCES taps(id)` with no `ON DELETE`
 * clause, so a bare `DELETE FROM taps` for a tap with kegs (even just kicked/archived
 * history — pours reference kegs, not taps directly, but the FK still fires on the keg
 * row itself) or a bound monitor would raise a raw `SqliteError`. `app.ts`'s
 * `mapSqliteError` maps that to a generic 400 "Refers to a record that does not exist",
 * which reads backwards here (nothing referred to by the DELETE is missing — the tap is
 * what's being referred TO). These explicit pre-checks give the admin UI a real 409 with
 * a message naming what's actually blocking the delete, matching `deleteBeer`'s
 * in-use-by-a-keg precedent in `db/beers.ts`.
 */
export function deleteTap(db: Database.Database, id: number): void {
  // Deliberately does NOT say "remove them first" — no UI or route in this app can
  // delete a historical (kicked/archived) keg, so that phrasing would send an operator
  // looking for a control that doesn't exist. This message states the real, permanent
  // constraint instead: a tap with any keg history can't be deleted at all.
  const kegCount = (db.prepare('SELECT COUNT(*) c FROM kegs WHERE tap_id = ?').get(id) as { c: number }).c;
  if (kegCount > 0) {
    throw new ConflictError(`tap ${id} has keg history (${kegCount} keg(s) on record) and can't be deleted`);
  }
  const monitorCount = (db.prepare('SELECT COUNT(*) c FROM monitors WHERE tap_id = ?').get(id) as { c: number }).c;
  if (monitorCount > 0) {
    throw new ConflictError(`tap ${id} still has a monitor bound — unbind it first`);
  }
  db.prepare('DELETE FROM taps WHERE id = ?').run(id);
}
