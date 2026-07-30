-- Per-tap "hidden" flag: a hidden tap disappears from every public surface (wall,
-- menu, HA entities) but stays fully visible in the admin Taps page so it can be
-- re-enabled — the use case is a multi-port Kegtron with fewer kegs than ports.
ALTER TABLE taps ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
