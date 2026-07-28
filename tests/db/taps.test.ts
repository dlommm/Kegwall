import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createTap, listTaps, updateTap, deleteTap } from '../../src/server/db/taps.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

describe('taps repo', () => {
  it('creates taps and lists ordered by number', () => {
    createTap(db, { number: 2 });
    createTap(db, { number: 1, name: 'Left' });
    const taps = listTaps(db);
    expect(taps.map((t) => t.number)).toEqual([1, 2]);
    expect(taps[0]!.name).toBe('Left');
  });

  it('rejects duplicate numbers', () => {
    createTap(db, { number: 1 });
    expect(() => createTap(db, { number: 1 })).toThrow();
  });

  it('updates and deletes', () => {
    const tap = createTap(db, { number: 3 });
    expect(updateTap(db, tap.id, { name: 'Right' }).name).toBe('Right');
    deleteTap(db, tap.id);
    expect(listTaps(db)).toHaveLength(0);
  });
});
