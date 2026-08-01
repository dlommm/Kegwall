import type Database from 'better-sqlite3';

/** One host-health sample (migration 014) — written every ~60s by app.ts's sampler,
 * charted by the Stats page via GET /api/system/stats/history. */
export interface HostStatsPoint {
  ts: string;
  cpuPct: number;
  memPct: number;
  diskPct: number | null;
  tempC: number | null;
  watts: number | null;
}

export function recordHostStats(db: Database.Database, p: HostStatsPoint): void {
  db.prepare(
    'INSERT INTO host_stats (ts, cpu_pct, mem_pct, disk_pct, temp_c, watts) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(p.ts, p.cpuPct, p.memPct, p.diskPct, p.tempC, p.watts);
}

export function listHostStats(db: Database.Database, since: string): HostStatsPoint[] {
  return (db.prepare(
    `SELECT ts, cpu_pct cpuPct, mem_pct memPct, disk_pct diskPct, temp_c tempC, watts
       FROM host_stats WHERE ts >= ? ORDER BY ts`,
  ).all(since) as HostStatsPoint[]);
}

/** `listHostStats` bucketed down to at most `maxPoints` rows (average per bucket) —
 * a week of 60s samples is ~10k rows, far more than a 300px-tall chart can show or a
 * kiosk-grade CPU should ship over JSON. Buckets average every numeric column;
 * all-null columns stay null. */
export function listHostStatsBucketed(
  db: Database.Database, since: string, maxPoints = 360,
): HostStatsPoint[] {
  const rows = listHostStats(db, since);
  if (rows.length <= maxPoints) return rows;
  const bucketSize = Math.ceil(rows.length / maxPoints);
  const out: HostStatsPoint[] = [];
  for (let i = 0; i < rows.length; i += bucketSize) {
    const bucket = rows.slice(i, i + bucketSize);
    const avg = (pick: (r: HostStatsPoint) => number | null): number | null => {
      const vals = bucket.map(pick).filter((v): v is number => v != null);
      if (vals.length === 0) return null;
      return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
    };
    out.push({
      ts: bucket[0]!.ts,
      cpuPct: avg((r) => r.cpuPct) ?? 0,
      memPct: avg((r) => r.memPct) ?? 0,
      diskPct: avg((r) => r.diskPct),
      tempC: avg((r) => r.tempC),
      watts: avg((r) => r.watts),
    });
  }
  return out;
}

/** 30 days, not telemetry's 90 — this is ops data for trend-spotting, not history
 * anyone treasures; 30d of 60s samples is ~43k tiny rows. */
export function pruneHostStats(db: Database.Database, olderThanDays = 30): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  return db.prepare('DELETE FROM host_stats WHERE ts < ?').run(cutoff).changes;
}
