import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { EventBus, type MonitorRef } from '../../src/server/core/events.js';
import { LogService } from '../../src/server/core/logService.js';
import { attachWallAutoAssign } from '../../src/server/core/wallAutoAssign.js';
import { listWallDevices, setWallDevices } from '../../src/server/db/wallDevices.js';
import { upsertMonitor } from '../../src/server/db/monitors.js';

let db: Database.Database;
let bus: EventBus;

function createWall(slug: string): number {
  return Number(db.prepare("INSERT INTO walls (slug, name, config) VALUES (?, ?, '{}')")
    .run(slug, slug).lastInsertRowid);
}

function pro(identifier: string, portIndex = 0): MonitorRef {
  return { type: 'kegtron_pro', identifier, portIndex };
}

const TS = '2026-07-31T12:00:00.000Z';

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
});

function attach() {
  attachWallAutoAssign(db, bus, new LogService(db, bus));
}

describe('attachWallAutoAssign', () => {
  it('assigns a newly-online Kegtron to every empty wall', () => {
    const wallA = createWall('main');
    const wallB = createWall('garage');
    attach();
    bus.emit('device_online', { monitor: pro('dev-1'), ts: TS });
    expect(listWallDevices(db, wallA)).toEqual([{ type: 'kegtron_pro', identifier: 'dev-1' }]);
    expect(listWallDevices(db, wallB)).toEqual([{ type: 'kegtron_pro', identifier: 'dev-1' }]);
  });

  it('never touches a wall that already has devices', () => {
    const empty = createWall('main');
    const populated = createWall('garage');
    setWallDevices(db, populated, [{ type: 'kegtron_gen1', identifier: 'aa:bb' }]);
    attach();
    bus.emit('device_online', { monitor: pro('dev-1'), ts: TS });
    expect(listWallDevices(db, empty)).toHaveLength(1);
    expect(listWallDevices(db, populated)).toEqual([{ type: 'kegtron_gen1', identifier: 'aa:bb' }]);
  });

  it('is a no-op for a device already explicitly assigned anywhere', () => {
    const assignedTo = createWall('garage');
    setWallDevices(db, assignedTo, [{ type: 'kegtron_pro', identifier: 'dev-1' }]);
    const empty = createWall('main');
    attach();
    bus.emit('device_online', { monitor: pro('dev-1'), ts: TS });
    expect(listWallDevices(db, empty)).toEqual([]);
  });

  it('ignores non-Kegtron monitor types', () => {
    const wall = createWall('main');
    attach();
    bus.emit('device_online', {
      monitor: { type: 'govee_sensor', identifier: 'gv-1', portIndex: 0 }, ts: TS,
    });
    expect(listWallDevices(db, wall)).toEqual([]);
  });

  it('sweeps already-known monitors at attach time (wall created after device)', () => {
    upsertMonitor(db, pro('dev-old', 0));
    upsertMonitor(db, pro('dev-old', 1)); // second port must not double-assign
    const wall = createWall('main');
    attach();
    expect(listWallDevices(db, wall)).toEqual([{ type: 'kegtron_pro', identifier: 'dev-old' }]);
  });

  it('emits state_changed(walls) when it assigns, and stays quiet when idle', () => {
    createWall('main');
    attach();
    const scopes: string[] = [];
    bus.on('state_changed', (e) => scopes.push(e.scope));
    bus.emit('device_online', { monitor: pro('dev-1'), ts: TS });
    expect(scopes).toEqual(['walls']);
    // Second online for the now-assigned device: no further writes, no event.
    bus.emit('device_online', { monitor: pro('dev-1'), ts: TS });
    expect(scopes).toEqual(['walls']);
  });
});
