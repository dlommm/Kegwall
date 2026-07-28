import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError } from '../core/errors.js';

export interface Beer {
  id: number; name: string; brewery: string | null; style: string | null;
  abv: number | null; ibu: number | null; srm: number | null;
  description: string | null; labelImage: string | null; createdAt: string;
}

export interface BeerInput {
  name: string; brewery?: string | null; style?: string | null;
  abv?: number | null; ibu?: number | null; srm?: number | null;
  description?: string | null; labelImage?: string | null;
}

function rowToBeer(r: any): Beer {
  return {
    id: r.id, name: r.name, brewery: r.brewery, style: r.style, abv: r.abv,
    ibu: r.ibu, srm: r.srm, description: r.description,
    labelImage: r.label_image, createdAt: r.created_at,
  };
}

export function createBeer(db: Database.Database, input: BeerInput): Beer {
  const res = db.prepare(`INSERT INTO beers
      (name, brewery, style, abv, ibu, srm, description, label_image, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.name, input.brewery ?? null, input.style ?? null, input.abv ?? null,
      input.ibu ?? null, input.srm ?? null, input.description ?? null,
      input.labelImage ?? null, new Date().toISOString());
  return getBeer(db, Number(res.lastInsertRowid))!;
}

export function getBeer(db: Database.Database, id: number): Beer | null {
  const r = db.prepare('SELECT * FROM beers WHERE id = ?').get(id);
  return r ? rowToBeer(r) : null;
}

export function listBeers(db: Database.Database): Beer[] {
  return db.prepare('SELECT * FROM beers ORDER BY name').all().map(rowToBeer);
}

export function updateBeer(db: Database.Database, id: number, input: Partial<BeerInput>): Beer {
  const existing = getBeer(db, id);
  if (!existing) throw new NotFoundError(`beer ${id}`);
  const merged = { ...existing, ...input } as any;
  db.prepare(`UPDATE beers SET name=?, brewery=?, style=?, abv=?, ibu=?, srm=?,
      description=?, label_image=? WHERE id=?`)
    .run(merged.name, merged.brewery ?? null, merged.style ?? null, merged.abv ?? null,
      merged.ibu ?? null, merged.srm ?? null, merged.description ?? null,
      merged.labelImage ?? null, id);
  return getBeer(db, id)!;
}

export function deleteBeer(db: Database.Database, id: number): void {
  const used = db.prepare('SELECT COUNT(*) c FROM kegs WHERE beer_id = ?').get(id) as any;
  if (used.c > 0) throw new ConflictError(`beer ${id} is referenced by ${used.c} keg(s)`);
  db.prepare('DELETE FROM beers WHERE id = ?').run(id);
}
