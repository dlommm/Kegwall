import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createTap } from '../../src/server/db/taps.js';
import {
  listWallDevices, setWallDevices, allowedTapIdsForWall,
} from '../../src/server/db/wallDevices.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
let wallId: number;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  db.prepare(`INSERT INTO walls (slug, name, config) VALUES ('main', 'Main', '{}')`).run();
  wallId = (db.prepare(`SELECT id FROM walls WHERE slug = 'main'`).get() as any).id;
});

describe('wallDevices', () => {
  it('setWallDevices replaces the whole assignment atomically', () => {
    setWallDevices(db, wallId, [
      { type: 'kegtron_pro', identifier: 'a' },
      { type: 'kegtron_gen1', identifier: 'b' },
    ]);
    expect(listWallDevices(db, wallId)).toHaveLength(2);
    const after = setWallDevices(db, wallId, [{ type: 'kegtron_pro', identifier: 'c' }]);
    expect(after).toEqual([{ type: 'kegtron_pro', identifier: 'c' }]);
    expect(listWallDevices(db, wallId)).toEqual([{ type: 'kegtron_pro', identifier: 'c' }]);
  });

  it('deleting a wall cascades its device assignments away', () => {
    setWallDevices(db, wallId, [{ type: 'kegtron_pro', identifier: 'a' }]);
    db.prepare('DELETE FROM walls WHERE id = ?').run(wallId);
    expect((db.prepare('SELECT COUNT(*) c FROM wall_devices').get() as any).c).toBe(0);
  });

  it('allowedTapIdsForWall: strict — no assigned devices means NO taps', () => {
    createTap(db, { number: 1 });
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'a', portIndex: 0 });
    expect(allowedTapIdsForWall(db, wallId)).toEqual([]);
  });

  it('allowedTapIdsForWall resolves DISTINCT bound taps across the devices\' ports, '
    + 'skipping unbound ports and other devices', () => {
    const tap1 = createTap(db, { number: 1 }).id;
    const tap2 = createTap(db, { number: 2 }).id;
    const tapOther = createTap(db, { number: 3 }).id;
    const a0 = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'a', portIndex: 0 });
    const a1 = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'a', portIndex: 1 });
    upsertMonitor(db, { type: 'kegtron_pro', identifier: 'a', portIndex: 2 }); // unbound
    const rival = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'rival', portIndex: 0 });
    bindMonitorToTap(db, a0.id, tap1);
    bindMonitorToTap(db, a1.id, tap2);
    bindMonitorToTap(db, rival.id, tapOther);
    setWallDevices(db, wallId, [{ type: 'kegtron_pro', identifier: 'a' }]);
    expect(allowedTapIdsForWall(db, wallId)).toEqual([tap1, tap2]);
  });

  it('a device can be assigned to multiple walls at once', () => {
    db.prepare(`INSERT INTO walls (slug, name, config) VALUES ('second', 'Second', '{}')`).run();
    const wall2 = (db.prepare(`SELECT id FROM walls WHERE slug = 'second'`).get() as any).id;
    setWallDevices(db, wallId, [{ type: 'kegtron_pro', identifier: 'a' }]);
    setWallDevices(db, wall2, [{ type: 'kegtron_pro', identifier: 'a' }]);
    expect(listWallDevices(db, wallId)).toHaveLength(1);
    expect(listWallDevices(db, wall2)).toHaveLength(1);
  });
});
