import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { EventBus } from '../../src/server/core/events.js';
import { StateManager } from '../../src/server/core/state.js';
import { TabletArmRegistry } from '../../src/server/core/tabletArm.js';
import { LogService } from '../../src/server/core/logService.js';
import { SensorRegistry } from '../../src/server/core/sensorRegistry.js';
import { SessionRegistry } from '../../src/server/core/sessionMode.js';
import { SourceManager } from '../../src/server/ingest/manager.js';
import { PresenceRegistry } from '../../src/server/core/presence.js';
import { MotionSourceRegistry } from '../../src/server/core/motionSources.js';
import { AutomationEngine } from '../../src/server/automation/engine.js';
import type { AppContext } from '../../src/server/context.js';
import { registerConfiguredSources } from '../../src/server/ingest/bootstrap.js';

// ---------------------------------------------------------------------------
// Task 7 fix round 1 (F2, Important): pins the shared-scanner INSTANCE COUNT, not just
// "both sources registered successfully" (tests/ingest/bootstrap.test.ts's "coexists
// with gen1_ble on the shared scanner" test proves the latter, but never actually
// counted `new BleScanner()` calls -- two independently-constructed scanners would have
// passed that test too, silently reintroducing the exact bug ble/scanner.ts's header
// comment describes: one source's stop() stripping the other's discover listener).
//
// Isolated into its OWN file rather than added to tests/ingest/bootstrap.test.ts:
// `vi.mock` replaces the module for this ENTIRE test file, and bootstrap.test.ts's other
// describe blocks (monitor identity reconciliation, settings-PATCH restart, etc.) need
// the real `BleScanner` class shape for their own (unrelated) real-source construction --
// keeping the mock scoped to a dedicated file means neither suite's test-double needs
// leak into the other's.
// ---------------------------------------------------------------------------

const { calls } = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('../../src/server/ingest/ble/scanner.js', () => ({
  // Real class shape (constructor + `acquire` resolving a release fn) so any BLE source
  // that happens to get this fake handed to it -- not exercised past registration here,
  // since nothing in this file ever calls `startAll()` -- still matches the contract
  // its own type expects.
  BleScanner: class FakeBleScanner {
    constructor(opts?: unknown) {
      calls.push(opts);
    }
    async acquire(): Promise<() => Promise<void>> {
      return async () => {};
    }
  },
}));

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'ktdash-'));
}

function makeCtx(): AppContext {
  const db = openDb(tmpDataDir());
  const bus = new EventBus();
  const settings = new SettingsStore(db);
  const state = new StateManager(db, bus);
  state.start();
  const sources = new SourceManager(bus);
  const presence = new PresenceRegistry(bus);
  const engine = new AutomationEngine({
    db, bus, settings, state, presence,
  });
  const log = new LogService(db, bus);
  return {
    db, bus, settings, state, sources, engine,
    tabletArm: new TabletArmRegistry(), log,
    sensors: new SensorRegistry(bus, log), session: new SessionRegistry(), version: '0.0.0-dev',
    presence, motion: new MotionSourceRegistry(bus, presence, log, settings),
  };
}

const BLE_MOTION_SOURCE = {
  id: 'beacon-1', name: 'Hallway BTHome beacon', type: 'ble' as const, enabled: true,
  wallSlug: 'main', config: { mac: null },
};

describe('registerConfiguredSources: shared BleScanner instance count (Task 7 fix F2)', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('gen1_ble + motion_ble both configured -> BleScanner constructed EXACTLY once', () => {
    const ctx = makeCtx();
    ctx.settings.set('bleDirectEnabled', true);
    ctx.settings.set('motionSources', [BLE_MOTION_SOURCE] as never);

    registerConfiguredSources(ctx);

    expect(ctx.sources.status().find((s) => s.name === 'gen1_ble')!.registered).toBe(true);
    expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('ble-motion-only (no Gen 1 direct, no Pro BLE) -> BleScanner constructed once', () => {
    const ctx = makeCtx();
    ctx.settings.set('motionSources', [BLE_MOTION_SOURCE] as never);

    registerConfiguredSources(ctx);

    expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('neither Gen 1 direct, Pro BLE, nor any ble-type motion source -> BleScanner never constructed', () => {
    const ctx = makeCtx();

    registerConfiguredSources(ctx);

    expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(false);
    expect(ctx.sources.status().find((s) => s.name === 'gen1_ble')!.registered).toBe(false);
    expect(ctx.sources.status().find((s) => s.name === 'pro_ble')!.registered).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('all three BLE-touching sources (gen1_ble + pro_ble + motion_ble) together -> still exactly one BleScanner', () => {
    const ctx = makeCtx();
    ctx.settings.set('bleDirectEnabled', true);
    ctx.settings.set('proBleEnabled', true);
    ctx.settings.set('motionSources', [BLE_MOTION_SOURCE] as never);

    registerConfiguredSources(ctx);

    expect(ctx.sources.status().find((s) => s.name === 'gen1_ble')!.registered).toBe(true);
    expect(ctx.sources.status().find((s) => s.name === 'pro_ble')!.registered).toBe(true);
    expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('a rebuild (second registerConfiguredSources call) constructs a FRESH scanner, not a second concurrent one', () => {
    const ctx = makeCtx();
    ctx.settings.set('motionSources', [BLE_MOTION_SOURCE] as never);

    registerConfiguredSources(ctx);
    expect(calls).toHaveLength(1);

    registerConfiguredSources(ctx);
    // Each registration pass is its own from-scratch rebuild (ble/scanner.ts's header:
    // "NOT a module-level singleton on purpose") -- two calls means two total
    // constructions across the two passes, not that a second pass reused the first.
    expect(calls).toHaveLength(2);
  });
});
