-- Wall <-> Kegtron-device assignment: a wall shows only taps bound to ports of its
-- assigned devices, and a wall with NO assigned devices shows NO taps (strict — an
-- explicit product decision; existing walls are deliberately NOT seeded, so they render
-- empty until devices are assigned in the wall editor).
--
-- A "device" is the derived (type, identifier) grouping of monitors rows — there is no
-- devices table, so the pair is stored verbatim and no FK to monitors is possible
-- ((type, identifier) is not unique there). A dangling pair (device later renamed or
-- re-identified) is harmless: it simply contributes no taps.
CREATE TABLE wall_devices (
  id INTEGER PRIMARY KEY,
  wall_id INTEGER NOT NULL REFERENCES walls(id) ON DELETE CASCADE,
  monitor_type TEXT NOT NULL CHECK (monitor_type IN ('kegtron_pro', 'kegtron_gen1')),
  monitor_identifier TEXT NOT NULL,
  UNIQUE (wall_id, monitor_type, monitor_identifier)
);
