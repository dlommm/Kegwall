-- When a keg was kicked, so "kegs kicked in the last 30 days" counts kicks rather than
-- "kicked kegs that happened to be poured from in the window". Existing kicked kegs take
-- their last pour's time as the best available guess; a kicked keg never poured stays NULL.
ALTER TABLE kegs ADD COLUMN kicked_at TEXT;
UPDATE kegs SET kicked_at = (SELECT MAX(p.ts) FROM pours p WHERE p.keg_id = kegs.id)
  WHERE status = 'kicked';
