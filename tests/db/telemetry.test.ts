import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { upsertMonitor } from '../../src/server/db/monitors.js';
import {
  recordTelemetrySampled, listTelemetry, pruneTelemetry, latestTelemetryForMonitor,
} from '../../src/server/db/telemetry.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
let monitorId: number;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  monitorId = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'd', portIndex: 0 }).id;
});

describe('telemetry repo', () => {
  it('samples: skips writes within the min interval', () => {
    expect(recordTelemetrySampled(db, monitorId, 4.2, 50, '2026-07-27T01:00:00.000Z')).toBe(true);
    expect(recordTelemetrySampled(db, monitorId, 4.3, 51, '2026-07-27T01:02:00.000Z')).toBe(false);
    expect(recordTelemetrySampled(db, monitorId, 4.4, 52, '2026-07-27T01:06:00.000Z')).toBe(true);
    expect(listTelemetry(db, monitorId, '2026-07-27T00:00:00.000Z')).toHaveLength(2);
  });

  it('prunes old rows', () => {
    recordTelemetrySampled(db, monitorId, 4, 50, '2020-01-01T00:00:00.000Z');
    recordTelemetrySampled(db, monitorId, 4, 50, new Date().toISOString());
    expect(pruneTelemetry(db, 90)).toBe(1);
  });

  it('latestTelemetryForMonitor returns null when a monitor has no telemetry rows', () => {
    expect(latestTelemetryForMonitor(db, monitorId)).toBeNull();
  });

  it('latestTelemetryForMonitor returns the most recent row for that monitor', () => {
    recordTelemetrySampled(db, monitorId, 4.2, 50, '2026-07-27T01:00:00.000Z');
    recordTelemetrySampled(db, monitorId, 4.9, 52, '2026-07-27T01:10:00.000Z');
    const latest = latestTelemetryForMonitor(db, monitorId);
    expect(latest).toMatchObject({ temp: 4.9, humidity: 52, ts: '2026-07-27T01:10:00.000Z' });
  });

  it('latestTelemetryForMonitor is scoped to the given monitor', () => {
    const otherMonitorId = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'd2', portIndex: 0 }).id;
    recordTelemetrySampled(db, otherMonitorId, 9.9, 40, '2026-07-27T01:00:00.000Z');
    expect(latestTelemetryForMonitor(db, monitorId)).toBeNull();
  });
});
