-- Enforce the one-active-keg-per-tap invariant at the DB layer. Previously
-- idx_kegs_tap was a plain (non-unique) partial index, so nothing stopped a
-- second status='on_tap' row landing on the same tap_id; getActiveKegForTap
-- would then return an arbitrary one of the two. createKeg() also gained an
-- application-level ConflictError guard (see src/server/db/kegs.ts) so API
-- clients get a clean 409 instead of a raw SqliteError from this index.
DROP INDEX idx_kegs_tap;
CREATE UNIQUE INDEX idx_kegs_tap_active ON kegs(tap_id) WHERE status = 'on_tap' AND tap_id IS NOT NULL;
