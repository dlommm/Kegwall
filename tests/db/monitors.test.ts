import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createTap } from '../../src/server/db/taps.js';
import {
  upsertMonitor, bindMonitorToTap, getMonitorByRef, resolveTapForRef, listMonitors,
  reconcileProMonitor, sanitizeMonitor,
} from '../../src/server/db/monitors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 2 };
let db: Database.Database;
beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

describe('monitors repo', () => {
  it('upserts: inserts once, updates last_seen after', () => {
    const first = upsertMonitor(db, ref, { serial: 'SN123' });
    const second = upsertMonitor(db, ref);
    expect(second.id).toBe(first.id);
    expect(listMonitors(db)).toHaveLength(1);
    expect(second.serial).toBe('SN123'); // serial preserved when not re-sent
  });

  it('binds to a tap and resolves refs', () => {
    const tap = createTap(db, { number: 1 });
    const mon = upsertMonitor(db, ref);
    bindMonitorToTap(db, mon.id, tap.id);
    expect(resolveTapForRef(db, ref)).toBe(tap.id);
    expect(resolveTapForRef(db, { ...ref, portIndex: 3 })).toBeNull();
    expect(getMonitorByRef(db, ref)?.tapId).toBe(tap.id);
  });

  describe('reconcileProMonitor', () => {
    it('resolves a UDP serial+port to the cloud-discovered monitor ref', () => {
      upsertMonitor(db, { type: 'kegtron_pro', identifier: 'mdash-device-abc', portIndex: 0 },
        { serial: 'SN2001011234' });

      expect(reconcileProMonitor(db, 'SN2001011234', 0)).toEqual({
        type: 'kegtron_pro', identifier: 'mdash-device-abc', portIndex: 0,
      });
    });

    it('returns null for an unknown serial/port pair', () => {
      expect(reconcileProMonitor(db, 'NOPE', 0)).toBeNull();
    });

    it('does not match a different port on the same serial', () => {
      upsertMonitor(db, { type: 'kegtron_pro', identifier: 'mdash-device-abc', portIndex: 0 },
        { serial: 'SN2001011234' });

      expect(reconcileProMonitor(db, 'SN2001011234', 1)).toBeNull();
    });

    it('never matches a kegtron_gen1 row even if it somehow carried the same serial', () => {
      upsertMonitor(db, { type: 'kegtron_gen1', identifier: 'aa:bb:cc:dd:ee:ff', portIndex: 0 },
        { serial: 'SN2001011234' });

      expect(reconcileProMonitor(db, 'SN2001011234', 0)).toBeNull();
    });
  });

  describe('sanitizeMonitor', () => {
    it('strips meta.deviceKey but keeps the rest of meta intact', () => {
      const mon = upsertMonitor(db, ref, {
        meta: { deviceKey: 'device-secret-shhh', maker: 'Acme', style: 'Lager' },
      });
      const sanitized = sanitizeMonitor(mon);
      expect(sanitized.meta).not.toHaveProperty('deviceKey');
      expect(sanitized.meta).toEqual({ maker: 'Acme', style: 'Lager' });
      expect(JSON.stringify(sanitized)).not.toContain('device-secret-shhh');
    });

    it('is a no-op when meta has no deviceKey', () => {
      const mon = upsertMonitor(db, ref, { meta: { maker: 'Acme' } });
      expect(sanitizeMonitor(mon)).toEqual(mon);
    });
  });
});
