-- Host health history (Pi monitoring epic, follow-up): one row per sampler tick
-- (~60s, see app.ts's host-stats sampler) so the Stats page can chart CPU/RAM/disk/
-- temperature/power over time. Nullable columns mirror hostStats.ts's readers —
-- non-Pi hosts have no temp/watts, containers may have no disk figure.
CREATE TABLE host_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  cpu_pct REAL NOT NULL,
  mem_pct REAL NOT NULL,
  disk_pct REAL,
  temp_c REAL,
  watts REAL
);
CREATE INDEX idx_host_stats_ts ON host_stats (ts);
