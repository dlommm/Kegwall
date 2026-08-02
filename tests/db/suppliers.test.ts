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
  supplierPriceBook, supplierStats, priceHistoryForBeerSize,
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

describe('derived price book + stats', () => {
  it('builds a supplier price book from purchase history, flagging best-known + comparison', () => {
    const yuengling = createBeer(db, { name: 'Yuengling' });
    const joes = createSupplier(db, { name: 'Joes' });
    const johns = createSupplier(db, { name: 'Johns' });
    // Johns sold it cheaper ($75) than Joes ($80), same size.
    createKeg(db, {
      beerId: yuengling.id, sizeMl: 58674, volStartMl: 58674, status: 'on_deck',
      costCents: 8000, supplierId: joes.id, purchasedAt: '2026-06-01',
    });
    createKeg(db, {
      beerId: yuengling.id, sizeMl: 58674, volStartMl: 58674, status: 'on_deck',
      costCents: 7500, supplierId: johns.id, purchasedAt: '2026-05-20',
    });

    const joesBook = supplierPriceBook(db, joes.id);
    expect(joesBook).toHaveLength(1);
    expect(joesBook[0]).toMatchObject({
      beerName: 'Yuengling', lastPaidCents: 8000, isBestKnown: false,
      bestElsewhereCents: 7500, bestElsewhereSupplierName: 'Johns',
    });

    const johnsBook = supplierPriceBook(db, johns.id);
    expect(johnsBook[0]).toMatchObject({ lastPaidCents: 7500, isBestKnown: true, bestElsewhereCents: 8000 });
  });

  it('takes the most recent purchase per beer+size for a supplier', () => {
    const beer = createBeer(db, { name: 'Lager' });
    const joes = createSupplier(db, { name: 'Joes' });
    createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck', costCents: 9000, supplierId: joes.id, purchasedAt: '2026-01-01',
    });
    createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck', costCents: 9500, supplierId: joes.id, purchasedAt: '2026-07-01',
    });
    expect(supplierPriceBook(db, joes.id)[0]!.lastPaidCents).toBe(9500);
  });

  it('computes header stats: supplier count, kegs purchased, YTD spend', () => {
    const beer = createBeer(db, { name: 'Ale' });
    const joes = createSupplier(db, { name: 'Joes' });
    createSupplier(db, { name: 'Zed' });
    createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck', costCents: 10000, supplierId: joes.id, purchasedAt: '2026-03-01',
    });
    createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck', costCents: 5000, supplierId: joes.id, purchasedAt: '2025-12-01', // prior year, excluded from YTD
    });
    const stats = supplierStats(db, new Date('2026-08-02T00:00:00Z'));
    expect(stats).toEqual({ supplierCount: 2, kegsPurchased: 2, ytdSpendCents: 10000 });
  });

  it('price history for a beer+size lists purchases across suppliers, newest first', () => {
    const beer = createBeer(db, { name: 'Stout' });
    const a = createSupplier(db, { name: 'A' });
    const b = createSupplier(db, { name: 'B' });
    createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck', costCents: 8000, supplierId: a.id, purchasedAt: '2026-05-20',
    });
    createKeg(db, {
      beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck', costCents: 8500, supplierId: b.id, purchasedAt: '2026-06-10',
    });
    const hist = priceHistoryForBeerSize(db, beer.id, 19000);
    expect(hist.map((h) => h.supplierName)).toEqual(['B', 'A']);
    expect(hist[0]!.costCents).toBe(8500);
  });
});
