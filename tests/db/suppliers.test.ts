import {
  describe, it, expect, beforeEach,
} from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import {
  listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
} from '../../src/server/db/suppliers.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createKeg } from '../../src/server/db/kegs.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktsup-')));
});

describe('suppliers repo', () => {
  it('creates, reads, updates, and lists suppliers alphabetically', () => {
    const zed = createSupplier(db, { name: 'Zed Distributing', phone: '555-9' });
    createSupplier(db, { name: 'Ace Beverage', contactName: 'Pat', email: 'pat@ace.test' });

    expect(listSuppliers(db).map((s) => s.name)).toEqual(['Ace Beverage', 'Zed Distributing']);
    expect(getSupplier(db, zed.id)).toMatchObject({ name: 'Zed Distributing', phone: '555-9', email: null });

    const updated = updateSupplier(db, zed.id, { name: 'Zed Bev', deliveryNotes: 'Tuesdays' });
    expect(updated).toMatchObject({ name: 'Zed Bev', deliveryNotes: 'Tuesdays' });
  });

  it('deleting a supplier nulls the link on its kegs but preserves the purchase cost', () => {
    const beer = createBeer(db, { name: 'Pils' });
    const supplier = createSupplier(db, { name: 'Joes' });
    const keg = createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck',
      costCents: 12000, supplierId: supplier.id, purchasedAt: '2026-05-20',
    });
    expect(keg.supplierId).toBe(supplier.id);

    deleteSupplier(db, supplier.id);
    const after = db.prepare('SELECT * FROM kegs WHERE id = ?').get(keg.id) as any;
    expect(after.supplier_id).toBeNull();
    expect(after.cost_cents).toBe(12000); // history survives
  });

  it('throws NotFoundError updating or deleting a missing supplier', () => {
    expect(() => updateSupplier(db, 999, { name: 'x' })).toThrow();
    expect(() => deleteSupplier(db, 999)).toThrow();
  });
});
