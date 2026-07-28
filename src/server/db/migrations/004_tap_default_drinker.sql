-- Per-tap default drinker (Phase 5 Task 0, Phase 4 final review "admin pours management"
-- carry-over item): when set, StateManager stamps this drinker onto a pour_completed
-- record if the pour would otherwise land unclaimed (see core/state.ts). NULL means
-- "no default" — the existing behavior (pours record with drinker_id = NULL until
-- claimed via the public claim flow, or reassigned by an admin).
--
-- A plain nullable column add — unlike 003_on_deck_status.sql's widened CHECK, this
-- doesn't need the "recreate the table" dance (SQLite supports ADD COLUMN directly for a
-- nullable column with no CHECK/default expression referencing other rows).
ALTER TABLE taps ADD COLUMN default_drinker_id INTEGER REFERENCES users(id);
