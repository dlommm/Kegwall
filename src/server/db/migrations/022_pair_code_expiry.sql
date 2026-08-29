-- Pairing-code expiry (server-hardening review, 2026-08-29). Pairing codes used to be
-- valid FOREVER, so anyone who ever learned a code (e.g. from an old log line — the
-- route used to log the code value — or a glanced admin page) could re-pair the display
-- at will, rotating/invalidating its token each time (token-rotation DoS).
-- `code_issued_at` records when the display's CURRENT code was minted — at creation, or
-- when an editor regenerates it (POST /api/displays/:id/regenerate-code); the public
-- pair endpoint only honors a code within db/displays.ts's PAIR_CODE_TTL_MS (15 min) of
-- this timestamp. Backfilled from created_at, which deliberately EXPIRES every
-- pre-existing code immediately on upgrade (they were all minted long ago); already
-- -paired displays keep working — their token is untouched — and re-pairing just takes
-- one regenerate first. Enforcement of the display TOKEN itself is unchanged and stays
-- gated behind settings.displays.enforceToken (dormant by default — see 018).
ALTER TABLE displays ADD COLUMN code_issued_at TEXT;
UPDATE displays SET code_issued_at = created_at WHERE code_issued_at IS NULL;
