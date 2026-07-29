-- Pour Wall overhaul Phase 5 (designs 11a + 7c):
--
-- 1. Locations become first-class ("Garage Bar", "Lake House") — monitors, taps
--    and walls can each belong to one. NULL location = the unscoped default,
--    so existing single-location installs behave exactly as before.
-- 2. Monitors get a friendly display name ("Main kegerator") shown over the
--    raw serial/identifier.
-- 3. Displays: a paired physical screen. Pairing is by short code — the TV
--    opens /display, someone types the code from the admin Displays page, and
--    the display remembers itself (localStorage) and renders its assigned
--    wall, with optional per-display look/theme/takeover overrides (JSON).

CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

ALTER TABLE monitors ADD COLUMN name TEXT;
ALTER TABLE monitors ADD COLUMN location_id INTEGER REFERENCES locations(id);
ALTER TABLE taps ADD COLUMN location_id INTEGER REFERENCES locations(id);
ALTER TABLE walls ADD COLUMN location_id INTEGER REFERENCES locations(id);

CREATE TABLE displays (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  -- Short pairing code, uppercase alphanumeric, unique while unpaired/forever.
  code TEXT NOT NULL UNIQUE,
  wall_id INTEGER REFERENCES walls(id),
  -- JSON per-display overrides applied over the wall's config:
  -- { look?, themeId?, takeoverStyle? } — validated at the API layer.
  overrides TEXT NOT NULL DEFAULT '{}',
  last_seen TEXT,
  created_at TEXT NOT NULL
);
