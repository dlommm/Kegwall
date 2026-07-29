import type Database from 'better-sqlite3';
import { NotFoundError } from '../core/errors.js';

/** Locations (design 11a): first-class places ("Garage Bar", "Lake House")
 * monitors/taps/walls can belong to. NULL location = the unscoped default. */

export interface Location {
  id: number;
  name: string;
  createdAt: string;
}

function rowToLocation(r: any): Location {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}

export function listLocations(db: Database.Database): Location[] {
  return db.prepare('SELECT * FROM locations ORDER BY name').all().map(rowToLocation);
}

export function getLocation(db: Database.Database, id: number): Location | null {
  const r = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  return r ? rowToLocation(r) : null;
}

export function createLocation(db: Database.Database, name: string): Location {
  const res = db.prepare('INSERT INTO locations (name, created_at) VALUES (?, ?)')
    .run(name, new Date().toISOString());
  return getLocation(db, Number(res.lastInsertRowid))!;
}

export function updateLocation(db: Database.Database, id: number, name: string): Location {
  const res = db.prepare('UPDATE locations SET name = ? WHERE id = ?').run(name, id);
  if (res.changes === 0) throw new NotFoundError(`location ${id}`);
  return getLocation(db, id)!;
}

/** Deleting a location unscopes (NULLs) everything in it rather than cascading
 * deletes — the monitors/taps/walls themselves are still real. */
export function deleteLocation(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE monitors SET location_id = NULL WHERE location_id = ?').run(id);
    db.prepare('UPDATE taps SET location_id = NULL WHERE location_id = ?').run(id);
    db.prepare('UPDATE walls SET location_id = NULL WHERE location_id = ?').run(id);
    const res = db.prepare('DELETE FROM locations WHERE id = ?').run(id);
    if (res.changes === 0) throw new NotFoundError(`location ${id}`);
  });
  tx();
}
