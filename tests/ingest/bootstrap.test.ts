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
import { registerConfiguredSources } from '../../src/server/ingest/bootstrap.js';
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
  const engine = new AutomationEngine({ db, bus, settings, state });
  const log = new LogService(db, bus);
  return {
    db, bus, settings, state, sources, engine,
    tabletArm: new TabletArmRegistry(), log,
    sensors: new SensorRegistry(bus, log), session: new SessionRegistry(), version: '0.0.0-dev',
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
    });
    registerConfiguredSources(ctx);
    expect(ctx.sources.status().find((s) => s.name === 'mqtt_publisher')!.registered).toBe(true);

    ctx.settings.set('mqtt', {
      url: 'mqtt://localhost:1883', gen1TopicPrefix: 'home/TheengsGateway',
      haPublishEnabled: false, haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
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
      bus, settings, isCloudHealthy: () => true,
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
      bus, settings, isCloudHealthy: () => true,
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
