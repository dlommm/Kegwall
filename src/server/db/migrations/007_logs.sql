-- Unified log stream (Pour Wall overhaul Phase 4, design 5d): one table for every
-- subsystem's operational events — app, kegtron, wall, tablet, sensors, automations,
-- pours. Written by core/logService.ts, read by /api/logs with source/level filters,
-- search, ranges, live tail and export. Retention default 30 days (pruned at boot,
-- configurable via the `logRetentionDays` setting).
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  source TEXT NOT NULL CHECK (source IN ('app', 'kegtron', 'wall', 'tablet', 'sensors', 'automations', 'pours')),
  message TEXT NOT NULL,
  -- Optional expandable detail (e.g. an error's request context), plain text/JSON.
  detail TEXT
);

CREATE INDEX idx_logs_ts ON logs (ts);
CREATE INDEX idx_logs_level_ts ON logs (level, ts);
