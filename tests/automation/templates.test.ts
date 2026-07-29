import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { EventBus } from '../../src/server/core/events.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { StateManager } from '../../src/server/core/state.js';
import { AutomationEngine } from '../../src/server/automation/engine.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg } from '../../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createAutomation } from '../../src/server/db/automations.js';
import { listNotifications } from '../../src/server/db/notificationsRepo.js';
import { AutomationRuleConfigSchema } from '../../src/server/core/automationSchema.js';
import { TEMPLATES, getTemplate } from '../../src/server/automation/templates.js';

// ---------------------------------------------------------------------------
// Phase 5 Task 4: the 9 spec one-click alert templates. Two layers of coverage per
// template, per the plan's own test-matrix line ("each produces a rule that parses via
// automationSchema and engine-fires on a synthetic matching event"):
//   1. `TEMPLATES catalog` -- every template's DEFAULT params build a rule (or rules)
//      that validate against AutomationRuleConfigSchema (schema-level, no engine).
//   2. `template instantiation fires on a synthetic matching event` -- a real engine +
//      bus + db harness (same trio `tests/automation/engine.test.ts` builds), one bus
//      event sequence per template kind, asserting an observable effect (a notification
//      row, since every template's example action is `notify` -> `inApp`).
// ---------------------------------------------------------------------------

const REF = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };

let db: Database.Database;
let bus: EventBus;
let settings: SettingsStore;
let state: StateManager;
let engine: AutomationEngine;

function seed(): { tapId: number; kegId: number; beerId: number } {
  const beer = createBeer(db, { name: 'Test Beer' });
  const tap = createTap(db, { number: 1 });
  const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
  const mon = upsertMonitor(db, REF);
  bindMonitorToTap(db, mon.id, tap.id);
  return { tapId: tap.id, kegId: keg.id, beerId: beer.id };
}

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
  settings = new SettingsStore(db);
  state = new StateManager(db, bus);
  state.start();
  engine = new AutomationEngine({ db, bus, settings, state });
});

describe('TEMPLATES catalog', () => {
  it('has exactly the 9 spec alert kinds, with unique ids', () => {
    expect(TEMPLATES).toHaveLength(9);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(9);
  });

  it.each(TEMPLATES.map((t) => t.id))(
    '%s: default params build a rule (or rules) that parses via AutomationRuleConfigSchema',
    (id) => {
      const tmpl = getTemplate(id)!;
      const params = tmpl.paramsSchema.parse({});
      const inputs = tmpl.build(params, { servingSizeMl: 473 });
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        expect(() => AutomationRuleConfigSchema.parse(input)).not.toThrow();
      }
    },
  );

  it('getTemplate returns undefined for an unknown id', () => {
    expect(getTemplate('does-not-exist')).toBeUndefined();
  });

  it('every param the metadata lists is understood by the paramsSchema (round-trips defaults)', () => {
    for (const tmpl of TEMPLATES) {
      const defaults: Record<string, unknown> = {};
      for (const p of tmpl.params) if (p.default !== undefined) defaults[p.name] = p.default;
      expect(() => tmpl.paramsSchema.parse(defaults)).not.toThrow();
    }
  });
});

describe('template instantiation fires on a synthetic matching event', () => {
  it('keg_low: fires when the keg level crosses below the threshold', async () => {
    seed();
    const tmpl = getTemplate('keg_low')!;
    const [input] = tmpl.build(tmpl.paramsSchema.parse({ thresholdPct: 15 }), { servingSizeMl: 473 });
    createAutomation(db, input!);
    engine.start();

    const ts = new Date().toISOString();
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts }); // baseline, ~94.7%
    await engine.flush();
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 17000, sizeMl: 19000, ts }); // ~10.5%, crosses below 15%
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(1);
  });

  it('keg_kicked: fires on the keg_kicked event', async () => {
    const { tapId, kegId, beerId } = seed();
    const tmpl = getTemplate('keg_kicked')!;
    const [input] = tmpl.build(tmpl.paramsSchema.parse({}), { servingSizeMl: 473 });
    createAutomation(db, input!);
    engine.start();

    bus.emit('keg_kicked', { tapId, kegId, beerId, ts: new Date().toISOString() });
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(1);
  });

  it('servings_remaining: fires once the level crosses the servings*servingSizeMl-derived threshold', async () => {
    seed();
    const tmpl = getTemplate('servings_remaining')!;
    const [input] = tmpl.build(
      tmpl.paramsSchema.parse({ servings: 5, kegSizeMl: 19000 }), { servingSizeMl: 473 },
    );
    createAutomation(db, input!);
    engine.start();

    const ts = new Date().toISOString();
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 1000, sizeMl: 19000, ts }); // baseline
    await engine.flush();
    bus.emit('volume_update', { monitor: REF, volStartMl: 19000, volDispensedMl: 18800, sizeMl: 19000, ts }); // ~1%, well under 5 servings
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(1);
  });

  it('device_offline: fires immediately on the raw device_offline event (minutes param is documented, not enforced)', async () => {
    seed();
    const tmpl = getTemplate('device_offline')!;
    const [input] = tmpl.build(tmpl.paramsSchema.parse({ minutes: 5 }), { servingSizeMl: 473 });
    createAutomation(db, input!);
    engine.start();

    bus.emit('device_offline', { monitor: REF, ts: new Date().toISOString() });
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(1);
  });

  it('temp_out_of_range: builds 2 rules (above max, below min); the max-crossing rule fires', async () => {
    seed();
    const tmpl = getTemplate('temp_out_of_range')!;
    const inputs = tmpl.build(tmpl.paramsSchema.parse({ minTemp: 1, maxTemp: 8 }), { servingSizeMl: 473 });
    expect(inputs).toHaveLength(2);
    for (const input of inputs) createAutomation(db, input);
    engine.start();

    const ts = new Date().toISOString();
    bus.emit('telemetry', { monitor: REF, temp: 4, humidity: null, ts }); // baseline, in range
    await engine.flush();
    bus.emit('telemetry', { monitor: REF, temp: 12, humidity: null, ts }); // crosses above max
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(1);
  });

  it('temp_out_of_range: the min-crossing rule fires independently', async () => {
    seed();
    const tmpl = getTemplate('temp_out_of_range')!;
    const inputs = tmpl.build(tmpl.paramsSchema.parse({ minTemp: 1, maxTemp: 8 }), { servingSizeMl: 473 });
    for (const input of inputs) createAutomation(db, input);
    engine.start();

    const ts = new Date().toISOString();
    bus.emit('telemetry', { monitor: REF, temp: 4, humidity: null, ts });
    await engine.flush();
    bus.emit('telemetry', { monitor: REF, temp: -2, humidity: null, ts }); // crosses below min
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(1);
  });

  it('humidity_out_of_range: builds 2 rules (above max, below min); the max-crossing rule fires', async () => {
    seed();
    const tmpl = getTemplate('humidity_out_of_range')!;
    const inputs = tmpl.build(
      tmpl.paramsSchema.parse({ minHumidity: 30, maxHumidity: 70 }), { servingSizeMl: 473 },
    );
    expect(inputs).toHaveLength(2);
    for (const input of inputs) createAutomation(db, input);
    engine.start();

    const ts = new Date().toISOString();
    bus.emit('telemetry', { monitor: REF, temp: null, humidity: 50, ts }); // baseline, in range
    await engine.flush();
    bus.emit('telemetry', { monitor: REF, temp: null, humidity: 85, ts }); // crosses above max
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(1);
  });

  it('possible_leak: fires when a pour exceeds the volume threshold', async () => {
    seed();
    const tmpl = getTemplate('possible_leak')!;
    const [input] = tmpl.build(tmpl.paramsSchema.parse({ volumeMl: 2000 }), { servingSizeMl: 473 });
    createAutomation(db, input!);
    engine.start();

    bus.emit('pour_completed', {
      monitor: REF, volumeMl: 3000, durationMs: 5000, source: 'cloud', ts: new Date().toISOString(),
    });
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(1);
  });

  it('possible_leak: a normal-sized pour does not fire', async () => {
    seed();
    const tmpl = getTemplate('possible_leak')!;
    const [input] = tmpl.build(tmpl.paramsSchema.parse({ volumeMl: 2000 }), { servingSizeMl: 473 });
    createAutomation(db, input!);
    engine.start();

    bus.emit('pour_completed', {
      monitor: REF, volumeMl: 400, durationMs: 5000, source: 'cloud', ts: new Date().toISOString(),
    });
    await engine.flush();

    expect(listNotifications(db)).toHaveLength(0);
  });

  it('cleaning_due: fires for an overdue monitor at the scheduled check time', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
      seed();
      upsertMonitor(db, REF, { meta: { dateCleaned: '2025/11/01' } }); // well over 30 days ago
      const tmpl = getTemplate('cleaning_due')!;
      const [input] = tmpl.build(tmpl.paramsSchema.parse({ days: 30, time: '09:00' }), { servingSizeMl: 473 });
      createAutomation(db, input!);
      engine.start();
      await engine.flush();

      expect(listNotifications(db)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleaning_due: does not fire before the configured day threshold', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
      seed();
      upsertMonitor(db, REF, { meta: { dateCleaned: '2026/01/01' } }); // only 4 days ago
      const tmpl = getTemplate('cleaning_due')!;
      const [input] = tmpl.build(tmpl.paramsSchema.parse({ days: 30, time: '09:00' }), { servingSizeMl: 473 });
      createAutomation(db, input!);
      engine.start();
      await engine.flush();

      expect(listNotifications(db)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('new_keg_tapped: fires on keg_tapped, as a plain (non-alert) info notification', async () => {
    const { tapId, kegId, beerId } = seed();
    const tmpl = getTemplate('new_keg_tapped')!;
    const [input] = tmpl.build(tmpl.paramsSchema.parse({}), { servingSizeMl: 473 });
    expect(input!.isAlert).toBeFalsy();
    createAutomation(db, input!);
    engine.start();

    bus.emit('keg_tapped', { tapId, kegId, beerId, ts: new Date().toISOString() });
    await engine.flush();

    const notes = listNotifications(db);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.severity).toBe('info');
  });
});
