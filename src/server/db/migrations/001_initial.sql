CREATE TABLE beers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  brewery TEXT,
  style TEXT,
  abv REAL,
  ibu REAL,
  srm REAL,
  description TEXT,
  label_image TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE taps (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  name TEXT
);

CREATE TABLE kegs (
  id INTEGER PRIMARY KEY,
  beer_id INTEGER NOT NULL REFERENCES beers(id),
  tap_id INTEGER REFERENCES taps(id),
  size_ml INTEGER NOT NULL,
  vol_start_ml INTEGER NOT NULL,
  vol_dispensed_ml INTEGER NOT NULL DEFAULT 0,
  date_tapped TEXT,
  status TEXT NOT NULL DEFAULT 'on_tap' CHECK (status IN ('on_tap','kicked','archived')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_kegs_tap ON kegs(tap_id) WHERE status = 'on_tap';

CREATE TABLE monitors (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('kegtron_pro','kegtron_gen1')),
  identifier TEXT NOT NULL,          -- Pro: mdash device id; Gen 1: MAC (lowercase, colon-separated)
  serial TEXT,
  port_index INTEGER NOT NULL DEFAULT 0,
  tap_id INTEGER REFERENCES taps(id),
  last_seen TEXT,
  meta TEXT NOT NULL DEFAULT '{}',   -- JSON: fw, model, port name as reported, etc.
  UNIQUE (type, identifier, port_index)
);

CREATE TABLE pours (
  id INTEGER PRIMARY KEY,
  keg_id INTEGER NOT NULL REFERENCES kegs(id),
  ts TEXT NOT NULL,
  volume_ml REAL NOT NULL,
  duration_ms INTEGER,
  source TEXT NOT NULL CHECK (source IN ('cloud','udp','ble')),
  drinker_id INTEGER REFERENCES users(id)
);
CREATE INDEX idx_pours_keg_ts ON pours(keg_id, ts);
CREATE INDEX idx_pours_ts ON pours(ts);

CREATE TABLE telemetry (
  id INTEGER PRIMARY KEY,
  monitor_id INTEGER NOT NULL REFERENCES monitors(id),
  ts TEXT NOT NULL,
  temp REAL,
  humidity REAL
);
CREATE INDEX idx_telemetry_monitor_ts ON telemetry(monitor_id, ts);

CREATE TABLE walls (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}'  -- JSON, validated by zod at the API layer
);

CREATE TABLE automations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_alert INTEGER NOT NULL DEFAULT 0,
  trigger TEXT NOT NULL,             -- JSON
  conditions TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  last_fired_at TEXT
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  automation_id INTEGER REFERENCES automations(id),
  ts TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT,
  acked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                -- JSON-encoded
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,              -- NULL for drinker-only profiles
  display_name TEXT NOT NULL,
  password_hash TEXT,                -- NULL for drinker-only profiles
  role TEXT CHECK (role IN ('admin','editor','viewer')),  -- NULL for drinker-only
  is_drinker INTEGER NOT NULL DEFAULT 1,
  avatar_color TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);
