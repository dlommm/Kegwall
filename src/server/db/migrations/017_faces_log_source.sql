-- Face sign-in (Plan B): widen logs.source's CHECK to accept 'faces' (routes/public.ts's
-- enroll route logs via app.ctx.log.info('faces', ...) -- see db/logs.ts's LogSource).
--
-- SQLite has no ALTER TABLE ... ALTER COLUMN / MODIFY CHECK, so per the 003_on_deck_status.sql
-- / 012_govee_monitors.sql precedent this recreates the table under a widened CHECK and
-- copies every row across unchanged. Nothing references logs(id) via a foreign key, so
-- there's no id-preservation concern beyond the copy itself.
CREATE TABLE logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  source TEXT NOT NULL CHECK (source IN ('app', 'kegtron', 'wall', 'tablet', 'sensors', 'automations', 'pours', 'faces')),
  message TEXT NOT NULL,
  detail TEXT
);

INSERT INTO logs_new (id, ts, level, source, message, detail)
  SELECT id, ts, level, source, message, detail FROM logs;

DROP TABLE logs;
ALTER TABLE logs_new RENAME TO logs;

CREATE INDEX idx_logs_ts ON logs (ts);
CREATE INDEX idx_logs_level_ts ON logs (level, ts);
