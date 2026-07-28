import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { StateManager } from '../../src/server/core/state.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap, updateTap } from '../../src/server/db/taps.js';
import { createKeg, getActiveKegForTap } from '../../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createDrinker } from '../../src/server/db/users.js';
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

  it('leaves a recorded pour unclaimed when the tap has no default drinker set (existing behavior)', () => {
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 400, durationMs: 6000, source: 'cloud',
      ts: '2026-07-27T01:00:00.000Z',
    });
    const row = db.prepare('SELECT drinker_id FROM pours ORDER BY id DESC LIMIT 1').get() as any;
    expect(row.drinker_id).toBeNull();
  });

  it("stamps the tap's default drinker onto a pour_completed record when set (Phase 5 Task 0)", () => {
    const drinker = createDrinker(db, { displayName: 'Bob' });
    updateTap(db, tapId, { defaultDrinkerId: drinker.id });

    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 400, durationMs: 6000, source: 'cloud',
      ts: '2026-07-27T01:00:00.000Z',
    });

    const row = db.prepare('SELECT drinker_id FROM pours ORDER BY id DESC LIMIT 1').get() as any;
    expect(row.drinker_id).toBe(drinker.id);
  });

  it('does not override a tap default when a monitor is unbound (no tap to look a default up on)', () => {
    // A pour for a monitor with no bound tap never resolves to a keg at all (see
    // resolveTapForRef), so there's nothing to record — same as before this change;
    // this just proves the new default-drinker lookup doesn't crash that no-tap path.
    const unboundRef = { type: 'kegtron_pro' as const, identifier: 'dev-unbound', portIndex: 0 };
    upsertMonitor(db, unboundRef);
    expect(() => bus.emit('pour_completed', {
      monitor: unboundRef, volumeMl: 400, durationMs: 6000, source: 'cloud',
      ts: '2026-07-27T01:00:00.000Z',
    })).not.toThrow();
    expect((db.prepare('SELECT COUNT(*) c FROM pours').get() as any).c).toBe(0);
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

  // Wall Task 5 review requirement: a kicked keg with no replacement tapped must still
  // surface as `status: 'kicked'` on its tap's TapState so the wall's KICKED presentation
  // (drained, desaturated, "Kicked" stamp) is reachable — previously getTapStates only
  // ever read getActiveKegForTap, so a kicked-without-replacement tap fell through to a
  // generic empty tap instead.
  it('falls back to the most recently kicked keg when a tap has no active keg', () => {
    const kegId = getActiveKegForTap(db, tapId)!.id;
    db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(kegId);

    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.keg?.id).toBe(kegId);
    expect(tap.keg?.status).toBe('kicked');
    expect(tap.beer?.name).toBe('Citra IPA');
  });

  it('prefers a newly tapped keg over a previously kicked one on the same tap', () => {
    const kickedId = getActiveKegForTap(db, tapId)!.id;
    db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(kickedId);
    const freshBeer = createBeer(db, { name: 'Fresh Pils' });
    const fresh = createKeg(db, { beerId: freshBeer.id, sizeMl: 19000, volStartMl: 19000, tapId });

    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.keg?.id).toBe(fresh.id);
    expect(tap.keg?.status).toBe('on_tap');
    expect(tap.beer?.name).toBe('Fresh Pils');
  });

  it('carries temp from the bound monitor\'s latest telemetry row', () => {
    bus.emit('telemetry', { monitor: ref, temp: 3.7, humidity: 45, ts: '2026-07-27T01:00:00.000Z' });
    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.temp).toBe(3.7);
  });

  it('carries the most recent temp reading when telemetry updates over time', () => {
    bus.emit('telemetry', { monitor: ref, temp: 3.7, humidity: 45, ts: '2026-07-27T01:00:00.000Z' });
    bus.emit('telemetry', { monitor: ref, temp: 4.1, humidity: 46, ts: '2026-07-27T01:10:00.000Z' });
    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.temp).toBe(4.1);
  });

  it('temp is null when the bound monitor has no telemetry yet', () => {
    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.temp).toBeNull();
  });

  it('temp is null for a tap with no bound monitor', () => {
    const unboundTapId = createTap(db, { number: 2 }).id;
    const tap = sm.getTapStates().find((t) => t.tapId === unboundTapId)!;
    expect(tap.temp).toBeNull();
  });
});
