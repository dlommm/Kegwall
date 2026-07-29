-- Remove the Locations feature (migration 008's locations table + the three
-- location_id columns). Walls scope by Kegtron device instead (migration 011,
-- wall_devices) — locations never matched how the hardware is actually grouped.
-- Displays (also from 008) are untouched, and monitors.name is KEPT: it becomes
-- the device-level friendly name.
--
-- Column drops come BEFORE the table drop on purpose: migrations run with
-- foreign_keys OFF, so dropping the table first would succeed but leave dangling
-- `REFERENCES locations(id)` clauses baked into the three table schemas, and every
-- later write to them (with FKs back ON) would fail with "no such table".
ALTER TABLE monitors DROP COLUMN location_id;
ALTER TABLE taps DROP COLUMN location_id;
ALTER TABLE walls DROP COLUMN location_id;
DROP TABLE locations;
