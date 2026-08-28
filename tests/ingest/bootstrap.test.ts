import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import dgram from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
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
import {
  registerConfiguredSources, restartSourcesIfLive, resolveGpioSources, resolveBleMotionSources,
} from '../../src/server/ingest/bootstrap.js';
import { reconcileProMonitor, getMonitorByRef, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg } from '../../src/server/db/kegs.js';
import { KegtronUdpSource } from '../../src/server/ingest/kegtron/udpSource.js';
import { buildApp } from '../../src/server/app.js';
import type { AppContext } from '../../src/server/context.js';
import { AutomationEngine } from '../../src/server/automation/engine.js';

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

describe('registerConfiguredSources', () => {
  it('registers cloud only with default/empty settings; cloud self-reports missing key '
    + '(no network call, no crash)', async () => {
    const ctx = makeCtx();
    registerConfiguredSources(ctx);

    const registered = ctx.sources.status().filter((s) => s.registered).map((s) => s.name);
    expect(registered).toEqual(['kegtron_cloud', 'govee']);

    await ctx.sources.startAll();
    const cloud = ctx.sources.status().find((s) => s.name === 'kegtron_cloud')!;
    expect(cloud.healthy).toBe(false);
    expect(cloud.detail).toMatch(/no api key/i);
    await ctx.sources.stopAll();
  });

  it('registers all 4 configurable sources when settings enable everything (haPublishEnabled: false '
    + '-- mqtt_publisher stays unregistered)', () => {
    const ctx = makeCtx();
    ctx.settings.set('kegtronApiKey', 'fake-api-key-123');
    ctx.settings.set('udpEnabled', true);
    ctx.settings.set('mqtt', {
      url: 'mqtt://localhost:1883',
      gen1TopicPrefix: 'home/TheengsGateway',
      haPublishEnabled: false,
      haDiscoveryPrefix: 'homeassistant',
      appTopicPrefix: 'kegwall',
      motionTopics: [],
    });
    ctx.settings.set('bleDirectEnabled', true);

    registerConfiguredSources(ctx);

    // Never started -- this test only proves registration, not live connections; no
    // real network/MQTT-broker/BLE-adapter dependency is exercised here.
    const registered = ctx.sources.status().filter((s) => s.registered).map((s) => s.name).sort();
    expect(registered).toEqual(['gen1_ble', 'gen1_mqtt', 'govee', 'kegtron_cloud', 'kegtron_udp']);
  });

  // Phase 5 Task 5: `mqtt_publisher` (the HA discovery publisher) is gated on
  // `settings.mqtt?.haPublishEnabled` specifically -- NOT merely `settings.mqtt` being
  // set, unlike `gen1_mqtt` above, which registers whenever `settings.mqtt` exists at
  // all. A site can run the Gen 1 MQTT bridge without ever wanting HA discovery traffic
  // on the same broker.
  it('also registers mqtt_publisher when settings.mqtt.haPublishEnabled is true', () => {
    const ctx = makeCtx();
    ctx.settings.set('mqtt', {
      url: 'mqtt://localhost:1883',
      gen1TopicPrefix: 'home/TheengsGateway',
      haPublishEnabled: true,
      haDiscoveryPrefix: 'homeassistant',
      appTopicPrefix: 'kegwall',
      motionTopics: [],
    });

    registerConfiguredSources(ctx);

    const registered = ctx.sources.status().filter((s) => s.registered).map((s) => s.name).sort();
    expect(registered).toEqual(['gen1_mqtt', 'govee', 'kegtron_cloud', 'mqtt_publisher']);
  });

  it('drops mqtt_publisher on a rebuild once haPublishEnabled flips back to false', () => {
    const ctx = makeCtx();
    ctx.settings.set('mqtt', {
      url: 'mqtt://localhost:1883', gen1TopicPrefix: 'home/TheengsGateway',
      haPublishEnabled: true, haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
      motionTopics: [],
    });
    registerConfiguredSources(ctx);
    expect(ctx.sources.status().find((s) => s.name === 'mqtt_publisher')!.registered).toBe(true);

    ctx.settings.set('mqtt', {
      url: 'mqtt://localhost:1883', gen1TopicPrefix: 'home/TheengsGateway',
      haPublishEnabled: false, haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
      motionTopics: [],
    });
    registerConfiguredSources(ctx);
    expect(ctx.sources.status().find((s) => s.name === 'mqtt_publisher')!.registered).toBe(false);
  });

  it('rebuilds registrations from scratch on every call, dropping a source whose config was removed', () => {
    const ctx = makeCtx();
    ctx.settings.set('udpEnabled', true);
    registerConfiguredSources(ctx);
    expect(ctx.sources.status().find((s) => s.name === 'kegtron_udp')!.registered).toBe(true);

    ctx.settings.set('udpEnabled', false);
    registerConfiguredSources(ctx);
    expect(ctx.sources.status().find((s) => s.name === 'kegtron_udp')!.registered).toBe(false);
  });

  // Displays & Presence hub Task 2: `motion_mqtt` is now gated on the motion-source
  // registry's own mqtt-type entries (`ctx.motion.sources()`), not the removed
  // `mqtt.motionTopics` -- see ingest/bootstrap.ts. The mqtt-configured-with-no-motion-
  // sources case is already covered above ("registers all 4 configurable sources..."
  // sets `settings.mqtt` but no `motionSources`, and `motion_mqtt` is absent from its
  // expected `registered` list).
  describe('motion_mqtt gating (Task 2: registry-driven, not mqtt.motionTopics)', () => {
    const MQTT_SOURCE = {
      id: 'pir-1', name: 'Kitchen PIR', type: 'mqtt' as const, enabled: true,
      wallSlug: 'main', config: { topic: 'home/pir', match: { mode: 'any' as const } },
    };

    it('registers motion_mqtt when an enabled mqtt-type motion source exists AND mqtt is configured', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [MQTT_SOURCE] as never);
      ctx.settings.set('mqtt', {
        url: 'mqtt://localhost:1883', gen1TopicPrefix: 'home/TheengsGateway',
        haPublishEnabled: false, haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
        motionTopics: [],
      });

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'motion_mqtt')!.registered).toBe(true);
    });

    it('does not register motion_mqtt when a motion source exists but mqtt is not configured', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [MQTT_SOURCE] as never);
      // settings.mqtt stays null (never set).

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'motion_mqtt')!.registered).toBe(false);
    });

    it('does not register motion_mqtt for a disabled mqtt-type motion source even with mqtt configured', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [{ ...MQTT_SOURCE, enabled: false }] as never);
      ctx.settings.set('mqtt', {
        url: 'mqtt://localhost:1883', gen1TopicPrefix: 'home/TheengsGateway',
        haPublishEnabled: false, haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
        motionTopics: [],
      });

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'motion_mqtt')!.registered).toBe(false);
    });

    it('drops motion_mqtt on a rebuild once the last mqtt-type motion source is removed', () => {
      const ctx = makeCtx();
      ctx.settings.set('mqtt', {
        url: 'mqtt://localhost:1883', gen1TopicPrefix: 'home/TheengsGateway',
        haPublishEnabled: false, haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
        motionTopics: [],
      });
      ctx.settings.set('motionSources', [MQTT_SOURCE] as never);
      registerConfiguredSources(ctx);
      expect(ctx.sources.status().find((s) => s.name === 'motion_mqtt')!.registered).toBe(true);

      ctx.settings.set('motionSources', []);
      registerConfiguredSources(ctx);
      expect(ctx.sources.status().find((s) => s.name === 'motion_mqtt')!.registered).toBe(false);
    });
  });

  // Task 6, mirroring the motion_mqtt gating describe block above.
  describe('motion_gpio gating and defaulting (Task 6)', () => {
    it('registers motion_gpio when an enabled gpio-type motion source exists', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [{
        id: 'pir-1', name: 'Kitchen PIR', type: 'gpio', enabled: true,
        wallSlug: 'main', config: { line: 4 },
      }] as never);

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'motion_gpio')!.registered).toBe(true);
    });

    it('does not register motion_gpio when no gpio-type motion source exists', () => {
      const ctx = makeCtx();
      registerConfiguredSources(ctx);
      expect(ctx.sources.status().find((s) => s.name === 'motion_gpio')!.registered).toBe(false);
    });

    it('does not register motion_gpio for a disabled gpio-type motion source', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [{
        id: 'pir-1', name: 'Kitchen PIR', type: 'gpio', enabled: false,
        wallSlug: 'main', config: { line: 4 },
      }] as never);

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'motion_gpio')!.registered).toBe(false);
    });

    it('drops motion_gpio on a rebuild once the last gpio-type motion source is removed', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [{
        id: 'pir-1', name: 'Kitchen PIR', type: 'gpio', enabled: true,
        wallSlug: 'main', config: { line: 4 },
      }] as never);
      registerConfiguredSources(ctx);
      expect(ctx.sources.status().find((s) => s.name === 'motion_gpio')!.registered).toBe(true);

      ctx.settings.set('motionSources', []);
      registerConfiguredSources(ctx);
      expect(ctx.sources.status().find((s) => s.name === 'motion_gpio')!.registered).toBe(false);
    });

    // Task 1 adjudication, carried into Task 6 as a binding requirement: the schema
    // leaves `config.chip`/`activeLow`/`debounceMs` bare-optional -- bootstrap wiring
    // (registerConfiguredSources) is where the documented defaults (`chip` 'gpiochip0',
    // `activeLow` false, `debounceMs` 2000) get applied, so a gpio entry with only
    // `line` set still registers `motion_gpio` (proving construction succeeded with
    // resolved values -- GpioMotionSource's own constructor would throw/misbehave on
    // an unresolved `chip: undefined`/`activeLow: undefined` if the defaulting here
    // were missing or wrong).
    it('applies documented gpio defaults (chip/activeLow/debounceMs) when only `line` is set', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [{
        id: 'pir-1', name: 'Kitchen PIR', type: 'gpio', enabled: true,
        wallSlug: 'main', config: { line: 4 }, // chip/activeLow/debounceMs all omitted
      }] as never);

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'motion_gpio')!.registered).toBe(true);
    });
  });

  // Task 7, mirroring the motion_gpio gating describe block above.
  describe('motion_ble gating (Task 7)', () => {
    const BLE_SOURCE = {
      id: 'beacon-1', name: 'Hallway BTHome beacon', type: 'ble' as const, enabled: true,
      wallSlug: 'main', config: { mac: null },
    };

    it('registers motion_ble when an enabled ble-type motion source exists, with '
      + 'NEITHER Gen 1 direct nor Pro BLE also enabled (a pure BTHome-only install)', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [BLE_SOURCE] as never);

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(true);
      // Neither of the other two BLE sources exists to share the scanner with here --
      // proves motion_ble constructs the scanner on its own when it's the only BLE
      // consumer, rather than silently no-op'ing for want of one.
      expect(ctx.sources.status().find((s) => s.name === 'gen1_ble')!.registered).toBe(false);
      expect(ctx.sources.status().find((s) => s.name === 'pro_ble')!.registered).toBe(false);
    });

    it('does not register motion_ble when no ble-type motion source exists', () => {
      const ctx = makeCtx();
      registerConfiguredSources(ctx);
      expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(false);
    });

    it('does not register motion_ble for a disabled ble-type motion source', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [{ ...BLE_SOURCE, enabled: false }] as never);

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(false);
    });

    it('drops motion_ble on a rebuild once the last ble-type motion source is removed', () => {
      const ctx = makeCtx();
      ctx.settings.set('motionSources', [BLE_SOURCE] as never);
      registerConfiguredSources(ctx);
      expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(true);

      ctx.settings.set('motionSources', []);
      registerConfiguredSources(ctx);
      expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(false);
    });

    // Scanner-sharing caveat (brief): when a Gen 1 direct BLE source is ALSO enabled,
    // both it and motion_ble must register successfully off the SAME `BleScanner`
    // instance bootstrap constructs once per registration pass (ble/scanner.ts's header
    // -- two independent noble lifecycles would have one source's stop() strip the
    // other's discover listener). This can't observe the shared instance directly from
    // outside `registerConfiguredSources`, but proves both sources register cleanly
    // together rather than one clobbering the other's construction.
    it('coexists with gen1_ble on the shared scanner when both are configured', () => {
      const ctx = makeCtx();
      ctx.settings.set('bleDirectEnabled', true);
      ctx.settings.set('motionSources', [BLE_SOURCE] as never);

      registerConfiguredSources(ctx);

      expect(ctx.sources.status().find((s) => s.name === 'gen1_ble')!.registered).toBe(true);
      expect(ctx.sources.status().find((s) => s.name === 'motion_ble')!.registered).toBe(true);
    });
  });
});

// Fix-round-1 review finding F3: the "applies documented gpio defaults" test above only
// asserted `registered: true` -- true regardless of what the resolved chip/activeLow/
// debounceMs values actually were (a `GpioMotionSource` registers successfully either
// way; it doesn't validate its inputs). `resolveGpioSources` is exported specifically so
// the DEFAULTING itself is directly assertable against the exact resolved shape.
describe('resolveGpioSources (Task 1 adjudication: defaults applied here)', () => {
  it('resolves an entry with only `line` set to the exact documented defaults', () => {
    const resolved = resolveGpioSources([{
      id: 'pir-1', name: 'Kitchen PIR', type: 'gpio', enabled: true,
      wallSlug: 'main', config: { line: 4 },
    }] as never);

    expect(resolved).toEqual([
      { id: 'pir-1', chip: 'gpiochip0', line: 4, activeLow: false, debounceMs: 2000 },
    ]);
  });

  it('preserves explicit values instead of the defaults when the config sets them', () => {
    const resolved = resolveGpioSources([{
      id: 'pir-2', name: 'Basement PIR', type: 'gpio', enabled: true,
      wallSlug: null, config: { chip: 'gpiochip1', line: 17, activeLow: true, debounceMs: 500 },
    }] as never);

    expect(resolved).toEqual([
      { id: 'pir-2', chip: 'gpiochip1', line: 17, activeLow: true, debounceMs: 500 },
    ]);
  });

  it('filters out non-gpio-type entries', () => {
    const resolved = resolveGpioSources([
      {
        id: 'pir-1', name: 'Kitchen PIR', type: 'mqtt', enabled: true,
        wallSlug: 'main', config: { topic: 'home/pir', match: { mode: 'any' } },
      },
    ] as never);

    expect(resolved).toEqual([]);
  });
});

// Task 7, mirroring the resolveGpioSources describe block above.
describe('resolveBleMotionSources (Task 7: mac defaulted to null here)', () => {
  it('resolves an entry with an explicit mac', () => {
    const resolved = resolveBleMotionSources([{
      id: 'beacon-1', name: 'Hallway beacon', type: 'ble', enabled: true,
      wallSlug: 'main', config: { mac: 'AA:BB:CC:DD:EE:FF' },
    }] as never);

    expect(resolved).toEqual([{ id: 'beacon-1', mac: 'AA:BB:CC:DD:EE:FF' }]);
  });

  it('defaults an omitted mac to null (any BTHome motion advert wakes this source)', () => {
    const resolved = resolveBleMotionSources([{
      id: 'beacon-1', name: 'Hallway beacon', type: 'ble', enabled: true,
      wallSlug: 'main', config: {},
    }] as never);

    expect(resolved).toEqual([{ id: 'beacon-1', mac: null }]);
  });

  it('filters out non-ble-type entries', () => {
    const resolved = resolveBleMotionSources([
      {
        id: 'pir-1', name: 'Kitchen PIR', type: 'gpio', enabled: true,
        wallSlug: 'main', config: { line: 4 },
      },
    ] as never);

    expect(resolved).toEqual([]);
  });
});

describe('restartSourcesIfLive', () => {
  it('is a no-op when sources are not started (isStarted() false, e.g. default test app)', async () => {
    const ctx = makeCtx();
    ctx.settings.set('kegtronApiKey', 'fake-api-key-123');
    // Not calling ctx.sources.startAll() -- isStarted() stays false.
    await restartSourcesIfLive(ctx);
    expect(ctx.sources.status().every((s) => !s.registered)).toBe(true);
  });

  it('stops, re-registers from current settings, and restarts when sources ARE live', async () => {
    const ctx = makeCtx();
    registerConfiguredSources(ctx); // cloud + govee only, both self-skip (no real I/O)
    await ctx.sources.startAll();
    expect(ctx.sources.isStarted()).toBe(true);
    expect(ctx.sources.status().find((s) => s.name === 'kegtron_cloud')!.registered).toBe(true);

    // stopAll/startAll are mocked (same idiom as tests/ingest/bootstrap.test.ts's
    // "settings PATCH triggers a live source restart" describe block below) so this
    // test observes the call sequence without a gpio-type source's startAll() actually
    // spawning a real `gpiomon` child process -- `registerConfiguredSources` itself
    // (NOT mocked) still runs for real and its effect on `status().registered` is what
    // proves the rebuild picked up the new settings, independent of the mocked start.
    const stopSpy = vi.spyOn(ctx.sources, 'stopAll').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(ctx.sources, 'startAll').mockResolvedValue(undefined);

    // Change settings so a rebuild picks up a new source set (govee/cloud always
    // register, so instead prove the rebuild actually ran via a gpio motion source
    // that only exists after this settings write).
    ctx.settings.set('motionSources', [{
      id: 'pir-1', name: 'Kitchen PIR', type: 'gpio', enabled: true,
      wallSlug: 'main', config: { line: 4 },
    }] as never);

    await restartSourcesIfLive(ctx);

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(ctx.sources.status().find((s) => s.name === 'motion_gpio')!.registered).toBe(true);
  });
});

// -----------------------------------------------------------------------------------
// Task 8 HARD REQUIREMENT (flagged blocking by the Task 6 review): Kegtron Pro cloud
// discovery keys monitors by the mdash device id; the UDP streaming source only ever
// knows the device's bare serialNum. Without reconciliation those resolve to TWO
// different monitors rows for the same physical device/port, and PourDeduper (keyed on
// the monitor ref) never collapses a cloud+UDP duplicate report of the same pour. This
// suite proves the fix end-to-end with a REAL KegtronUdpSource wired exactly as
// bootstrap.ts wires it in the running app.
// -----------------------------------------------------------------------------------
describe('monitor identity reconciliation (cloud <-> UDP)', () => {
  let db: Database.Database;
  let bus: EventBus;
  let tapId: number;
  let source: KegtronUdpSource | null;
  let client: dgram.Socket | null;

  beforeEach(() => {
    db = openDb(tmpDataDir());
    bus = new EventBus();
    const state = new StateManager(db, bus);
    state.start();
    const beer = createBeer(db, { name: 'Pils' });
    tapId = createTap(db, { number: 1 }).id;
    createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId });
    source = null;
    client = dgram.createSocket('udp4');
  });

  afterEach(async () => {
    if (source) await source.stop();
    if (client) {
      await new Promise<void>((resolve) => client!.close(() => resolve()));
      client = null;
    }
  });

  function sendPacket(port: number, payload: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(JSON.stringify(payload), 'utf8');
      client!.send(buf, port, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
    });
  }

  it('resolves a UDP pour for a cloud-known serial to the SAME MonitorRef, so '
    + 'PourDeduper suppresses the duplicate pour record', async () => {
    const cloudRef = { type: 'kegtron_pro' as const, identifier: 'mdash-device-xyz', portIndex: 0 };

    // 1. Cloud "discovers" the device -- mirrors exactly what KegtronCloudSource +
    //    shadow.ts's diffToEvents() emit on the bus (see cloudSource.ts's
    //    emitShadowEvents()): monitor keyed by the mdash device id, serial carried
    //    alongside it. This is also what proves the cloud source's serial-write path
    //    (StateManager's device_discovered handler -> upsertMonitor's extra.serial ->
    //    the monitors.serial column) actually works, per this task's brief.
    bus.emit('device_discovered', { monitor: cloudRef, serial: 'SN2001011234', meta: {} });
    const cloudMon = getMonitorByRef(db, cloudRef);
    expect(cloudMon).not.toBeNull();
    expect(cloudMon!.serial).toBe('SN2001011234');
    bindMonitorToTap(db, cloudMon!.id, tapId);

    // 2. Cloud reports a pour for that device.
    const cloudTs = new Date().toISOString();
    bus.emit('pour_completed', {
      monitor: cloudRef, volumeMl: 400, durationMs: 6000, source: 'cloud', ts: cloudTs,
    });
    expect((db.prepare('SELECT COUNT(*) c FROM pours').get() as any).c).toBe(1);

    // 3. A REAL KegtronUdpSource, constructed with `reconcile` wired exactly as
    //    bootstrap.ts's registerConfiguredSources() wires it, reports the SAME
    //    physical pour for the SAME serial moments later -- UDP itself never learns
    //    the mdash device id, only the serialNum from the packet.
    const events: { event: string; payload: any }[] = [];
    for (const name of ['device_discovered', 'pour_started', 'pour_completed'] as const) {
      bus.on(name, (payload) => events.push({ event: name, payload }));
    }
    const settings = new SettingsStore(db);
    settings.set('udpEnabled', true);
    source = new KegtronUdpSource({
      bus, settings,
      reconcile: (serialNum, portIndex) => reconcileProMonitor(db, serialNum, portIndex),
      bindAddress: '127.0.0.1', port: 0, pourTimeoutMs: 60,
    });
    await source.start();
    const addr = source.address()!;

    await sendPacket(addr.port, {
      num: 1, serialNum: 'SN2001011234', portCount: 1, temp: 20,
      port0: { curServ: 400, volStart: 0, volDisp: 400, volSize: 19700 },
    });
    await vi.waitFor(() => expect(events.filter((e) => e.event === 'pour_started')).toHaveLength(1));

    await sendPacket(addr.port, {
      num: 2, serialNum: 'SN2001011234', portCount: 1, temp: 20,
      port0: { curServ: 0, volStart: 0, volDisp: 400, volSize: 19700 },
    });
    await vi.waitFor(() => expect(events.filter((e) => e.event === 'pour_completed')).toHaveLength(1));

    const udpCompleted = events.find((e) => e.event === 'pour_completed')!.payload;
    // THE fix: UDP's emitted MonitorRef is IDENTICAL to cloud's -- not `udp:SN2001011234`.
    expect(udpCompleted.monitor).toEqual(cloudRef);

    // THE proof: PourDeduper collapsed the duplicate report -- still only 1 pours row,
    // not 2, even though two DIFFERENT sources each reported a pour_completed.
    expect((db.prepare('SELECT COUNT(*) c FROM pours').get() as any).c).toBe(1);

    // The reconciled device_discovered also only ever touches the pre-existing cloud
    // row -- no second `monitors` row was created for this device/port.
    expect(db.prepare('SELECT COUNT(*) c FROM monitors').get()).toMatchObject({ c: 1 });
  });

  it('falls back to a synthetic udp:{serialNum} monitor when no cloud row matches, '
    + 'so a cloudless UDP-only device still surfaces for admin binding', async () => {
    const settings = new SettingsStore(db);
    settings.set('udpEnabled', true);
    source = new KegtronUdpSource({
      bus, settings,
      reconcile: (serialNum, portIndex) => reconcileProMonitor(db, serialNum, portIndex),
      bindAddress: '127.0.0.1', port: 0, pourTimeoutMs: 60,
    });
    await source.start();
    const addr = source.address()!;

    await sendPacket(addr.port, {
      num: 1, serialNum: 'SN-NEVER-SEEN-BY-CLOUD', portCount: 1, temp: 20,
      port0: { curServ: 50, volStart: 0, volDisp: 50, volSize: 5000 },
    });

    await vi.waitFor(() => {
      const mon = getMonitorByRef(db, {
        type: 'kegtron_pro', identifier: 'udp:SN-NEVER-SEEN-BY-CLOUD', portIndex: 0,
      });
      expect(mon).not.toBeNull();
    });
  });
});

describe('settings PATCH triggers a live source restart', () => {
  let app: FastifyInstance | null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  async function setupAdmin(a: FastifyInstance): Promise<{ session: string }> {
    const setup = await a.inject({
      method: 'POST', url: '/api/auth/setup',
      payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
    });
    return { session: setup.cookies.find((c: any) => c.name === 'session')!.value };
  }

  it('calls stopAll -> re-register -> startAll when a source-relevant setting changes, '
    + 'once sources are actually running', async () => {
    app = await buildApp({ dataDir: tmpDataDir(), startSources: true });
    const adminCookies = await setupAdmin(app);
    expect(app.ctx.sources.isStarted()).toBe(true);

    const stopSpy = vi.spyOn(app.ctx.sources, 'stopAll').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(app.ctx.sources, 'startAll').mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { udpEnabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('does not restart sources for a PATCH that touches none of the restart-triggering keys', async () => {
    app = await buildApp({ dataDir: tmpDataDir(), startSources: true });
    const adminCookies = await setupAdmin(app);

    const stopSpy = vi.spyOn(app.ctx.sources, 'stopAll').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(app.ctx.sources, 'startAll').mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { siteName: 'Renamed Taproom' },
    });
    expect(res.statusCode).toBe(200);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('does not restart sources when they were never started (default test-mode safety '
    + '-- prevents a real mdash.net call from an incidental kegtronApiKey PATCH in tests)', async () => {
    app = await buildApp({ dataDir: tmpDataDir() }); // startSources defaults to false
    const adminCookies = await setupAdmin(app);
    expect(app.ctx.sources.isStarted()).toBe(false);

    const stopSpy = vi.spyOn(app.ctx.sources, 'stopAll').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(app.ctx.sources, 'startAll').mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { kegtronApiKey: 'totally-fake-key' },
    });
    expect(res.statusCode).toBe(200);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });
});
