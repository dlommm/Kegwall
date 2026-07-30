import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import net from 'node:net';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { StateManager } from '../../src/server/core/state.js';
import { AutomationEngine, type EngineOptions } from '../../src/server/automation/engine.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg } from '../../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createAutomation, getAutomation } from '../../src/server/db/automations.js';
import { listNotifications } from '../../src/server/db/notificationsRepo.js';
import type { MqttSender } from '../../src/server/notify/mqttSender.js';
import type { AutomationRuleInput, Action, Trigger, Condition } from '../../src/server/core/automationSchema.js';

// ---------------------------------------------------------------------------
// Phase 5 Task 3: exhaustive engine tests, synthetic bus events + fake timers per the
// plan's explicit test-matrix list. Real dependencies (StateManager, a real sqlite db)
// are wired up exactly as `context.ts` wires them — the engine's `keg_level_crosses`
// trigger specifically depends on StateManager's OWN `volume_update` subscriber having
// already applied the dispense before the engine's handler reads it (subscription
// order), so most tests build the SAME `bus` + `StateManager.start()` + engine trio a
// real app would, rather than mocking StateManager away.
//
// Fake timers + real network are never combined in the SAME test (a known fragile
// combo — `AbortSignal.timeout`/undici internals use real timers): time-sensitive tests
// (cooldown, runaway, schedule, per-action timeout) use only synchronous/in-app-channel
// side effects; the one test that needs BOTH a controlled clock and a real fake HTTP
// server (quiet hours) uses `vi.useFakeTimers({toFake: ['Date']})` — faking ONLY `Date`,
// leaving `setTimeout`/network machinery real.
// ---------------------------------------------------------------------------

const REF = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
const NOW = '2026-01-01T12:00:00.000Z';

let db: Database.Database;
let bus: EventBus;
let settings: SettingsStore;
let state: StateManager;
let engine: AutomationEngine | undefined;
let banners: unknown[];

function makeEngine(opts: EngineOptions = {}): AutomationEngine {
  engine = new AutomationEngine({ db, bus, settings, state }, opts);
  return engine;
}

/** Beer + tap + on_tap keg (19L) + a Kegtron Pro monitor bound to that tap, using the
 * module-level `REF` identity — the common fixture most tests build on. */
function seed(): { tapId: number; kegId: number; beerId: number } {
  const beer = createBeer(db, { name: 'Test Beer' });
  const tap = createTap(db, { number: 1 });
  const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
  const mon = upsertMonitor(db, REF);
  bindMonitorToTap(db, mon.id, tap.id);
  return { tapId: tap.id, kegId: keg.id, beerId: beer.id };
}

function ruleFor(
  trigger: Trigger, actions: Action[] = [], overrides: Partial<AutomationRuleInput> = {},
): AutomationRuleInput {
  return { name: 'Test Rule', trigger, actions, conditions: [], ...overrides };
}

function bannerAction(text = 'banner'): Action {
  return { type: 'wall_banner', text, kind: 'info' };
}

function notifyInAppAction(title = 'Title', body = 'Body'): Action {
  return { type: 'notify', channels: ['inApp'], title, body };
}

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
  settings = new SettingsStore(db);
  state = new StateManager(db, bus);
  state.start();
  banners = [];
  bus.on('wall_banner', (e) => banners.push(e));
  engine = undefined;
});

afterEach(() => {
  engine?.stop();
  vi.useRealTimers();
});

describe('trigger kinds', () => {
  it('pour_started', async () => {
    seed();
    createAutomation(db, ruleFor({ type: 'pour_started' }, [bannerAction()]));
    makeEngine().start();
    bus.emit('pour_started', { monitor: REF, ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  it('pour_completed', async () => {
    seed();
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [bannerAction()]));
    makeEngine().start();
    bus.emit('pour_completed', { monitor: REF, volumeMl: 400, durationMs: 5000, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  it('device_online', async () => {
    seed();
    createAutomation(db, ruleFor({ type: 'device_online' }, [bannerAction()]));
    makeEngine().start();
    bus.emit('device_online', { monitor: REF, ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  it('device_offline', async () => {
    seed();
    createAutomation(db, ruleFor({ type: 'device_offline' }, [bannerAction()]));
    makeEngine().start();
    bus.emit('device_offline', { monitor: REF, ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  it('keg_tapped', async () => {
    const { tapId, kegId, beerId } = seed();
    createAutomation(db, ruleFor({ type: 'keg_tapped' }, [bannerAction()]));
    makeEngine().start();
    bus.emit('keg_tapped', { tapId, kegId, beerId, ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  it('keg_kicked', async () => {
    const { tapId, kegId, beerId } = seed();
    createAutomation(db, ruleFor({ type: 'keg_kicked' }, [bannerAction()]));
    makeEngine().start();
    bus.emit('keg_kicked', { tapId, kegId, beerId, ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  it('app_startup fires once, at start()', async () => {
    createAutomation(db, ruleFor({ type: 'app_startup' }, [bannerAction()]));
    makeEngine().start();
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  describe('keg_level_crosses', () => {
    it('direction "below": fires exactly once on the actual crossing, not on every sample below it', async () => {
      const { kegId } = seed();
      createAutomation(db, ruleFor({ type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' }, [bannerAction()]));
      makeEngine().start();

      // First sample establishes the baseline only -- nothing to have crossed FROM yet.
      bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW });
      await engine!.flush();
      expect(banners).toHaveLength(0);

      // ~94.7% -> ~10.5%: crosses below 15%.
      bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts: NOW });
      await engine!.flush();
      expect(banners).toHaveLength(1);

      // Still below 15% -- must NOT re-fire.
      bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 18000, sizeMl: 19000, ts: NOW });
      await engine!.flush();
      expect(banners).toHaveLength(1);
      void kegId;
    });

    it('direction "above": fires on crossing back above the threshold', async () => {
      seed();
      createAutomation(db, ruleFor({ type: 'keg_level_crosses', thresholdPct: 50, direction: 'above' }, [bannerAction()]));
      makeEngine().start();

      bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 12000, sizeMl: 19000, ts: NOW }); // ~36.8%, baseline
      await engine!.flush();
      expect(banners).toHaveLength(0);

      bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 5000, sizeMl: 19000, ts: NOW }); // ~73.7%, crosses above 50
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });
  });

  describe('temp_crosses', () => {
    it('direction "above": fires on crossing above the value', async () => {
      seed();
      createAutomation(db, ruleFor({ type: 'temp_crosses', value: 10, direction: 'above' }, [bannerAction()]));
      makeEngine().start();

      bus.emit('telemetry', { monitor: REF, temp: 5, humidity: null, ts: NOW }); // baseline
      await engine!.flush();
      expect(banners).toHaveLength(0);

      bus.emit('telemetry', { monitor: REF, temp: 15, humidity: null, ts: NOW }); // crosses above 10
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('direction "below": fires on crossing below the value', async () => {
      seed();
      createAutomation(db, ruleFor({ type: 'temp_crosses', value: 2, direction: 'below' }, [bannerAction()]));
      makeEngine().start();

      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: 50, ts: NOW }); // baseline
      await engine!.flush();
      expect(banners).toHaveLength(0);

      bus.emit('telemetry', { monitor: REF, temp: 1, humidity: 50, ts: NOW }); // crosses below 2
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('a null temp reading is ignored (no baseline set, no crash)', async () => {
      seed();
      createAutomation(db, ruleFor({ type: 'temp_crosses', value: 2, direction: 'below' }, [bannerAction()]));
      makeEngine().start();
      bus.emit('telemetry', { monitor: REF, temp: null, humidity: 50, ts: NOW });
      await engine!.flush();
      expect(banners).toHaveLength(0);
    });
  });

  describe('humidity_crosses', () => {
    it('direction "above": fires on crossing above the value', async () => {
      seed();
      createAutomation(db, ruleFor({ type: 'humidity_crosses', value: 70, direction: 'above' }, [bannerAction()]));
      makeEngine().start();

      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: 50, ts: NOW }); // baseline
      await engine!.flush();
      expect(banners).toHaveLength(0);

      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: 85, ts: NOW }); // crosses above 70
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('direction "below": fires on crossing below the value', async () => {
      seed();
      createAutomation(db, ruleFor({ type: 'humidity_crosses', value: 20, direction: 'below' }, [bannerAction()]));
      makeEngine().start();

      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: 30, ts: NOW }); // baseline
      await engine!.flush();
      expect(banners).toHaveLength(0);

      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: 10, ts: NOW }); // crosses below 20
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('a null humidity reading is ignored (no baseline set, no crash) -- independent of temp', async () => {
      seed();
      createAutomation(db, ruleFor({ type: 'humidity_crosses', value: 20, direction: 'below' }, [bannerAction()]));
      makeEngine().start();
      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: null, ts: NOW });
      await engine!.flush();
      expect(banners).toHaveLength(0);
    });

    it('a telemetry event with temp:null still evaluates humidity_crosses (temp/humidity handled independently)', async () => {
      seed();
      createAutomation(db, ruleFor({ type: 'humidity_crosses', value: 20, direction: 'below' }, [bannerAction()]));
      makeEngine().start();
      bus.emit('telemetry', { monitor: REF, temp: null, humidity: 30, ts: NOW }); // baseline
      await engine!.flush();
      bus.emit('telemetry', { monitor: REF, temp: null, humidity: 10, ts: NOW }); // crosses below 20
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('auto-resolves on the opposite-direction crossing, independently of temp_crosses', async () => {
      seed();
      createAutomation(db, ruleFor(
        { type: 'humidity_crosses', value: 70, direction: 'above' },
        [notifyInAppAction('Humidity high', 'body')],
        { isAlert: true, alertConfig: { cooldownMinutes: 60, autoResolve: true, notifyOnResolve: true, severity: 'warning' } },
      ));
      makeEngine().start();

      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: 50, ts: NOW }); // baseline
      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: 85, ts: NOW }); // crosses above -- fires
      await engine!.flush();
      expect(listNotifications(db)).toHaveLength(1);

      bus.emit('telemetry', { monitor: REF, temp: 4, humidity: 50, ts: NOW }); // crosses below -- resolves
      await engine!.flush();
      expect(listNotifications(db)).toHaveLength(2);
      expect(listNotifications(db)[0]?.title).toContain('resolved');
    });
  });

  describe('schedule', () => {
    beforeEach(() => vi.useFakeTimers());

    it('fires when the current time+weekday matches at start() (2026-01-05 is a Monday)', async () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
      createAutomation(db, ruleFor({ type: 'schedule', time: '09:00', weekdays: [1] }, [bannerAction()]));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('does not fire on a non-matching weekday', async () => {
      vi.setSystemTime(new Date(2026, 0, 4, 9, 0, 0)); // Sunday
      createAutomation(db, ruleFor({ type: 'schedule', time: '09:00', weekdays: [1] }, [bannerAction()]));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(0);
    });

    it('does not fire at a non-matching time', async () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 1, 0));
      createAutomation(db, ruleFor({ type: 'schedule', time: '09:00', weekdays: [] }, [bannerAction()]));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(0);
    });

    it('empty weekdays = every day', async () => {
      vi.setSystemTime(new Date(2026, 0, 4, 9, 0, 0)); // Sunday
      createAutomation(db, ruleFor({ type: 'schedule', time: '09:00', weekdays: [] }, [bannerAction()]));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('fires again on the next matching day via the recurring timer, deduped within the same minute', async () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
      createAutomation(db, ruleFor({ type: 'schedule', time: '09:00', weekdays: [] }, [bannerAction()]));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(1);

      // Still inside the same minute -- must not double-fire.
      await vi.advanceTimersByTimeAsync(30_000);
      await engine!.flush();
      expect(banners).toHaveLength(1);

      // 24h later, same time-of-day -- fires again.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      await engine!.flush();
      expect(banners).toHaveLength(2);
    });
  });

  // Phase 5 Task 4 (cleaning-due alert template ledger note): a `days_since_cleaned`-
  // conditioned schedule rule is evaluated PER Kegtron Pro monitor (not once globally
  // like every other schedule rule) -- see engine.ts's `checkCleaningDueRule`.
  describe('days_since_cleaned (cleaning-due schedule rules, evaluated per Kegtron Pro monitor)', () => {
    beforeEach(() => vi.useFakeTimers());

    it('fires for a monitor whose dateCleaned is at least `days` in the past', async () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0)); // 2026-01-05
      seed();
      upsertMonitor(db, REF, { meta: { dateCleaned: '2025/12/01' } }); // 35 days overdue
      createAutomation(db, ruleFor(
        { type: 'schedule', time: '09:00', weekdays: [] },
        [bannerAction()],
        { conditions: [{ type: 'days_since_cleaned', days: 30 }] },
      ));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('fires ONCE per physical device, not once per port row', async () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
      seed();
      // One 4-port Kegtron: dateCleaned is stamped identically on every port row
      // at cloud discovery (see shadow.ts) — an overdue device is one alert, not four.
      for (const portIndex of [0, 1, 2, 3]) {
        upsertMonitor(db, { ...REF, portIndex }, { meta: { dateCleaned: '2025/12/01' } });
      }
      createAutomation(db, ruleFor(
        { type: 'schedule', time: '09:00', weekdays: [] },
        [bannerAction()],
        { conditions: [{ type: 'days_since_cleaned', days: 30 }] },
      ));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });

    it('does not fire when the monitor was cleaned recently enough', async () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
      seed();
      upsertMonitor(db, REF, { meta: { dateCleaned: '2026/01/01' } }); // 4 days ago
      createAutomation(db, ruleFor(
        { type: 'schedule', time: '09:00', weekdays: [] },
        [bannerAction()],
        { conditions: [{ type: 'days_since_cleaned', days: 30 }] },
      ));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(0);
    });

    it('does not fire when the monitor has no recorded dateCleaned at all', async () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
      seed(); // no meta.dateCleaned stamped
      createAutomation(db, ruleFor(
        { type: 'schedule', time: '09:00', weekdays: [] },
        [bannerAction()],
        { conditions: [{ type: 'days_since_cleaned', days: 30 }] },
      ));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(0);
    });

    it('fires independently per monitor -- only the overdue one triggers', async () => {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
      seed();
      upsertMonitor(db, REF, { meta: { dateCleaned: '2025/11/01' } }); // very overdue

      const beer2 = createBeer(db, { name: 'Second Beer' });
      const tap2 = createTap(db, { number: 2 });
      createKeg(db, { beerId: beer2.id, sizeMl: 19000, volStartMl: 19000, tapId: tap2.id });
      const ref2 = { type: 'kegtron_pro' as const, identifier: 'dev2', portIndex: 0 };
      const mon2 = upsertMonitor(db, ref2, { meta: { dateCleaned: '2026/01/04' } }); // cleaned yesterday
      bindMonitorToTap(db, mon2.id, tap2.id);

      createAutomation(db, ruleFor(
        { type: 'schedule', time: '09:00', weekdays: [] },
        [bannerAction()],
        { conditions: [{ type: 'days_since_cleaned', days: 30 }] },
      ));
      makeEngine().start();
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });
  });
});

describe('runRuleOnce (POST /api/automations/:id/run test-run support)', () => {
  it('runs every action against a synthetic ctx and reports per-action ok results, without touching cooldown/lastFiredAt', async () => {
    const rule = createAutomation(db, ruleFor(
      { type: 'pour_completed' },
      [bannerAction('{{beer.name}} test'), notifyInAppAction('Title', 'Body')],
      { isAlert: true, alertConfig: { cooldownMinutes: 60, autoResolve: false, notifyOnResolve: false, severity: 'warning' } },
    ));
    makeEngine();
    const results = await engine!.runRuleOnce(rule);

    expect(results).toEqual([
      { type: 'wall_banner', ok: true },
      { type: 'notify', ok: true },
    ]);
    expect(banners).toHaveLength(1);
    // the synthetic ctx's template values resolved to something non-empty, not left blank
    expect((banners[0] as any).text).not.toBe('{{beer.name}} test');
    expect((banners[0] as any).text.endsWith(' test')).toBe(true);
    expect(listNotifications(db)).toHaveLength(1);

    // a manual test-run must never consume the rule's real cooldown/lastFiredAt budget
    const reloaded = getAutomation(db, rule.id)!;
    expect(reloaded.lastFiredAt).toBeNull();
  });

  it('reports a failing action without aborting the remaining actions', async () => {
    const rule = createAutomation(db, ruleFor(
      { type: 'pour_completed' },
      [{ type: 'mqtt_publish', topic: 'x', payloadTemplate: 'y' }, bannerAction()],
    ));
    makeEngine();
    const results = await engine!.runRuleOnce(rule);

    expect(results[0]).toMatchObject({ type: 'mqtt_publish', ok: false });
    expect(typeof (results[0] as any).error).toBe('string');
    expect(results[1]).toEqual({ type: 'wall_banner', ok: true });
    expect(banners).toHaveLength(1);
  });

  it('a kegtron_reset_volume action fails cleanly -- the synthetic ctx has no real tap context', async () => {
    const rule = createAutomation(db, ruleFor({ type: 'pour_completed' }, [{ type: 'kegtron_reset_volume' }]));
    makeEngine();
    const results = await engine!.runRuleOnce(rule);
    expect(results).toEqual([{ type: 'kegtron_reset_volume', ok: false, error: expect.any(String) }]);
  });
});

describe('conditions applied end-to-end (matrix itself is unit-tested in tests/automation/conditions.test.ts)', () => {
  it('tap_scope actually gates real keg_tapped events by tap', async () => {
    const beer = createBeer(db, { name: 'B' });
    const tap1 = createTap(db, { number: 1 });
    const tap2 = createTap(db, { number: 2 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: 1000, volStartMl: 1000, tapId: tap1.id });
    const conditions: Condition[] = [{ type: 'tap_scope', tapIds: [tap2.id] }];
    createAutomation(db, ruleFor({ type: 'keg_tapped' }, [bannerAction()], { conditions }));
    makeEngine().start();

    bus.emit('keg_tapped', { tapId: tap1.id, kegId: keg.id, beerId: beer.id, ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(0);

    bus.emit('keg_tapped', { tapId: tap2.id, kegId: keg.id, beerId: beer.id, ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });
});

describe('alert cooldown', () => {
  it('suppresses a refire while the alert is active within cooldownMinutes; fires again once elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    seed();
    createAutomation(db, {
      name: 'Device Offline', isAlert: true, trigger: { type: 'device_offline' },
      actions: [notifyInAppAction('Offline', 'Device is offline')],
      alertConfig: { cooldownMinutes: 60, autoResolve: false, notifyOnResolve: false, severity: 'warning' },
    });
    makeEngine().start();

    bus.emit('device_offline', { monitor: REF, ts: new Date().toISOString() });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30 * 60_000); // 30 min -- still within cooldown
    bus.emit('device_offline', { monitor: REF, ts: new Date().toISOString() });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(31 * 60_000); // now past the 60 min cooldown
    bus.emit('device_offline', { monitor: REF, ts: new Date().toISOString() });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(2);
  });

  // Task 3 review Fix round 1 (Important): cooldown must gate a NEW fire regardless of
  // whether the alert is currently "active" -- an oscillating signal (temp bouncing
  // around the threshold) that resolves between crossings must still be capped at one
  // fire per cooldown window, not one fire per crossing.
  it('gates a NEW fire by time-since-last-FIRE, not by active/resolved state -- an oscillating '
    + 'signal is capped at one fire per cooldown window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    seed();
    createAutomation(db, {
      name: 'Temp High', isAlert: true,
      trigger: { type: 'temp_crosses', value: 10, direction: 'above' },
      actions: [notifyInAppAction('Temp high', 'x')],
      alertConfig: { cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning' },
    });
    makeEngine().start();

    const tick = () => new Date().toISOString();
    bus.emit('telemetry', { monitor: REF, temp: 5, humidity: null, ts: tick() }); // baseline
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(0);

    bus.emit('telemetry', { monitor: REF, temp: 15, humidity: null, ts: tick() }); // crosses above -- fires
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1);

    bus.emit('telemetry', { monitor: REF, temp: 5, humidity: null, ts: tick() }); // crosses below -- auto-resolves
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1); // notifyOnResolve is false -- no extra notification

    // Immediate re-crossing, still within the 60-min cooldown, alert currently RESOLVED
    // (inactive) -- must still be suppressed.
    bus.emit('telemetry', { monitor: REF, temp: 15, humidity: null, ts: tick() });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1);

    // A resolve on a suppressed (never reactivated) fire is a no-op too.
    bus.emit('telemetry', { monitor: REF, temp: 5, humidity: null, ts: tick() });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1);

    // Once the cooldown window has fully elapsed since the FIRST fire, the next
    // crossing fires again.
    await vi.advanceTimersByTimeAsync(61 * 60_000);
    bus.emit('telemetry', { monitor: REF, temp: 15, humidity: null, ts: tick() });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(2);
  });
});

describe('quiet hours (external channels suppressed; inApp always records)', () => {
  let discordServer: FastifyInstance;
  let discordHits: number;

  beforeEach(async () => {
    discordHits = 0;
    discordServer = Fastify();
    discordServer.post('/webhook', async () => { discordHits += 1; return {}; });
    await discordServer.listen({ port: 0, host: '127.0.0.1' });
    const addr = discordServer.server.address() as { port: number };
    settings.set('alertChannels', { discord: { webhookUrl: `http://127.0.0.1:${addr.port}/webhook` } });
    settings.set('quietHours', { start: '22:00', end: '08:00' });
  });

  afterEach(async () => {
    await discordServer.close();
  });

  async function fireAt(time: Date): Promise<void> {
    vi.useFakeTimers({ toFake: ['Date'] }); // ONLY Date faked -- real timers for the real fetch below
    vi.setSystemTime(time);
    seed();
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [
      { type: 'notify', channels: ['inApp', 'discord'], title: 'Pour', body: 'Body' },
    ]));
    makeEngine().start();
    bus.emit('pour_completed', {
      monitor: REF, volumeMl: 400, durationMs: 1, source: 'cloud', ts: time.toISOString(),
    });
    await engine!.flush();
  }

  it('at exactly 22:00 (inclusive quiet start) -- discord suppressed, inApp still recorded', async () => {
    await fireAt(new Date(2026, 0, 1, 22, 0, 0));
    expect(discordHits).toBe(0);
    expect(listNotifications(db)).toHaveLength(1);
  });

  it('at 21:59 (just before quiet) -- discord goes through', async () => {
    await fireAt(new Date(2026, 0, 1, 21, 59, 0));
    expect(discordHits).toBe(1);
  });

  it('at exactly 08:00 (exclusive quiet end) -- discord goes through again', async () => {
    await fireAt(new Date(2026, 0, 1, 8, 0, 0));
    expect(discordHits).toBe(1);
  });

  it('at 07:59 (just before end) -- discord still suppressed', async () => {
    await fireAt(new Date(2026, 0, 1, 7, 59, 0));
    expect(discordHits).toBe(0);
  });
});

describe('runaway guard (60/hr default; all rules, not just alerts)', () => {
  it('caps a single rule at runawayLimitPerHour fires/hour', async () => {
    seed();
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [bannerAction()]));
    makeEngine({ runawayLimitPerHour: 2 }).start();

    for (let i = 0; i < 3; i += 1) {
      bus.emit('pour_completed', {
        monitor: REF, volumeMl: 100, durationMs: 1, source: 'cloud', ts: new Date().toISOString(),
      });
    }
    await engine!.flush();
    expect(banners).toHaveLength(2);
  });
});

describe('auto-resolve + notifyOnResolve', () => {
  function alertRule(overrides: { autoResolve?: boolean; notifyOnResolve?: boolean } = {}) {
    return {
      name: 'Keg Low', isAlert: true,
      trigger: { type: 'keg_level_crosses' as const, thresholdPct: 15, direction: 'below' as const },
      actions: [notifyInAppAction('Keg low', 'Below 15%')],
      alertConfig: {
        cooldownMinutes: 60,
        autoResolve: overrides.autoResolve ?? true,
        notifyOnResolve: overrides.notifyOnResolve ?? true,
        severity: 'warning' as const,
      },
    };
  }

  it('resolves on the opposite-direction crossing and sends a resolve notification when notifyOnResolve is true', async () => {
    seed();
    createAutomation(db, alertRule());
    makeEngine().start();

    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW }); // baseline
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(0);

    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts: NOW }); // crosses below
    await engine!.flush();
    let ns = listNotifications(db);
    expect(ns).toHaveLength(1);
    expect(ns[0]!.title).toBe('Keg low');

    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW }); // back above
    await engine!.flush();
    ns = listNotifications(db);
    expect(ns).toHaveLength(2);
    expect(ns[0]!.title).toBe('Keg Low resolved'); // newest first
  });

  it('does not send a resolve notification when notifyOnResolve is false', async () => {
    seed();
    createAutomation(db, alertRule({ notifyOnResolve: false }));
    makeEngine().start();

    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW });
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts: NOW });
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1); // just the activation
  });

  it('does not auto-resolve when autoResolve is false -- the alert stays active, cooldown gates a re-cross', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    seed();
    createAutomation(db, alertRule({ autoResolve: false }));
    makeEngine().start();

    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW });
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts: NOW }); // activates
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1);

    // Wobbles back above then below again immediately (autoResolve:false means the
    // active flag never clears) -- the re-cross is suppressed by cooldown.
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW });
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts: NOW });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1); // still just 1 -- cooldown suppressed the re-cross
  });

  it('tracks alert active state independently per entity (two taps, same rule)', async () => {
    const beer = createBeer(db, { name: 'B' });
    const tap1 = createTap(db, { number: 1 });
    const tap2 = createTap(db, { number: 2 });
    const keg1 = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap1.id });
    const keg2 = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap2.id });
    const ref1 = { type: 'kegtron_pro' as const, identifier: 'devA', portIndex: 0 };
    const ref2 = { type: 'kegtron_pro' as const, identifier: 'devB', portIndex: 0 };
    bindMonitorToTap(db, upsertMonitor(db, ref1).id, tap1.id);
    bindMonitorToTap(db, upsertMonitor(db, ref2).id, tap2.id);
    void keg1; void keg2;

    createAutomation(db, alertRule({ notifyOnResolve: false }));
    makeEngine().start();

    bus.emit('volume_update', { monitor: ref1, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW });
    bus.emit('volume_update', { monitor: ref2, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW });
    await engine!.flush();

    bus.emit('volume_update', { monitor: ref1, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts: NOW });
    bus.emit('volume_update', { monitor: ref2, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts: NOW });
    await engine!.flush();

    expect(listNotifications(db)).toHaveLength(2); // both taps fired independently
  });
});

describe('alert_fired bus event (Phase 5 Task 5: HA publisher hand-off point)', () => {
  function alertsCollector(): { events: unknown[] } {
    const events: unknown[] = [];
    bus.on('alert_fired', (e) => events.push(e));
    return { events };
  }

  it('emits alert_fired with the notify action\'s rendered title/body when an isAlert rule fires', async () => {
    const { tapId } = seed();
    createAutomation(db, {
      name: 'Device Offline', isAlert: true, trigger: { type: 'device_offline' },
      actions: [{ type: 'notify', channels: ['inApp'], title: 'Offline: {{tap.name}}', body: 'Body text' }],
      alertConfig: { cooldownMinutes: 60, autoResolve: false, notifyOnResolve: false, severity: 'critical' },
    });
    const { events } = alertsCollector();
    makeEngine().start();

    bus.emit('device_offline', { monitor: REF, ts: NOW });
    await engine!.flush();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ruleName: 'Device Offline', severity: 'critical', title: 'Offline: ', body: 'Body text', tapId, ts: NOW,
    });
    expect((events[0] as { ruleId: number }).ruleId).toEqual(getAutomation(db, (events[0] as any).ruleId)!.id);
  });

  it('falls back to {title: rule.name, body: \'\'} when the rule has no notify action', async () => {
    seed();
    createAutomation(db, {
      name: 'Banner Only Alert', isAlert: true, trigger: { type: 'device_offline' },
      actions: [bannerAction('offline!')],
      alertConfig: { cooldownMinutes: 60, autoResolve: false, notifyOnResolve: false, severity: 'warning' },
    });
    const { events } = alertsCollector();
    makeEngine().start();

    bus.emit('device_offline', { monitor: REF, ts: NOW });
    await engine!.flush();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ruleName: 'Banner Only Alert', title: 'Banner Only Alert', body: '' });
  });

  it('is NOT emitted for a non-alert rule (isAlert: false)', async () => {
    seed();
    createAutomation(db, ruleFor({ type: 'device_offline' }, [bannerAction()]));
    const { events } = alertsCollector();
    makeEngine().start();

    bus.emit('device_offline', { monitor: REF, ts: NOW });
    await engine!.flush();

    expect(events).toHaveLength(0);
  });

  it('is NOT emitted for a cooldown-suppressed refire', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    seed();
    createAutomation(db, {
      name: 'Device Offline', isAlert: true, trigger: { type: 'device_offline' },
      actions: [notifyInAppAction('Offline', 'x')],
      alertConfig: { cooldownMinutes: 60, autoResolve: false, notifyOnResolve: false, severity: 'warning' },
    });
    const { events } = alertsCollector();
    makeEngine().start();

    bus.emit('device_offline', { monitor: REF, ts: new Date().toISOString() });
    await engine!.flush();
    bus.emit('device_offline', { monitor: REF, ts: new Date().toISOString() }); // within cooldown
    await engine!.flush();

    expect(events).toHaveLength(1);
  });

  it('is NOT emitted on resolve (only on fire)', async () => {
    seed();
    createAutomation(db, {
      name: 'Keg Low', isAlert: true,
      trigger: { type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' },
      actions: [notifyInAppAction('Keg low', 'Below 15%')],
      alertConfig: { cooldownMinutes: 1, autoResolve: true, notifyOnResolve: true, severity: 'warning' },
    });
    const { events } = alertsCollector();
    makeEngine().start();

    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW });
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts: NOW }); // crosses below -- fires
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts: NOW }); // back above -- resolves
    await engine!.flush();

    expect(events).toHaveLength(1); // only the fire, not the resolve
  });

  // Final-review fix wave (I3a): the spec lists "Home Assistant notify" (the
  // `alert_fired` -> `<prefix>/event/alert` MQTT relay) as one of the delivery channels
  // quiet hours suppress, matching every other external channel's behavior. Before this
  // fix, `alert_fired` was emitted unconditionally in `considerFire`, entirely bypassing
  // `sendToChannels`'s quiet-hours check (that check only ever ran for the `notify`
  // action's OWN channel list) -- so HA could relay alerts to phones/TTS during quiet
  // hours no matter what. Fixed engine-side (not in haPublisher) so the EVENT itself is
  // suppressed, the same shape as "quiet hours suppress the channel", not merely "HA
  // chooses to ignore it". In-app is unaffected: it's driven entirely by the rule's
  // `notify` action through `dispatchActions`/`sendToChannels` (which has its own,
  // unchanged "inApp always records" carve-out), never by the `alert_fired` bus event.
  it('is NOT emitted during quiet hours (I3a) -- but the in-app notify action still records', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0, 0)); // well inside 22:00-08:00 quiet hours
    settings.set('quietHours', { start: '22:00', end: '08:00' });
    seed();
    createAutomation(db, {
      name: 'Device Offline', isAlert: true, trigger: { type: 'device_offline' },
      actions: [notifyInAppAction('Offline', 'x')],
      alertConfig: { cooldownMinutes: 60, autoResolve: false, notifyOnResolve: false, severity: 'warning' },
    });
    const { events } = alertsCollector();
    makeEngine().start();

    bus.emit('device_offline', { monitor: REF, ts: new Date().toISOString() });
    await engine!.flush();

    expect(events).toHaveLength(0);
    expect(listNotifications(db)).toHaveLength(1);
  });

  it('IS emitted just outside quiet hours (21:59, one minute before 22:00 start)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 1, 21, 59, 0));
    settings.set('quietHours', { start: '22:00', end: '08:00' });
    seed();
    createAutomation(db, {
      name: 'Device Offline', isAlert: true, trigger: { type: 'device_offline' },
      actions: [notifyInAppAction('Offline', 'x')],
      alertConfig: { cooldownMinutes: 60, autoResolve: false, notifyOnResolve: false, severity: 'warning' },
    });
    const { events } = alertsCollector();
    makeEngine().start();

    bus.emit('device_offline', { monitor: REF, ts: new Date().toISOString() });
    await engine!.flush();

    expect(events).toHaveLength(1);
  });
});

describe('action dispatch', () => {
  it('runs actions strictly in array order', async () => {
    seed();
    const order: string[] = [];
    bus.on('wall_banner', () => order.push('banner'));
    bus.on('wall_theme_override', () => order.push('party'));
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [
      { type: 'wall_banner', text: 'A', kind: 'info' },
      { type: 'notify', channels: ['inApp'], title: 'B', body: 'B' },
      { type: 'party_mode', minutes: 5 },
    ]));
    makeEngine().start();
    bus.emit('pour_completed', { monitor: REF, volumeMl: 100, durationMs: 1, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(order).toEqual(['banner', 'party']);
    expect(listNotifications(db)).toHaveLength(1);
  });

  it('party_mode emits wall_theme_override with minutes', async () => {
    seed();
    const themeEvents: unknown[] = [];
    bus.on('wall_theme_override', (e) => themeEvents.push(e));
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [{ type: 'party_mode', minutes: 10 }]));
    makeEngine().start();
    bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(themeEvents).toEqual([{ minutes: 10 }]);
  });

  it('an unconfigured notify channel is logged and skipped; other channels still send', async () => {
    seed();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [
      { type: 'notify', channels: ['ntfy', 'inApp'], title: 'T', body: 'B' },
    ]));
    makeEngine().start();
    bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(listNotifications(db)).toHaveLength(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('mqtt_publish throws when mqtt is not configured -- logged, later actions still run', async () => {
    seed();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [
      { type: 'mqtt_publish', topic: 't', payloadTemplate: 'p' },
      { type: 'wall_banner', text: 'after', kind: 'info' },
    ]));
    makeEngine().start();
    bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('builds correct {beer, tap, keg, pour} template context for a pour_completed event', async () => {
    seed();
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [
      {
        type: 'notify', channels: ['inApp'],
        title: '{{beer.name}} on tap {{tap.number}}',
        body: 'Poured {{pour.volume_ml}}ml, keg at {{keg.level_pct}}%',
      },
    ]));
    makeEngine().start();
    bus.emit('pour_completed', { monitor: REF, volumeMl: 400, durationMs: 5000, source: 'cloud', ts: NOW });
    await engine!.flush();
    const n = listNotifications(db)[0]!;
    expect(n.title).toBe('Test Beer on tap 1');
    expect(n.body).toContain('Poured 400ml');
  });

  describe('per-action timeout', () => {
    it('a hung action times out after actionTimeoutMs; later actions still run', async () => {
      vi.useFakeTimers();
      seed();
      const hungMqttSender = {
        publish: () => new Promise<void>(() => {}),
        close: async () => {},
      } as unknown as MqttSender;
      createAutomation(db, ruleFor({ type: 'pour_completed' }, [
        { type: 'mqtt_publish', topic: 't', payloadTemplate: 'p' },
        { type: 'wall_banner', text: 'after timeout', kind: 'info' },
      ]));
      makeEngine({ actionTimeoutMs: 50, mqttSender: hungMqttSender }).start();
      bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
      await vi.advanceTimersByTimeAsync(60);
      await engine!.flush();
      expect(banners).toHaveLength(1);
    });
  });

  describe('webhook action (Task 2 review HARD REQUIREMENT: SSRF-guarded)', () => {
    it('blocks a private-host webhook URL; action fails cleanly, logged, other actions continue', async () => {
      seed();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      createAutomation(db, ruleFor({ type: 'pour_completed' }, [
        { type: 'webhook', url: 'http://127.0.0.1/hook', bodyTemplate: '{}' },
        { type: 'wall_banner', text: 'still runs', kind: 'info' },
      ]));
      makeEngine().start();
      const start = Date.now();
      bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
      await engine!.flush();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(200); // rejected by the guard, not after a real connection attempt
      expect(banners).toHaveLength(1);
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('renders the body template and posts to an allowed host (webhookAllowInsecureHosts test escape hatch)', async () => {
      seed();
      let received: unknown = null;
      const fake = Fastify();
      fake.post('/hook', async (req) => { received = req.body; return { ok: true }; });
      await fake.listen({ port: 0, host: '127.0.0.1' });
      const addr = fake.server.address() as { port: number };

      createAutomation(db, ruleFor({ type: 'pour_completed' }, [
        { type: 'webhook', url: `http://127.0.0.1:${addr.port}/hook`, bodyTemplate: '{"beer":"{{beer.name}}"}' },
      ]));
      makeEngine({ webhookAllowInsecureHosts: true }).start();
      bus.emit('pour_completed', { monitor: REF, volumeMl: 400, durationMs: 1, source: 'cloud', ts: NOW });
      await engine!.flush();
      expect(received).toEqual({ beer: 'Test Beer' });
      await fake.close();
    });

    // Task 3 review Fix round 1 (Critical/SSRF): assertPublicHost only validates the
    // webhook URL ITSELF -- it says nothing about where a 3xx response from an
    // otherwise-allowed host might redirect to. Before this fix, sendWebhook's fetch
    // followed redirects, so a guard-passing URL could still 302 the ACTUAL request to a
    // private/loopback address (or cloud metadata), reaching exactly the host the guard
    // exists to keep this server off of. `webhookAllowInsecureHosts: true` here is only
    // standing in for "the guard passed" (matches the test right above it) -- the
    // property under test is `sendWebhook`'s OWN `redirect: 'error'`, independent of the
    // guard.
    it('refuses to follow a redirect even from an allowed URL -- the redirect target is never reached; the action fails cleanly and later actions still run', async () => {
      seed();
      let secondServerHits = 0;
      const secondServer = Fastify();
      secondServer.route({
        method: ['GET', 'POST'], url: '/private-secret',
        handler: async () => { secondServerHits += 1; return {}; },
      });
      await secondServer.listen({ port: 0, host: '127.0.0.1' });
      const secondPort = (secondServer.server.address() as { port: number }).port;

      const redirectingServer = Fastify();
      redirectingServer.post('/hook', async (_req, reply) => {
        reply.code(302).header('location', `http://127.0.0.1:${secondPort}/private-secret`).send();
      });
      await redirectingServer.listen({ port: 0, host: '127.0.0.1' });
      const redirectingPort = (redirectingServer.server.address() as { port: number }).port;

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      createAutomation(db, ruleFor({ type: 'pour_completed' }, [
        { type: 'webhook', url: `http://127.0.0.1:${redirectingPort}/hook`, bodyTemplate: '{}' },
        { type: 'wall_banner', text: 'still runs', kind: 'info' },
      ]));
      makeEngine({ webhookAllowInsecureHosts: true }).start();
      bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
      await engine!.flush();

      expect(secondServerHits).toBe(0);
      expect(banners).toHaveLength(1); // the later action in the SAME rule still ran
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
      await redirectingServer.close();
      await secondServer.close();
    });
  });

  describe('mqtt_publish action', () => {
    let broker: Aedes;
    let server: net.Server;
    let brokerPort: number;

    beforeEach(async () => {
      broker = await Aedes.createBroker();
      server = net.createServer(broker.handle);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      brokerPort = (server.address() as { port: number }).port;
    });

    afterEach(async () => {
      // The engine's OWN internal MqttSender (lazily built by dispatchMqtt, since no
      // `mqttSender` override was injected) is still connected to this broker at this
      // point -- stop it first (fire-and-forget `close()`, same as production) and give
      // it a moment to actually disconnect, or `server.close()`/`broker.close()` below
      // hang waiting for a client that never goes away.
      engine?.stop();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => broker.close(() => resolve()));
    });

    it('publishes the rendered payload to the configured broker', async () => {
      seed();
      settings.set('mqtt', {
        url: `mqtt://127.0.0.1:${brokerPort}`, gen1TopicPrefix: 'home/x', haPublishEnabled: false,
        haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
      });
      const received: { topic: string; payload: string }[] = [];
      const sub = mqtt.connect(`mqtt://127.0.0.1:${brokerPort}`);
      await new Promise<void>((resolve, reject) => {
        sub.once('connect', () => resolve());
        sub.once('error', reject);
      });
      sub.subscribe('kegtron/#');
      sub.on('message', (topic, payload) => received.push({ topic, payload: payload.toString('utf8') }));

      createAutomation(db, ruleFor({ type: 'pour_completed' }, [
        { type: 'mqtt_publish', topic: 'kegtron/test', payloadTemplate: '{{pour.volume_ml}}' },
      ]));
      makeEngine().start();
      bus.emit('pour_completed', { monitor: REF, volumeMl: 355, durationMs: 1, source: 'cloud', ts: NOW });
      await engine!.flush();

      try {
        // Poll rather than sleep-a-fixed-50ms: the broker→subscriber delivery races a
        // fixed sleep on a slow CI runner (real intermittent failure on the shared one).
        await vi.waitFor(
          () => expect(received).toContainEqual({ topic: 'kegtron/test', payload: '355' }),
          { timeout: 5000 },
        );
      } finally {
        await new Promise<void>((resolve) => sub.end(true, {}, () => resolve()));
      }
    });
  });

  describe('kegtron_reset_volume action', () => {
    it("calls Kegtron.ResetVolume via mdash for the trigger's tap's bound Pro monitor", async () => {
      const beer = createBeer(db, { name: 'B' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      const mon = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'devZ', portIndex: 2 }, { meta: { deviceKey: 'KEY123' } });
      bindMonitorToTap(db, mon.id, tap.id);

      const rpcCalls: { body: unknown; token: unknown }[] = [];
      const fakeMdash = Fastify();
      fakeMdash.post('/api/v2/m/device/rpc/Kegtron.ResetVolume', async (req) => {
        rpcCalls.push({ body: req.body, token: (req.query as Record<string, unknown>).access_token });
        return {};
      });
      await fakeMdash.listen({ port: 0, host: '127.0.0.1' });
      const addr = fakeMdash.server.address() as { port: number };
      settings.set('kegtronApiKey', 'customer-key');
      settings.set('kegtronBaseUrl', `http://127.0.0.1:${addr.port}`);

      createAutomation(db, ruleFor({ type: 'keg_tapped' }, [{ type: 'kegtron_reset_volume' }]));
      makeEngine().start();
      bus.emit('keg_tapped', { tapId: tap.id, kegId: keg.id, beerId: beer.id, ts: NOW });
      await engine!.flush();

      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0]!.body).toEqual({ port: 2 });
      expect(rpcCalls[0]!.token).toBe('KEY123'); // the MONITOR's own device key, not the customer key
      await fakeMdash.close();
    });

    it('throws (logged, other actions continue) when the tap has no bound Pro monitor', async () => {
      const beer = createBeer(db, { name: 'B' });
      const tap = createTap(db, { number: 1 });
      const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      createAutomation(db, ruleFor({ type: 'keg_tapped' }, [
        { type: 'kegtron_reset_volume' },
        { type: 'wall_banner', text: 'still runs', kind: 'info' },
      ]));
      makeEngine().start();
      bus.emit('keg_tapped', { tapId: tap.id, kegId: keg.id, beerId: beer.id, ts: NOW });
      await engine!.flush();

      expect(banners).toHaveLength(1);
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});

describe('stop()', () => {
  it('unsubscribes from the bus -- events after stop() do not fire actions', async () => {
    seed();
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [bannerAction()]));
    makeEngine().start();
    engine!.stop();
    bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(0);
  });

  it('clears the schedule timer -- advancing time after stop() does not fire schedule rules', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 8, 59, 0));
    createAutomation(db, ruleFor({ type: 'schedule', time: '09:00', weekdays: [] }, [bannerAction()]));
    makeEngine().start();
    engine!.stop();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await engine!.flush();
    expect(banners).toHaveLength(0);
  });

  it('is idempotent -- safe before start(), and safe to call more than once', () => {
    makeEngine();
    expect(() => engine!.stop()).not.toThrow();
    expect(() => engine!.stop()).not.toThrow();
    engine!.start();
    expect(() => { engine!.stop(); engine!.stop(); }).not.toThrow();
  });
});

describe('reloadRules / automations_changed', () => {
  it('reloadRules() picks up a rule created after start()', async () => {
    seed();
    makeEngine().start();
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [bannerAction()]));

    bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(0); // not loaded yet

    engine!.reloadRules();
    bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });

  it('an automations_changed bus event triggers a reload', async () => {
    seed();
    makeEngine().start();
    createAutomation(db, ruleFor({ type: 'pour_completed' }, [bannerAction()]));

    bus.emit('automations_changed', { ts: new Date().toISOString() });
    bus.emit('pour_completed', { monitor: REF, volumeMl: 1, durationMs: 1, source: 'cloud', ts: NOW });
    await engine!.flush();
    expect(banners).toHaveLength(1);
  });
});
