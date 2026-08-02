-- Drinking-games system (WebUI redesign Phase 5). The `games` catalog is seeded from
-- db/gamesCatalog.ts (idempotent, by name) at boot; sessions/participants/results track a
-- live game. Results post to the ONE house leaderboard as a superlative chip + passport
-- badge — there is deliberately no separate game leaderboard (hard requirement).

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  premise TEXT NOT NULL,
  -- AUTO (sensor-verified) | TABLET (logged by tap) | HYBRID
  tracking TEXT NOT NULL CHECK (tracking IN ('AUTO', 'TABLET', 'HYBRID')),
  metric TEXT NOT NULL,
  win_rule TEXT NOT NULL,
  duration TEXT,
  min_players INTEGER NOT NULL DEFAULT 1,
  max_players INTEGER,
  -- Optional JSON flags (e.g. seasonal, team). NULL = none.
  flags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE game_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  settings_json TEXT
);

CREATE TABLE game_participants (
  session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  drinker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team TEXT,
  PRIMARY KEY (session_id, drinker_id)
);

CREATE TABLE game_results (
  session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  drinker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (session_id, drinker_id)
);

-- Only one game runs at a time in the taproom. A unique index over the CONSTANT expression
-- `(ended_at IS NULL)` (which is 1 for every active row) enforces it — a plain UNIQUE(ended_at)
-- wouldn't, since SQLite treats NULLs as distinct and would allow many active sessions.
CREATE UNIQUE INDEX idx_game_sessions_active
  ON game_sessions((ended_at IS NULL)) WHERE ended_at IS NULL;
