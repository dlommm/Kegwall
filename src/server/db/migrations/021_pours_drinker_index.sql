-- Index for per-drinker pour lookups. The public pourer/leaderboard endpoints
-- (routes/featurePack.ts: passport totals/recent, leaderboard grouping) and the tablet's
-- pour-count/recent-tiles queries all filter `WHERE drinker_id = ?`, most with
-- `ORDER BY ts DESC` — previously a full pours scan per request. The composite
-- (drinker_id, ts) shape serves the equality filter AND the ts ordering/MAX(ts) in one
-- index walk.
CREATE INDEX idx_pours_drinker_ts ON pours(drinker_id, ts);
