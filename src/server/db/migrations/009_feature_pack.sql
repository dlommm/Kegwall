-- Pour Wall overhaul Phase 6 feature pack (designs 6a/6d/6e):
--
-- 1. Pour ratings (6a, rate-after-claim): 1-5 stars + quick tags on a claimed
--    pour ("Crisp", "Perfect temp", "Foamy" — stored as a JSON array).
-- 2. Keg cost tracking (6d): what the keg cost, in cents, for $/pint and
--    value-on-tap analytics. NULL = not tracked.
-- 3. Line cleaning log (6e): one row per cleaning per tap; "due" is derived
--    (>15 gal poured or >4 weeks since the last row — see db/cleanings.ts).
ALTER TABLE pours ADD COLUMN rating INTEGER;
ALTER TABLE pours ADD COLUMN rating_tags TEXT;
ALTER TABLE kegs ADD COLUMN cost_cents INTEGER;

CREATE TABLE line_cleanings (
  id INTEGER PRIMARY KEY,
  tap_id INTEGER NOT NULL REFERENCES taps(id),
  ts TEXT NOT NULL,
  note TEXT
);

CREATE INDEX idx_line_cleanings_tap_ts ON line_cleanings (tap_id, ts);
