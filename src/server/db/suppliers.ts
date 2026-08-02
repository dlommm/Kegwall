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
