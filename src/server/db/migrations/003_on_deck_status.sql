-- Extends kegs.status to allow 'on_deck' (a keg queued behind the tap's current on_tap
-- keg, waiting to be promoted by a swap -- see db/kegs.ts's listOnDeckForTap/swapKeg).
--
-- SQLite has no ALTER TABLE ... ALTER COLUMN / MODIFY CHECK, so per SQLite's documented
-- "Making Other Kinds Of Table Schema Changes" procedure this recreates the table under a
-- widened CHECK, copies every row across unchanged, and swaps it in. Foreign key
-- enforcement is toggled off/back-on by migrate.ts AROUND this whole file (not from
-- inside it): PRAGMA foreign_keys is a documented no-op while a transaction is open, and
-- migrate.ts always runs each migration file inside one.
--
-- Only idx_kegs_tap_active needs recreating here, not idx_kegs_tap: 002_unique_active_keg
-- already dropped idx_kegs_tap for good, and migrations always apply in filename order
-- within the same runMigrations() pass, so by the time this file runs, 002 has already
-- happened (whether it was applied just now, on an upgrade, or long ago).
CREATE TABLE kegs_new (
  id INTEGER PRIMARY KEY,
  beer_id INTEGER NOT NULL REFERENCES beers(id),
  tap_id INTEGER REFERENCES taps(id),
  size_ml INTEGER NOT NULL,
  vol_start_ml INTEGER NOT NULL,
  vol_dispensed_ml INTEGER NOT NULL DEFAULT 0,
  date_tapped TEXT,
  status TEXT NOT NULL DEFAULT 'on_tap' CHECK (status IN ('on_tap','kicked','archived','on_deck')),
  created_at TEXT NOT NULL
);

INSERT INTO kegs_new (id, beer_id, tap_id, size_ml, vol_start_ml, vol_dispensed_ml,
    date_tapped, status, created_at)
  SELECT id, beer_id, tap_id, size_ml, vol_start_ml, vol_dispensed_ml,
    date_tapped, status, created_at
  FROM kegs;

DROP TABLE kegs;
ALTER TABLE kegs_new RENAME TO kegs;

CREATE UNIQUE INDEX idx_kegs_tap_active ON kegs(tap_id) WHERE status = 'on_tap' AND tap_id IS NOT NULL;
