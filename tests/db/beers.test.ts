import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer, getBeer, listBeers, updateBeer, deleteBeer } from '../../src/server/db/beers.js';
import { ConflictError } from '../../src/server/core/errors.js';
import { createTap } from '../../src/server/db/taps.js';
// import { createKeg } from '../../src/server/db/kegs.js'; // exists after Task 6; until then comment the delete-conflict test's keg line — see Step 4 note
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

describe('beers repo', () => {
  it('creates and reads a beer', () => {
    const beer = createBeer(db, { name: 'Citra IPA', brewery: 'Home', abv: 6.5, srm: 6 });
    expect(beer.id).toBeGreaterThan(0);
    expect(getBeer(db, beer.id)).toMatchObject({ name: 'Citra IPA', abv: 6.5, ibu: null });
  });

  it('updates partial fields', () => {
    const beer = createBeer(db, { name: 'Stout' });
    const updated = updateBeer(db, beer.id, { srm: 40, style: 'Dry Stout' });
    expect(updated).toMatchObject({ name: 'Stout', srm: 40, style: 'Dry Stout' });
  });

  it('lists beers', () => {
    createBeer(db, { name: 'A' });
    createBeer(db, { name: 'B' });
    expect(listBeers(db)).toHaveLength(2);
  });

  // TODO Task 6: un-skip
  it.skip('deletes, but refuses when a keg references it', () => {
    const beer = createBeer(db, { name: 'Refd' });
    // createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000 });
    expect(() => deleteBeer(db, beer.id)).toThrow(ConflictError);
  });
});
