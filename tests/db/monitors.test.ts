import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createTap } from '../../src/server/db/taps.js';
import {
  upsertMonitor, bindMonitorToTap, getMonitorByRef, resolveTapForRef, listMonitors,
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
});
