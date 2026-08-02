import type Database from 'better-sqlite3';
import { listMonitors } from './monitors.js';
import { latestTelemetryForMonitor } from './telemetry.js';

/**
 * A temperature/humidity sensor's current state plus its trailing-7-day range, for the
 * dashboard's per-sensor cards (WebUI redesign 3b). One row per physical, enabled sensor
 * that actually reports temperature — Kegtron probes (temp is device-level, on port 0) and
 * Govee sensors alike. Min/max come from the real `telemetry` history (retained 90 days),
 * so the card's range note is never fabricated.
 */
export interface SensorSummary {
  id: number;
  name: string;
  kind: 'kegtron' | 'govee';
  tempC: number | null;
  /** Only Govee sensors report humidity; Kegtron probes leave this null. */
  humidity: number | null;
  lastSeen: string | null;
  min7dC: number | null;
  max7dC: number | null;
}

export function sensorSummaries(db: Database.Database, now = new Date()): SensorSummary[] {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rangeStmt = db.prepare(
    `SELECT MIN(temp) AS min, MAX(temp) AS max FROM telemetry
       WHERE monitor_id = ? AND ts >= ? AND temp IS NOT NULL`,
  );
  const out: SensorSummary[] = [];
  for (const mon of listMonitors(db)) {
    // Temperature is reported once per physical device on port 0 — skip the extra port
    // rows of a multi-tap Kegtron so a device contributes exactly one sensor card.
    if (mon.portIndex !== 0) continue;
    if (!mon.enabled) continue;
    const latest = latestTelemetryForMonitor(db, mon.id);
    if (!latest || latest.temp == null) continue;
    const range = rangeStmt.get(mon.id, since) as { min: number | null; max: number | null };
    const kind = mon.type === 'govee_sensor' ? 'govee' : 'kegtron';
    out.push({
      id: mon.id,
      name: mon.name ?? (kind === 'govee' ? 'Govee sensor' : 'Kegtron'),
      kind,
      tempC: latest.temp,
      humidity: latest.humidity,
      lastSeen: latest.ts,
      min7dC: range.min,
      max7dC: range.max,
    });
  }
  // Kegtron probes first — they're the serving-temp reference the Govee deltas compare against.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'kegtron' ? -1 : 1));
}
