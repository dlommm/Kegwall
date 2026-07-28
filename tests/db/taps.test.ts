import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createTap, listTaps, updateTap, deleteTap } from '../../src/server/db/taps.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createKeg } from '../../src/server/db/kegs.js';
import { ConflictError } from '../../src/server/core/errors.js';
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

  it('refuses to delete a tap with kegs on record, with a message naming what blocks it', () => {
    const tap = createTap(db, { number: 4 });
    const beerId = createBeer(db, { name: 'Test Ale' }).id;
    createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
    expect(() => deleteTap(db, tap.id)).toThrow(ConflictError);
    try {
      deleteTap(db, tap.id);
    } catch (err) {
      expect((err as Error).message).toContain('keg');
    }
    expect(listTaps(db)).toHaveLength(1);
  });

  it('refuses to delete a tap with a bound monitor, with a message naming what blocks it', () => {
    const tap = createTap(db, { number: 5 });
    db.prepare(`INSERT INTO monitors (type, identifier, port_index, tap_id, meta) VALUES (?, ?, ?, ?, '{}')`)
      .run('kegtron_pro', 'device1', 0, tap.id);
    expect(() => deleteTap(db, tap.id)).toThrow(ConflictError);
    try {
      deleteTap(db, tap.id);
    } catch (err) {
      expect((err as Error).message).toContain('monitor');
    }
    expect(listTaps(db)).toHaveLength(1);
  });
});
