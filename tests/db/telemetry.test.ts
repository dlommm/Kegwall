import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { upsertMonitor } from '../../src/server/db/monitors.js';
import { recordTelemetrySampled, listTelemetry, pruneTelemetry } from '../../src/server/db/telemetry.js';
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
});
