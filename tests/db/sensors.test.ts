import {
  describe, it, expect, beforeEach,
} from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { upsertMonitor, updateMonitorDeviceIdentity } from '../../src/server/db/monitors.js';
import { recordTelemetrySampled } from '../../src/server/db/telemetry.js';
import { sensorSummaries } from '../../src/server/db/sensors.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktsensors-')));
});

const NOW = new Date('2026-07-31T12:00:00.000Z');

describe('sensorSummaries', () => {
  it('summarizes each temp-reporting sensor with its latest reading and 7-day range', () => {
    const kId = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'k', portIndex: 0 }).id;
    recordTelemetrySampled(db, kId, 2, null, '2026-07-28T00:00:00.000Z');
    recordTelemetrySampled(db, kId, 4, null, '2026-07-29T00:00:00.000Z');
    recordTelemetrySampled(db, kId, 3, null, '2026-07-31T00:00:00.000Z');
    const gId = upsertMonitor(db, { type: 'govee_sensor', identifier: 'g', portIndex: 0 }).id;
    recordTelemetrySampled(db, gId, 6, 55, '2026-07-31T00:00:00.000Z');

    const rows = sensorSummaries(db, NOW);
    expect(rows).toHaveLength(2);
    // Kegtron probes sort first (the serving-temp reference).
    expect(rows[0]).toMatchObject({
      kind: 'kegtron', tempC: 3, humidity: null, min7dC: 2, max7dC: 4,
    });
    expect(rows[1]).toMatchObject({ kind: 'govee', tempC: 6, humidity: 55 });
  });

  it('excludes a disabled sensor, one with no telemetry, and non-zero port rows', () => {
    // Enabled kegtron with telemetry — the only one that should appear.
    const kId = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'k', portIndex: 0 }).id;
    recordTelemetrySampled(db, kId, 3, null, '2026-07-31T00:00:00.000Z');
    // Extra port row of the same device — temp is device-level, so this must not double-count.
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'k', portIndex: 1 });
    // Monitor with no telemetry at all.
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'silent', portIndex: 0 });
    // Disabled Govee — has readings but is turned off.
    const gId = upsertMonitor(db, { type: 'govee_sensor', identifier: 'g', portIndex: 0 }).id;
    recordTelemetrySampled(db, gId, 6, 55, '2026-07-31T00:00:00.000Z');
    updateMonitorDeviceIdentity(db, gId, { enabled: false });

    const rows = sensorSummaries(db, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(kId);
  });
});
