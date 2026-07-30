-- Govee sensors become first-class monitors: widen monitors.type's CHECK to accept
-- 'govee_sensor' and add an `enabled` flag (disabled sensors aren't polled and their
-- wall chips disappear, but the row stays for the admin to re-enable).
--
-- SQLite can't ALTER a CHECK constraint, so this is a table-recreate (the
-- 003_on_deck_status.sql precedent). Two things matter here:
--   1. Ids are copied explicitly — telemetry.monitor_id references monitors(id) and
--      must stay attached (migrate.ts's in-transaction foreign_key_check fails closed
--      if not).
--   2. DROP the old table and RENAME the new one INTO the original name, in that
--      order. Migrations run with foreign_keys OFF, where RENAME does NOT rewrite
--      other tables' REFERENCES clauses — renaming the old table aside would leave
--      telemetry pointing at a ghost. (Same failure mode 010's header documents.)
-- No standalone indexes exist on monitors; the UNIQUE constraint's implicit index is
-- redeclared with the table.
CREATE TABLE monitors_new (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('kegtron_pro', 'kegtron_gen1', 'govee_sensor')),
  identifier TEXT NOT NULL,
  serial TEXT,
  port_index INTEGER NOT NULL DEFAULT 0,
  tap_id INTEGER REFERENCES taps(id),
  last_seen TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (type, identifier, port_index)
);

INSERT INTO monitors_new (id, type, identifier, serial, port_index, tap_id, last_seen, meta, name, enabled)
  SELECT id, type, identifier, serial, port_index, tap_id, last_seen, meta, name, 1
  FROM monitors;

DROP TABLE monitors;
ALTER TABLE monitors_new RENAME TO monitors;
