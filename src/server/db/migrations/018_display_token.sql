-- Display-token pairing (native-display epic, sub-project A). A per-display secret so a
-- display client (the native Flutter wall, or a paired browser wall/tablet) can authenticate
-- to the gated wall/menu/leaderboard/passport/ws reads. `token_hash` is the SHA-256 of the raw
-- token (never stored in plaintext, same as sessions.token_hash); NULL until first paired.
-- `paired_at` is the ISO timestamp of the most recent pair. See db/displays.ts +
-- routes/displayAuth.ts. Enforcement is gated by settings.displays.enforceToken (default off),
-- so this migration is inert until an operator pairs their screens and turns it on.
ALTER TABLE displays ADD COLUMN token_hash TEXT;
ALTER TABLE displays ADD COLUMN paired_at TEXT;
CREATE INDEX idx_displays_token_hash ON displays(token_hash);
