-- Keg cost/pricing + suppliers (WebUI redesign 4k/4l). `kegs.cost_cents` already exists
-- (design 6d); this adds the deposit, the supplier link, and the purchase date around it,
-- a first-class suppliers table, and the two beer-level pricing/sourcing columns.
--
-- Privacy (hard requirement): owner cost fields (cost_cents, deposit_cents, supplier_id,
-- purchased_at) must NEVER be serialized into a public endpoint — enforced in the API layer
-- (routes/public.ts's toPublicTapState already strips keg.costCents; the others join in there).

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  hours TEXT,
  delivery_notes TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Owner-cost keg columns (cost_cents already present). supplier_id SET NULL on supplier
-- delete so purchase history survives losing a supplier record.
ALTER TABLE kegs ADD COLUMN deposit_cents INTEGER;
ALTER TABLE kegs ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE kegs ADD COLUMN purchased_at TEXT;

-- Per-beer pricing override + only-source supplier.
ALTER TABLE beers ADD COLUMN markup_override_pct REAL;
ALTER TABLE beers ADD COLUMN exclusive_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX idx_kegs_supplier ON kegs(supplier_id);
