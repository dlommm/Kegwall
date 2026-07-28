import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { StateManager } from '../../src/server/core/state.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg } from '../../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
let db: Database.Database;
let bus: EventBus;
let sm: StateManager;
let tapId: number;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
  sm = new StateManager(db, bus);
  sm.start();
  const beer = createBeer(db, { name: 'Citra IPA', srm: 6 });
  tapId = createTap(db, { number: 1 }).id;
  createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId });
  const mon = upsertMonitor(db, ref);
  bindMonitorToTap(db, mon.id, tapId);
});

describe('StateManager', () => {
  it('applies volume_update to the bound tap keg and computes level', () => {
    bus.emit('volume_update', {
      monitor: ref, volStartMl: 19000, volDispensedMl: 4750, sizeMl: 19000,
      ts: '2026-07-27T01:00:00.000Z',
    });
    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.keg!.volDispensedMl).toBe(4750);
    expect(tap.keg!.levelPct).toBe(75);
    expect(tap.beer!.name).toBe('Citra IPA');
  });

  it('records pour_completed into pours and updates keg', () => {
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 400, durationMs: 6000, source: 'cloud',
      ts: '2026-07-27T01:00:00.000Z',
    });
    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.lastPour?.volumeMl).toBe(400);
    expect((db.prepare('SELECT COUNT(*) c FROM pours').get() as any).c).toBe(1);
  });

  it('tracks live pouring state and clears it on completion', () => {
    bus.emit('pour_started', { monitor: ref, ts: '2026-07-27T01:00:00.000Z' });
    bus.emit('pour_progress', { monitor: ref, curServMl: 120, ts: '2026-07-27T01:00:01.000Z' });
    let tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.pouring).toBe(true);
    expect(tap.curServMl).toBe(120);
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 130, durationMs: 2000, source: 'udp',
      ts: '2026-07-27T01:00:02.000Z',
    });
    tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.pouring).toBe(false);
    expect(tap.curServMl).toBeNull();
  });

  it('broadcasts state_changed after handling an event', () => {
    const fn = vi.fn();
    bus.on('state_changed', fn);
    bus.emit('volume_update', {
      monitor: ref, volStartMl: 19000, volDispensedMl: 100, sizeMl: 19000,
      ts: '2026-07-27T01:00:00.000Z',
    });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ scope: 'taps' }));
  });

  it('ignores events from unbound monitors without crashing', () => {
    bus.emit('volume_update', {
      monitor: { type: 'kegtron_gen1', identifier: 'aa:bb:cc:dd:ee:ff', portIndex: 0 },
      volStartMl: 19000, volDispensedMl: 100, sizeMl: 19000,
      ts: '2026-07-27T01:00:00.000Z',
    });
    expect(sm.getTapStates().find((t) => t.tapId === tapId)!.keg!.volDispensedMl).toBe(0);
  });

  it('suppresses a duplicate pour_completed within the dedupe window but still clears live pouring state and emits state_changed', () => {
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 400, durationMs: 6000, source: 'cloud',
      ts: '2026-07-27T01:00:00.000Z',
    });
    bus.emit('pour_started', { monitor: ref, ts: '2026-07-27T01:00:05.000Z' });
    let tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.pouring).toBe(true);

    const fn = vi.fn();
    bus.on('state_changed', fn);
    // Same pour reported again by a different source (udp) 10s later, volume within
    // tolerance -> deduped: no second row in `pours`, but live state still clears.
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 405, durationMs: 6000, source: 'udp',
      ts: '2026-07-27T01:00:10.000Z',
    });

    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ scope: 'taps' }));
    tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.pouring).toBe(false);
    expect(tap.curServMl).toBeNull();
    expect((db.prepare('SELECT COUNT(*) c FROM pours').get() as any).c).toBe(1);
    expect(tap.lastPour?.volumeMl).toBe(400);
  });

  it('records a second pour_completed outside the dedupe window normally', () => {
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 400, durationMs: 6000, source: 'cloud',
      ts: '2026-07-27T01:00:00.000Z',
    });
    // 120s later -- outside the widened 90s dedupe window (Final review I2).
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 400, durationMs: 6000, source: 'cloud',
      ts: '2026-07-27T01:02:00.000Z',
    });
    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect((db.prepare('SELECT COUNT(*) c FROM pours').get() as any).c).toBe(2);
    expect(tap.lastPour?.volumeMl).toBe(400);
  });
});
