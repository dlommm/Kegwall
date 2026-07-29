import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { StateManager } from '../../src/server/core/state.js';
import { TabletArmRegistry } from '../../src/server/core/tabletArm.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap, updateTap } from '../../src/server/db/taps.js';
import { createKeg } from '../../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createDrinker } from '../../src/server/db/users.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
let db: Database.Database;
let bus: EventBus;
let arm: TabletArmRegistry;
let sm: StateManager;
let tapId: number;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
  arm = new TabletArmRegistry();
  sm = new StateManager(db, bus, arm);
  sm.start();
  const beer = createBeer(db, { name: 'Morning Line', srm: 3 });
  tapId = createTap(db, { number: 2 }).id;
  createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId });
  const mon = upsertMonitor(db, ref);
  bindMonitorToTap(db, mon.id, tapId);
});

function emitPour(volumeMl = 372, ts = '2026-07-29T01:00:00.000Z') {
  bus.emit('pour_completed', {
    monitor: ref, volumeMl, durationMs: 6000, source: 'udp', ts,
  });
}

describe('StateManager tablet attribution (Pour Wall overhaul Phase 3)', () => {
  it('attributes a recorded pour to the armed pourer and emits pour_attributed', () => {
    const pourer = createDrinker(db, { displayName: 'Sam' });
    arm.arm(pourer.id);
    const attributed = vi.fn();
    bus.on('pour_attributed', attributed);

    emitPour(372);

    const row = db.prepare('SELECT drinker_id FROM pours ORDER BY id DESC LIMIT 1').get() as any;
    expect(row.drinker_id).toBe(pourer.id);
    expect(attributed).toHaveBeenCalledTimes(1);
    const payload = attributed.mock.calls[0]![0];
    expect(payload).toMatchObject({
      drinkerId: pourer.id, tapNumber: 2, beerName: 'Morning Line', volumeMl: 372, pourCount: 1,
    });
    // One pour per arming: the next pour is unclaimed and emits nothing.
    emitPour(300, '2026-07-29T01:10:00.000Z');
    const next = db.prepare('SELECT drinker_id FROM pours ORDER BY id DESC LIMIT 1').get() as any;
    expect(next.drinker_id).toBeNull();
    expect(attributed).toHaveBeenCalledTimes(1);
  });

  it('an armed pourer beats the tap default drinker; no pour_attributed for default-drinker stamps', () => {
    const defaultDrinker = createDrinker(db, { displayName: 'House' });
    const armed = createDrinker(db, { displayName: 'Sam' });
    updateTap(db, tapId, { defaultDrinkerId: defaultDrinker.id });
    const attributed = vi.fn();
    bus.on('pour_attributed', attributed);

    arm.arm(armed.id);
    emitPour(372);
    let row = db.prepare('SELECT drinker_id FROM pours ORDER BY id DESC LIMIT 1').get() as any;
    expect(row.drinker_id).toBe(armed.id);
    expect(attributed).toHaveBeenCalledTimes(1);

    // Disarmed: the default drinker applies, silently (no tablet event).
    emitPour(300, '2026-07-29T01:10:00.000Z');
    row = db.prepare('SELECT drinker_id FROM pours ORDER BY id DESC LIMIT 1').get() as any;
    expect(row.drinker_id).toBe(defaultDrinker.id);
    expect(attributed).toHaveBeenCalledTimes(1);
  });

  it('stores a quality score computed from the pour_started/progress sample stream', () => {
    // A steady 500ms-interval stream: constant flow → top score.
    bus.emit('pour_started', { monitor: ref, ts: '2026-07-29T01:00:00.000Z' });
    for (let i = 1; i <= 8; i += 1) {
      bus.emit('pour_progress', {
        monitor: ref,
        curServMl: i * 45,
        ts: new Date(Date.parse('2026-07-29T01:00:00.000Z') + i * 500).toISOString(),
      });
    }
    emitPour(372, new Date(Date.parse('2026-07-29T01:00:00.000Z') + 4500).toISOString());
    const row = db.prepare('SELECT quality FROM pours ORDER BY id DESC LIMIT 1').get() as any;
    expect(row.quality).toBe(100);
  });

  it('stores no quality for a pour with no live sample stream (cloud-only)', () => {
    emitPour(372);
    const row = db.prepare('SELECT quality FROM pours ORDER BY id DESC LIMIT 1').get() as any;
    expect(row.quality).toBeNull();
  });
});
