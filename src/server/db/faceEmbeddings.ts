import type Database from 'better-sqlite3';

/** Cap per drinker (spec B2 "a few"): inserting beyond it evicts oldest-first, so an
 * enthusiastic re-enroller can never grow the table or drown their own good samples. */
export const MAX_EMBEDDINGS_PER_DRINKER = 5;

export interface FaceEmbeddingRow { id: number; drinkerId: number; embedding: number[]; createdAt: string }

interface RawRow { id: number; drinker_id: number; embedding: string; created_at: string }

function parse(r: RawRow): FaceEmbeddingRow {
  return { id: r.id, drinkerId: r.drinker_id, embedding: JSON.parse(r.embedding), createdAt: r.created_at };
}

export function listFaceEmbeddings(db: Database.Database): FaceEmbeddingRow[] {
  return (db.prepare('SELECT * FROM face_embeddings ORDER BY id').all() as RawRow[]).map(parse);
}

export function insertFaceEmbedding(db: Database.Database, drinkerId: number, embedding: number[]): FaceEmbeddingRow {
  const res = db.prepare(
    'INSERT INTO face_embeddings (drinker_id, embedding, created_at) VALUES (?, ?, ?)',
  ).run(drinkerId, JSON.stringify(embedding), new Date().toISOString());
  db.prepare(`DELETE FROM face_embeddings WHERE drinker_id = ? AND id NOT IN (
      SELECT id FROM face_embeddings WHERE drinker_id = ? ORDER BY id DESC LIMIT ?
    )`).run(drinkerId, drinkerId, MAX_EMBEDDINGS_PER_DRINKER);
  const row = db.prepare('SELECT * FROM face_embeddings WHERE id = ?').get(res.lastInsertRowid) as RawRow;
  return parse(row);
}

export function deleteFaceEmbeddingsForDrinker(db: Database.Database, drinkerId: number): number {
  return db.prepare('DELETE FROM face_embeddings WHERE drinker_id = ?').run(drinkerId).changes;
}

export function countFaceEmbeddingsByDrinker(db: Database.Database): Map<number, number> {
  const rows = db.prepare('SELECT drinker_id, COUNT(*) AS n FROM face_embeddings GROUP BY drinker_id')
    .all() as Array<{ drinker_id: number; n: number }>;
  return new Map(rows.map((r) => [r.drinker_id, r.n]));
}
