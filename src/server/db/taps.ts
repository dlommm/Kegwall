import type Database from 'better-sqlite3';
import { NotFoundError } from '../core/errors.js';

export interface Tap { id: number; number: number; name: string | null }

export function createTap(db: Database.Database, input: { number: number; name?: string | null }): Tap {
  const res = db.prepare('INSERT INTO taps (number, name) VALUES (?, ?)')
    .run(input.number, input.name ?? null);
  return getTap(db, Number(res.lastInsertRowid))!;
}

export function getTap(db: Database.Database, id: number): Tap | null {
  return (db.prepare('SELECT * FROM taps WHERE id = ?').get(id) as Tap | undefined) ?? null;
}

export function listTaps(db: Database.Database): Tap[] {
  return db.prepare('SELECT * FROM taps ORDER BY number').all() as Tap[];
}

export function updateTap(db: Database.Database, id: number, input: { number?: number; name?: string | null }): Tap {
  const existing = getTap(db, id);
  if (!existing) throw new NotFoundError(`tap ${id}`);
  db.prepare('UPDATE taps SET number = ?, name = ? WHERE id = ?')
    .run(input.number ?? existing.number,
      input.name === undefined ? existing.name : input.name, id);
  return getTap(db, id)!;
}

export function deleteTap(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM taps WHERE id = ?').run(id);
}
