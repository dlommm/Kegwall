-- Optional manual keg-asset override for the KegFill wall display (keg-asset fill
-- indicator feature): when set, KegFill renders this asset instead of auto-matching the
-- keg's size_ml against the volume table (see src/web/lib/kegAssets.ts's
-- resolveKegAsset/matchKegType). NULL means "auto" -- the default for every existing
-- keg, and for any new keg the swap wizard / on-deck form's "Keg type" select leaves on
-- "Auto".
--
-- A plain nullable column add, like 004_tap_default_drinker.sql -- SQLite allows a CHECK
-- on an ADD COLUMN as long as it only references the new column and constants (never
-- other rows/columns), and by SQL's normal three-valued logic NULL always satisfies a
-- CHECK regardless of what it checks, so every pre-existing row (which gets NULL here)
-- passes without needing 003_on_deck_status.sql's "recreate the table" dance.
--
-- The 7 ids below must stay in sync BY HAND with src/web/lib/kegAssets.ts's
-- KEG_ASSET_IDS and routes/crud.ts's kegType zod enum -- same convention this repo
-- already uses for kegs.status's CHECK vs. the KegStatus TS union.
ALTER TABLE kegs ADD COLUMN keg_type TEXT CHECK (keg_type IN (
  'half-barrel', 'quarter-barrel', 'sixth-barrel', 'fifty-liter', 'cornelius', 'slim-quarter', 'mini-keg'
));
