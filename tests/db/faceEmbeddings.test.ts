import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { createDrinker, deleteUser } from '../../src/server/db/users.js';
import {
  MAX_EMBEDDINGS_PER_DRINKER, listFaceEmbeddings, insertFaceEmbedding,
  deleteFaceEmbeddingsForDrinker, countFaceEmbeddingsByDrinker,
} from '../../src/server/db/faceEmbeddings.js';

let db: ReturnType<typeof openDb>;
let drinkerId: number;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  drinkerId = createDrinker(db, { displayName: 'Dave', avatarColor: '#D08C4C' }).id;
});
afterEach(() => db.close());

const vec = (seed: number) => [seed, seed + 0.5, seed + 1];

describe('faceEmbeddings', () => {
  it('inserts and lists with parsed embedding arrays', () => {
    const row = insertFaceEmbedding(db, drinkerId, vec(1));
    expect(row.drinkerId).toBe(drinkerId);
    expect(row.embedding).toEqual([1, 1.5, 2]);
    expect(listFaceEmbeddings(db)).toHaveLength(1);
  });

  it('caps at MAX_EMBEDDINGS_PER_DRINKER, deleting oldest first', () => {
    for (let i = 0; i < MAX_EMBEDDINGS_PER_DRINKER + 2; i++) insertFaceEmbedding(db, drinkerId, vec(i));
    const rows = listFaceEmbeddings(db);
    expect(rows).toHaveLength(MAX_EMBEDDINGS_PER_DRINKER);
    expect(rows.map((r) => r.embedding[0])).toEqual([2, 3, 4, 5, 6]); // 0 and 1 evicted
  });

  it('deleteFaceEmbeddingsForDrinker removes only that drinker and reports count', () => {
    const other = createDrinker(db, { displayName: 'Sam' }).id;
    insertFaceEmbedding(db, drinkerId, vec(1));
    insertFaceEmbedding(db, other, vec(9));
    expect(deleteFaceEmbeddingsForDrinker(db, drinkerId)).toBe(1);
    expect(listFaceEmbeddings(db).map((r) => r.drinkerId)).toEqual([other]);
  });

  it('countFaceEmbeddingsByDrinker groups counts', () => {
    insertFaceEmbedding(db, drinkerId, vec(1));
    insertFaceEmbedding(db, drinkerId, vec(2));
    expect(countFaceEmbeddingsByDrinker(db).get(drinkerId)).toBe(2);
  });

  it('removing a user cascades its embeddings', () => {
    insertFaceEmbedding(db, drinkerId, vec(1));
    deleteUser(db, drinkerId);
    expect(listFaceEmbeddings(db)).toHaveLength(0);
  });
});
