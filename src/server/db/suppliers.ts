import type Database from 'better-sqlite3';
import { NotFoundError } from '../core/errors.js';

/**
 * A keg supplier (WebUI redesign 4l). Purely descriptive contact data — the price book is
 * DERIVED from keg purchase history (kegs.supplier_id + cost_cents), never entered here.
 */
export interface Supplier {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
  deliveryNotes: string | null;
  notes: string | null;
  createdAt: string;
}

export interface SupplierInput {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  hours?: string | null;
  deliveryNotes?: string | null;
  notes?: string | null;
}

function rowToSupplier(r: any): Supplier {
  return {
    id: r.id,
    name: r.name,
    contactName: r.contact_name ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    hours: r.hours ?? null,
    deliveryNotes: r.delivery_notes ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
  };
}

export function listSuppliers(db: Database.Database): Supplier[] {
  return db.prepare('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE').all().map(rowToSupplier);
}

export function getSupplier(db: Database.Database, id: number): Supplier | null {
  const r = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  return r ? rowToSupplier(r) : null;
}

export function createSupplier(db: Database.Database, input: SupplierInput): Supplier {
  const res = db.prepare(`INSERT INTO suppliers
      (name, contact_name, phone, email, address, hours, delivery_notes, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      input.name, input.contactName ?? null, input.phone ?? null, input.email ?? null,
      input.address ?? null, input.hours ?? null, input.deliveryNotes ?? null, input.notes ?? null,
      new Date().toISOString(),
    );
  return getSupplier(db, Number(res.lastInsertRowid))!;
}

export function updateSupplier(db: Database.Database, id: number, input: SupplierInput): Supplier {
  const existing = getSupplier(db, id);
  if (!existing) throw new NotFoundError(`supplier ${id}`);
  db.prepare(`UPDATE suppliers SET
      name = ?, contact_name = ?, phone = ?, email = ?, address = ?, hours = ?,
      delivery_notes = ?, notes = ? WHERE id = ?`)
    .run(
      input.name, input.contactName ?? null, input.phone ?? null, input.email ?? null,
      input.address ?? null, input.hours ?? null, input.deliveryNotes ?? null, input.notes ?? null,
      id,
    );
  return getSupplier(db, id)!;
}

export function deleteSupplier(db: Database.Database, id: number): void {
  const res = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  if (res.changes === 0) throw new NotFoundError(`supplier ${id}`);
  // kegs.supplier_id / beers.exclusive_supplier_id are ON DELETE SET NULL — purchase
  // history (cost, date) survives; only the link to the now-deleted supplier clears.
}

// --- Derived price book (redesign 4l) --------------------------------------
// The price book is NEVER entered by hand — it's read straight out of keg purchase history
// (kegs.cost_cents + supplier_id). One row per (beer, size) the supplier has actually bought.

export interface PriceBookEntry {
  beerId: number;
  beerName: string;
  sizeMl: number;
  /** Owner cost of this supplier's most recent purchase of this beer+size, in cents. */
  lastPaidCents: number;
  lastPurchasedAt: string | null;
  /** This supplier's last price is the lowest known for this beer+size. */
  isBestKnown: boolean;
  /** Best price from ANOTHER supplier for the same beer+size, or null when no other source. */
  bestElsewhereCents: number | null;
  bestElsewhereSupplierName: string | null;
}

interface PricedKeg {
  beerId: number; beerName: string; sizeMl: number; costCents: number;
  supplierId: number; supplierName: string | null; purchasedAt: string | null; createdAt: string;
}

function pricedKegs(db: Database.Database): PricedKeg[] {
  return db.prepare(`
    SELECT k.beer_id AS beerId, b.name AS beerName, k.size_ml AS sizeMl, k.cost_cents AS costCents,
           k.supplier_id AS supplierId, s.name AS supplierName,
           k.purchased_at AS purchasedAt, k.created_at AS createdAt
    FROM kegs k
    JOIN beers b ON b.id = k.beer_id
    LEFT JOIN suppliers s ON s.id = k.supplier_id
    WHERE k.cost_cents IS NOT NULL AND k.supplier_id IS NOT NULL
  `).all() as PricedKeg[];
}

/** When this purchase happened, for "most recent" ordering — purchase date if set, else created. */
function purchaseTime(k: PricedKeg): string {
  return k.purchasedAt ?? k.createdAt;
}

/**
 * This supplier's derived price book: their latest paid price for each beer+size they've
 * bought, flagged best-known and compared against the best price from any other supplier.
 */
export function supplierPriceBook(db: Database.Database, supplierId: number): PriceBookEntry[] {
  const all = pricedKegs(db);
  const key = (k: PricedKeg) => `${k.beerId}::${k.sizeMl}`;

  // Latest purchase per (beer,size) for THIS supplier.
  const mine = new Map<string, PricedKeg>();
  for (const k of all) {
    if (k.supplierId !== supplierId) continue;
    const cur = mine.get(key(k));
    if (!cur || purchaseTime(k) > purchaseTime(cur)) mine.set(key(k), k);
  }

  return [...mine.values()]
    .map((k) => {
      const others = all.filter((o) => key(o) === key(k) && o.supplierId !== supplierId);
      const bestElsewhere = others.reduce<PricedKeg | null>(
        (best, o) => (best == null || o.costCents < best.costCents ? o : best), null,
      );
      const isBestKnown = bestElsewhere == null || k.costCents <= bestElsewhere.costCents;
      return {
        beerId: k.beerId,
        beerName: k.beerName,
        sizeMl: k.sizeMl,
        lastPaidCents: k.costCents,
        lastPurchasedAt: k.purchasedAt,
        isBestKnown,
        bestElsewhereCents: bestElsewhere?.costCents ?? null,
        bestElsewhereSupplierName: bestElsewhere?.supplierName ?? null,
      };
    })
    .sort((a, b) => a.beerName.localeCompare(b.beerName) || a.sizeMl - b.sizeMl);
}

export interface SupplierStats {
  supplierCount: number;
  kegsPurchased: number;
  ytdSpendCents: number;
}

/** Header stats for the Suppliers page: supplier count, total kegs purchased (with a supplier),
 *  and year-to-date spend (owner cost — admin-only surface). */
export function supplierStats(db: Database.Database, now = new Date()): SupplierStats {
  const supplierCount = (db.prepare('SELECT COUNT(*) c FROM suppliers').get() as any).c;
  const kegsPurchased = (db.prepare('SELECT COUNT(*) c FROM kegs WHERE supplier_id IS NOT NULL').get() as any).c;
  const yearStart = `${now.getFullYear()}-01-01`;
  // Compare against purchased_at when set, else created_at (both ISO/date strings sort lexically).
  const spend = db.prepare(`
    SELECT COALESCE(SUM(cost_cents), 0) c FROM kegs
    WHERE cost_cents IS NOT NULL AND supplier_id IS NOT NULL
      AND COALESCE(purchased_at, created_at) >= ?
  `).get(yearStart) as any;
  return { supplierCount, kegsPurchased, ytdSpendCents: spend.c };
}

/**
 * Recent purchases of a beer+size across ALL suppliers, most recent first — powers the swap
 * wizard's inline price-book warning ("Johns sold this for $75 on May 20; you're entering $80").
 */
export function priceHistoryForBeerSize(
  db: Database.Database, beerId: number, sizeMl: number,
): { supplierId: number; supplierName: string | null; costCents: number; purchasedAt: string | null }[] {
  return pricedKegs(db)
    .filter((k) => k.beerId === beerId && k.sizeMl === sizeMl)
    .sort((a, b) => (purchaseTime(a) > purchaseTime(b) ? -1 : 1))
    .map((k) => ({
      supplierId: k.supplierId, supplierName: k.supplierName, costCents: k.costCents, purchasedAt: k.purchasedAt,
    }));
}
