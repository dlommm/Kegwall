import type Database from 'better-sqlite3';

/** A single telemetry sample row, as returned by `listTelemetry`/`latestTelemetryForMonitor`
 * and (Task 6) served straight through `GET /api/monitors/:id/telemetry` for the admin
 * Monitors page's per-Pro-device temp/humidity readout. */
export interface TelemetryPoint { ts: string; temp: number | null; humidity: number | null }

export function recordTelemetrySampled(db: Database.Database, monitorId: number,
  temp: number | null, humidity: number | null, ts: string,
  minIntervalMinutes = 5): boolean {
  const last = db.prepare(
    'SELECT ts FROM telemetry WHERE monitor_id = ? ORDER BY ts DESC LIMIT 1')
    .get(monitorId) as { ts: string } | undefined;
  if (last) {
    const deltaMs = new Date(ts).getTime() - new Date(last.ts).getTime();
    if (deltaMs < minIntervalMinutes * 60_000) return false;
  }
  db.prepare('INSERT INTO telemetry (monitor_id, ts, temp, humidity) VALUES (?, ?, ?, ?)')
    .run(monitorId, ts, temp, humidity);
  return true;
}

export function listTelemetry(db: Database.Database, monitorId: number, since: string): TelemetryPoint[] {
  return db.prepare(
    'SELECT ts, temp, humidity FROM telemetry WHERE monitor_id = ? AND ts >= ? ORDER BY ts')
    .all(monitorId, since) as TelemetryPoint[];
}

/** Most recent telemetry row for a monitor, or `null` when it has never reported one.
 * Backs `StateManager.getTapStates()`'s `TapState.temp` (see core/state.ts) — cheap,
 * indexed (`idx_telemetry_monitor_ts`) single-row lookup, one query per tap-with-a-bound-
 * monitor. */
export function latestTelemetryForMonitor(db: Database.Database, monitorId: number): TelemetryPoint | null {
  const r = db.prepare(
    'SELECT ts, temp, humidity FROM telemetry WHERE monitor_id = ? ORDER BY ts DESC LIMIT 1')
    .get(monitorId) as TelemetryPoint | undefined;
  return r ?? null;
}

/** Most recent telemetry across EVERY port row of a physical device (all monitors
 * sharing type+identifier). Kegtron reports temperature once per DEVICE and the
 * ingest records it on the port-0 row — so a tap bound to port 2 must read its
 * device's telemetry, not its own port row's (which is always empty). */
export function latestTelemetryForDevice(
  db: Database.Database, type: string, identifier: string,
): TelemetryPoint | null {
  const r = db.prepare(
    `SELECT t.ts, t.temp, t.humidity FROM telemetry t
       JOIN monitors m ON m.id = t.monitor_id
      WHERE m.type = ? AND m.identifier = ?
      ORDER BY t.ts DESC LIMIT 1`)
    .get(type, identifier) as TelemetryPoint | undefined;
  return r ?? null;
}

/** `listTelemetry`, widened to the whole physical device — see
 * `latestTelemetryForDevice` for why per-port lookups miss everything on ports > 0. */
export function listTelemetryForDevice(
  db: Database.Database, type: string, identifier: string, since: string,
): TelemetryPoint[] {
  return db.prepare(
    `SELECT t.ts, t.temp, t.humidity FROM telemetry t
       JOIN monitors m ON m.id = t.monitor_id
      WHERE m.type = ? AND m.identifier = ? AND t.ts >= ?
      ORDER BY t.ts`)
    .all(type, identifier, since) as TelemetryPoint[];
}

export function pruneTelemetry(db: Database.Database, olderThanDays = 90): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  return db.prepare('DELETE FROM telemetry WHERE ts < ?').run(cutoff).changes;
}
