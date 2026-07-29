-- Pour quality score (Pour Wall overhaul Phase 3, design 6b): 0-100 computed from
-- UDP flow-rate consistency at pour-completion time (see core/pourQuality.ts). NULL
-- for pours with too few live samples to score (cloud-only pours, very short pours,
-- and every pour recorded before this feature existed).
--
-- Plain nullable column add — no CHECK/default, so SQLite's ADD COLUMN works directly.
ALTER TABLE pours ADD COLUMN quality INTEGER;
