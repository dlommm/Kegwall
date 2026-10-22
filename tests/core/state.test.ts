import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { StateManager } from '../../src/server/core/state.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap, updateTap } from '../../src/server/db/taps.js';
import { createKeg, getActiveKegForTap } from '../../src/server/db/kegs.js';
import {
  upsertMonitor, bindMonitorToTap, updateMonitorDeviceIdentity, getMonitorByRef,
} from '../../src/server/db/monitors.js';
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

  it('simulatePour marks the tap pouring over the live feed without recording a pour', () => {
    expect(sm.getTapStates().find((t) => t.tapId === tapId)!.pouring).toBe(false);
    const res = sm.simulatePour(tapId);
    expect(res.tapId).toBe(tapId);
    const during = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(during.pouring).toBe(true);
    expect(during.curServMl).toBe(0);
    // A test pour never touches the pours table.
    expect((db.prepare('SELECT COUNT(*) AS n FROM pours').get() as { n: number }).n).toBe(0);
  });

  it('simulatePour on a second tap clears the first tap\'s overlay instead of stranding it', () => {
    const tap2 = createTap(db, { number: 2 }).id;
    sm.simulatePour(tapId);
    expect(sm.getTapStates().find((t) => t.tapId === tapId)!.pouring).toBe(true);
    // Interrupt tap 1's ramp mid-flight by test-pouring tap 2: the shared timer dies with
    // the new call, so nothing would ever complete tap 1's ramp — its {pouring: true}
    // overlay must be dropped NOW, not left frozen on every wall until restart.
    const res = sm.simulatePour(tap2);
    expect(res.tapId).toBe(tap2);
    const states = sm.getTapStates();
    expect(states.find((t) => t.tapId === tapId)!.pouring).toBe(false);
    expect(states.find((t) => t.tapId === tap2)!.pouring).toBe(true);
  });

  it('remembers the device-reported keg config per monitor (deviceKegInfo)', () => {
    expect(sm.deviceKegInfo(ref)).toBeNull();
    bus.emit('volume_update', {
      monitor: ref, volStartMl: 29337, volDispensedMl: 530, sizeMl: 29337,
      ts: '2026-07-27T01:00:00.000Z',
    });
    expect(sm.deviceKegInfo(ref)).toEqual({
      sizeMl: 29337, volStartMl: 29337, ts: '2026-07-27T01:00:00.000Z',
    });
    // Unbound monitors are tracked too — the swap wizard's prefill must work even
    // before the monitor is bound to a tap.
    const unbound = { type: 'kegtron_pro' as const, identifier: 'dev2', portIndex: 1 };
    bus.emit('volume_update', {
      monitor: unbound, volStartMl: 19550, volDispensedMl: 0, sizeMl: null,
      ts: '2026-07-27T02:00:00.000Z',
    });
    expect(sm.deviceKegInfo(unbound)).toEqual({
      sizeMl: null, volStartMl: 19550, ts: '2026-07-27T02:00:00.000Z',
    });
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

  it('a tap bound to port 2 reads its DEVICE\'s temp — Kegtron reports it once per '
    + 'device, always recorded on the port-0 row', () => {
    const beer2 = createBeer(db, { name: 'Port Two Porter', srm: 30 });
    const tap2 = createTap(db, { number: 2 }).id;
    createKeg(db, { beerId: beer2.id, sizeMl: 19000, volStartMl: 19000, tapId: tap2 });
    const port2 = upsertMonitor(db, { ...ref, portIndex: 2 });
    bindMonitorToTap(db, port2.id, tap2);
    // Telemetry arrives on the device's port-0 ref, as both ingest paths emit it.
    bus.emit('telemetry', { monitor: ref, temp: 2.8, humidity: 41, ts: '2026-07-27T01:00:00.000Z' });
    const tap = sm.getTapStates().find((t) => t.tapId === tap2)!;
    expect(tap.temp).toBe(2.8);
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

  // Perf batch: getTapStates' per-tap lookups (active/kicked keg, beer, last pour,
  // telemetry, avg rating, next-up) were collapsed into fixed all-taps queries. These
  // tests pin the derived values — they must be identical to the per-tap versions.
  it('averages rate-after-claim over rated pours only, surfaces the FIRST-queued on-deck '
    + 'beer, and picks the latest pour as lastPour', () => {
    const kegId = getActiveKegForTap(db, tapId)!.id;
    db.prepare(`INSERT INTO pours (keg_id, ts, volume_ml, source, rating)
      VALUES (?, '2026-07-27T01:00:00.000Z', 300, 'cloud', 4)`).run(kegId);
    db.prepare(`INSERT INTO pours (keg_id, ts, volume_ml, source, rating)
      VALUES (?, '2026-07-27T02:00:00.000Z', 250, 'cloud', 5)`).run(kegId);
    // Unrated pour: excluded from the average, but IS the most recent -> lastPour.
    db.prepare(`INSERT INTO pours (keg_id, ts, volume_ml, source)
      VALUES (?, '2026-07-27T03:00:00.000Z', 475, 'cloud')`).run(kegId);
    const nextBeer = createBeer(db, { name: 'Next Up NEIPA' });
    const laterBeer = createBeer(db, { name: 'Later Lager' });
    createKeg(db, { beerId: nextBeer.id, sizeMl: 19000, volStartMl: 19000, tapId, status: 'on_deck' });
    createKeg(db, { beerId: laterBeer.id, sizeMl: 19000, volStartMl: 19000, tapId, status: 'on_deck' });

    const states = sm.getTapStates();
    const tap = states.find((t) => t.tapId === tapId)!;
    expect(tap.avgRating).toBe(4.5);
    expect(tap.nextUpBeerName).toBe('Next Up NEIPA');
    expect(tap.lastPour).toEqual({ ts: '2026-07-27T03:00:00.000Z', volumeMl: 475 });

    // A second tap with its own (unrated, nothing-queued) keg stays null across the board.
    const beer2 = createBeer(db, { name: 'Quiet Kolsch' });
    const tap2 = createTap(db, { number: 2 }).id;
    createKeg(db, { beerId: beer2.id, sizeMl: 19000, volStartMl: 19000, tapId: tap2 });
    const t2 = sm.getTapStates().find((t) => t.tapId === tap2)!;
    expect(t2.avgRating).toBeNull();
    expect(t2.nextUpBeerName).toBeNull();
    expect(t2.lastPour).toBeNull();
  });

  it('runs a FIXED number of queries per snapshot, independent of tap count (the '
    + 'pour_progress query-storm fix: ~6 queries per tap before, batched all-taps now)', () => {
    const countPrepares = () => {
      const spy = vi.spyOn(db, 'prepare');
      sm.getTapStates();
      const n = spy.mock.calls.length;
      spy.mockRestore();
      return n;
    };
    const baseline = countPrepares();
    for (let n = 10; n < 16; n++) {
      const beer = createBeer(db, { name: `Batch Beer ${n}` });
      const t = createTap(db, { number: n }).id;
      createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: t });
      createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: t, status: 'on_deck' });
    }
    expect(countPrepares()).toBe(baseline);
  });
});

// A device the admin disabled (the case: hardware at another location) still exists as a
// row — its last_seen stays honest and it can be re-enabled — but nothing it reports is
// allowed into the system.
describe('StateManager with a disabled device', () => {
  beforeEach(() => {
    updateMonitorDeviceIdentity(db, upsertMonitor(db, ref).id, { enabled: false });
  });

  it('ignores its volume updates', () => {
    bus.emit('volume_update', {
      monitor: ref, volStartMl: 19000, volDispensedMl: 4750, sizeMl: 19000,
      ts: '2026-07-27T01:00:00.000Z',
    });
    expect(sm.getTapStates().find((t) => t.tapId === tapId)!.keg!.volDispensedMl).toBe(0);
    expect(sm.deviceKegInfo(ref)).toBeNull();
  });

  it('records none of its pours and never shows it pouring', () => {
    bus.emit('pour_started', { monitor: ref, ts: '2026-07-27T01:00:00.000Z' });
    expect(sm.getTapStates().find((t) => t.tapId === tapId)!.pouring).toBe(false);
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 400, durationMs: 6000, source: 'cloud',
      ts: '2026-07-27T01:00:05.000Z',
    });
    expect((db.prepare('SELECT COUNT(*) AS n FROM pours').get() as { n: number }).n).toBe(0);
  });

  it('records none of its telemetry, but keeps its last_seen fresh', () => {
    bus.emit('telemetry', { monitor: ref, temp: 2.8, humidity: 41, ts: '2026-07-27T01:00:00.000Z' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM telemetry').get() as { n: number }).n).toBe(0);
    expect(getMonitorByRef(db, ref)!.lastSeen).not.toBeNull();
  });

  it('lets everything through again once re-enabled', () => {
    updateMonitorDeviceIdentity(db, upsertMonitor(db, ref).id, { enabled: true });
    bus.emit('telemetry', { monitor: ref, temp: 2.8, humidity: 41, ts: '2026-07-27T01:00:00.000Z' });
    expect(sm.getTapStates().find((t) => t.tapId === tapId)!.temp).toBe(2.8);
  });
});

describe('StateManager wall numbers (Kegwall V2)', () => {
  it('reports tonight, last-hour pours and a kick date for the current keg', () => {
    const now = new Date(2026, 9, 22, 21, 0);
    const keg = getActiveKegForTap(db, tapId)!;
    const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    const pour = (ts: string, volumeMl: number) => db.prepare(
      `INSERT INTO pours (keg_id, ts, volume_ml, source) VALUES (?, ?, ?, 'cloud')`,
    ).run(keg.id, ts, volumeMl);
    pour(at(20), 400); // tonight + last hour
    pour(at(90), 500); // tonight only
    pour(at(60 * 24 * 2), 600); // two days ago: burn only
    db.prepare('UPDATE kegs SET date_tapped = ? WHERE id = ?').run(at(60 * 24 * 10), keg.id);

    const tap = sm.getTapStates(now).find((t) => t.tapId === tapId)!;
    expect(tap.tonight).toEqual({ pours: 2, volumeMl: 900 });
    expect(tap.lastHourPours).toBe(1);
    expect(tap.kickDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('has no kick date and zero tonight for an untouched keg', () => {
    const tap = sm.getTapStates().find((t) => t.tapId === tapId)!;
    expect(tap.tonight).toEqual({ pours: 0, volumeMl: 0 });
    expect(tap.lastHourPours).toBe(0);
    expect(tap.kickDate).toBeNull();
  });
});

describe('StateManager pour_recorded (Kegwall V2)', () => {
  it('emits the recorded volume and the attributed pourer once the pour row is written', () => {
    const drinker = createDrinker(db, { displayName: 'Alex' });
    db.prepare('UPDATE taps SET default_drinker_id = ? WHERE id = ?').run(drinker.id, tapId);
    const seen: unknown[] = [];
    bus.on('pour_recorded', (e) => seen.push(e));
    bus.emit('pour_completed', {
      monitor: ref, volumeMl: 412, durationMs: 6100, source: 'udp', ts: '2026-10-22T21:00:00.000Z',
    });
    expect(seen).toEqual([expect.objectContaining({
      tapId, tapNumber: 1, volumeMl: 412, durationMs: 6100, pourerName: 'Alex', pourerPourCount: 1,
    })]);
  });

  it('does not emit for a duplicate report the deduper suppresses', () => {
    const seen: unknown[] = [];
    bus.on('pour_recorded', (e) => seen.push(e));
    const pour = { monitor: ref, volumeMl: 300, durationMs: 4000, source: 'udp' as const, ts: '2026-10-22T21:00:00.000Z' };
    bus.emit('pour_completed', pour);
    bus.emit('pour_completed', pour);
    expect(seen).toHaveLength(1);
  });
});
