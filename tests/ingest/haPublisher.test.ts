import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';
import { Aedes } from 'aedes';
import mqtt, { type MqttClient, type IPublishPacket } from 'mqtt';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { EventBus } from '../../src/server/core/events.js';
import { StateManager } from '../../src/server/core/state.js';
import { HaPublisherSource } from '../../src/server/ingest/haPublisher.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, swapKeg } from '../../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';

// ---------------------------------------------------------------------------
// Phase 5 Task 5: HaPublisherSource against a real local aedes broker -- same
// fake-upstream-real-protocol precedent as tests/ingest/mqttSource.test.ts and
// tests/notify/mqttSender.test.ts.
// ---------------------------------------------------------------------------

interface Received { topic: string; payload: string; retain: boolean }

let broker: Aedes;
let server: net.Server;
let brokerPort: number;
let db: Database.Database;
let bus: EventBus;
let settings: SettingsStore;
let state: StateManager;
let source: HaPublisherSource | null;
let subscriber: MqttClient | null;
let received: Received[];
let statusEvents: { healthy: boolean; detail: string }[];

async function startBroker(): Promise<void> {
  broker = await Aedes.createBroker();
  server = net.createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  brokerPort = (server.address() as { port: number }).port;
}

async function stopBroker(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => broker.close(() => resolve()));
}

async function subscribeAll(): Promise<void> {
  received = [];
  subscriber = mqtt.connect(`mqtt://127.0.0.1:${brokerPort}`);
  await new Promise<void>((resolve, reject) => {
    subscriber!.once('connect', () => resolve());
    subscriber!.once('error', reject);
  });
  subscriber.subscribe('#');
  subscriber.on('message', (topic, payload, packet: IPublishPacket) => {
    received.push({ topic, payload: payload.toString('utf8'), retain: packet.retain });
  });
}

function byTopic(topic: string): Received[] {
  return received.filter((r) => r.topic === topic);
}

function byTopicSuffix(suffix: string): Received[] {
  return received.filter((r) => r.topic.endsWith(suffix));
}

function json(r: Received): any {
  return JSON.parse(r.payload);
}

/** Proves retention (or its absence) the ONLY reliable way against aedes: a client that
 * SUBSCRIBES AFTER the fact only ever receives a message if the broker stored it as
 * retained -- unlike the `packet.retain` flag on a LIVE delivery to an already-subscribed
 * client, which aedes always clears for a plain (non-MQTT5-RAP) subscription regardless of
 * whether the original publish was retained (aedes `lib/handlers/subscribe.js`: `if (!rap)
 * _packet.retain = false`). Connects a fresh client, subscribes to `topicFilter`, waits
 * `waitMs` for whatever arrives (immediately, if retained), then disconnects. */
async function lateSubscribeCollect(topicFilter: string, waitMs = 200): Promise<Received[]> {
  const late = mqtt.connect(`mqtt://127.0.0.1:${brokerPort}`);
  await new Promise<void>((resolve, reject) => {
    late.once('connect', () => resolve());
    late.once('error', reject);
  });
  const got: Received[] = [];
  late.on('message', (topic, payload, packet: IPublishPacket) => {
    got.push({ topic, payload: payload.toString('utf8'), retain: packet.retain });
  });
  await new Promise<void>((resolve, reject) => {
    late.subscribe(topicFilter, (err) => (err ? reject(err) : resolve()));
  });
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  await new Promise<void>((resolve) => late.end(true, {}, () => resolve()));
  return got;
}

const MQTT_CFG = {
  gen1TopicPrefix: 'home/TheengsGateway',
  haPublishEnabled: true,
  haDiscoveryPrefix: 'homeassistant',
  appTopicPrefix: 'kegtron-dashboard',
};

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'ktdash-'));
}

async function makeSource(debounceMs = 20): Promise<HaPublisherSource> {
  const src = new HaPublisherSource({ bus, settings, db, state, debounceMs });
  await src.start();
  return src;
}

function seedTap(number: number, beerName = 'Test Beer'): { tapId: number; kegId: number; beerId: number } {
  const beer = createBeer(db, { name: beerName });
  const tap = createTap(db, { number });
  const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
  return { tapId: tap.id, kegId: keg.id, beerId: beer.id };
}

beforeEach(async () => {
  await startBroker();
  db = openDb(tmpDataDir());
  bus = new EventBus();
  state = new StateManager(db, bus);
  state.start();
  settings = new SettingsStore(db);
  statusEvents = [];
  bus.on('source_status', (e) => {
    if (e.source === 'mqtt_publisher') statusEvents.push({ healthy: e.healthy, detail: e.detail });
  });
  source = null;
  subscriber = null;
});

afterEach(async () => {
  if (source) await source.stop();
  if (subscriber) {
    await new Promise<void>((resolve) => subscriber!.end(true, {}, () => resolve()));
    subscriber = null;
  }
  await stopBroker();
});

describe('HaPublisherSource.start() when not configured', () => {
  it('mqtt not set at all -- unhealthy "not configured", no connection attempt', async () => {
    await subscribeAll();
    source = await makeSource();
    expect(statusEvents).toEqual([{ healthy: false, detail: expect.stringContaining('not configured') }]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received).toHaveLength(0);
  });

  it('mqtt set but haPublishEnabled: false -- unhealthy "not configured", no connection attempt', async () => {
    settings.set('mqtt', { url: `mqtt://127.0.0.1:${brokerPort}`, ...MQTT_CFG, haPublishEnabled: false });
    await subscribeAll();
    source = await makeSource();
    expect(statusEvents).toEqual([{ healthy: false, detail: expect.stringContaining('not configured') }]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received).toHaveLength(0);
  });

  it('stop() before start() (or on an unconfigured source) is a clean no-op', async () => {
    source = new HaPublisherSource({ bus, settings, db, state });
    await expect(source.stop()).resolves.toBeUndefined();
  });
});

describe('HaPublisherSource against a real broker', () => {
  beforeEach(() => {
    settings.set('mqtt', { url: `mqtt://127.0.0.1:${brokerPort}`, ...MQTT_CFG });
  });

  it('publishes retained "online" availability on connect', async () => {
    await subscribeAll();
    source = await makeSource();
    await vi.waitFor(() => expect(byTopic('kegtron-dashboard/availability')).toHaveLength(1));
    expect(byTopic('kegtron-dashboard/availability')[0]!.payload).toBe('online');
    await vi.waitFor(() => expect(statusEvents.some((s) => s.healthy)).toBe(true));

    const late = await lateSubscribeCollect('kegtron-dashboard/availability');
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ payload: 'online', retain: true });
  });

  it('publishes retained "offline" availability on stop()', async () => {
    await subscribeAll();
    source = await makeSource();
    await vi.waitFor(() => expect(byTopic('kegtron-dashboard/availability').some((r) => r.payload === 'online')).toBe(true));
    await source.stop();
    source = null;
    await vi.waitFor(() => {
      const avail = byTopic('kegtron-dashboard/availability');
      expect(avail[avail.length - 1]?.payload).toBe('offline');
    });

    const late = await lateSubscribeCollect('kegtron-dashboard/availability');
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ payload: 'offline', retain: true });
  });

  describe('discovery payloads (HA MQTT discovery format)', () => {
    it('publishes 5 retained discovery configs per tap (4 sensors + 1 binary_sensor)', async () => {
      const { tapId } = seedTap(1);
      await subscribeAll();
      source = await makeSource();
      await vi.waitFor(() => expect(byTopicSuffix('/config').length).toBeGreaterThanOrEqual(5));

      const level = byTopic(`homeassistant/sensor/kegtron_tap_${tapId}/level/config`)[0]!;
      const cfg = json(level);
      expect(cfg).toMatchObject({
        name: 'Level',
        unique_id: `kegtron_tap_${tapId}_level`,
        state_topic: `kegtron-dashboard/tap/${tapId}/state`,
        unit_of_measurement: '%',
        device: {
          identifiers: [`kegtron_tap_${tapId}`],
          name: 'Tap 1',
        },
        availability: [{ topic: 'kegtron-dashboard/availability' }],
      });

      const remaining = json(byTopic(`homeassistant/sensor/kegtron_tap_${tapId}/remaining/config`)[0]!);
      expect(remaining).toMatchObject({ name: 'Remaining', unit_of_measurement: 'L', device_class: 'volume' });

      const beerCfg = json(byTopic(`homeassistant/sensor/kegtron_tap_${tapId}/beer/config`)[0]!);
      expect(beerCfg).toMatchObject({
        name: 'Beer',
        json_attributes_topic: `kegtron-dashboard/tap/${tapId}/state`,
      });
      expect(beerCfg.json_attributes_template).toContain('style');

      const lastPour = json(byTopic(`homeassistant/sensor/kegtron_tap_${tapId}/last_pour/config`)[0]!);
      expect(lastPour).toMatchObject({ name: 'Last pour', unit_of_measurement: 'mL' });

      const pouring = byTopic(`homeassistant/binary_sensor/kegtron_tap_${tapId}/pouring/config`)[0]!;
      expect(json(pouring)).toMatchObject({ name: 'Pouring', unique_id: `kegtron_tap_${tapId}_pouring` });

      // Retention proof (see lateSubscribeCollect's doc comment): a client subscribing
      // AFTER the fact still receives the discovery config immediately, retained.
      const late = await lateSubscribeCollect(`homeassistant/sensor/kegtron_tap_${tapId}/level/config`);
      expect(late).toHaveLength(1);
      expect(late[0]!.retain).toBe(true);
    });

    it('publishes 2 retained discovery configs per BOUND Kegtron Pro monitor (temp + humidity)', async () => {
      const { tapId } = seedTap(1);
      const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
      const mon = upsertMonitor(db, ref);
      bindMonitorToTap(db, mon.id, tapId);

      await subscribeAll();
      source = await makeSource();
      await vi.waitFor(() => expect(byTopicSuffix('/config').length).toBeGreaterThanOrEqual(7));

      const temp = json(byTopic(`homeassistant/sensor/kegtron_monitor_${mon.id}/temp/config`)[0]!);
      expect(temp).toMatchObject({
        name: 'Temperature', device_class: 'temperature', unit_of_measurement: '°C',
        state_topic: `kegtron-dashboard/monitor/${mon.id}/state`,
        device: { identifiers: [`kegtron_monitor_${mon.id}`] },
      });

      const humidity = json(byTopic(`homeassistant/sensor/kegtron_monitor_${mon.id}/humidity/config`)[0]!);
      expect(humidity).toMatchObject({ name: 'Humidity', device_class: 'humidity', unit_of_measurement: '%' });
    });

    it('does NOT publish discovery configs for an UNBOUND Kegtron Pro monitor', async () => {
      seedTap(1);
      const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
      const mon = upsertMonitor(db, ref); // never bound to a tap

      await subscribeAll();
      source = await makeSource();
      await vi.waitFor(() => expect(byTopicSuffix('/config').length).toBeGreaterThanOrEqual(5));
      expect(byTopicSuffix(`kegtron_monitor_${mon.id}/temp/config`)).toHaveLength(0);
    });
  });

  describe('state publishing (debounced on state_changed)', () => {
    it('publishes an initial state payload for each tap on connect, reflecting keg/beer', async () => {
      seedTap(1, 'Hazy IPA');
      await subscribeAll();
      source = await makeSource();
      await vi.waitFor(() => {
        const states = received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic));
        expect(states.length).toBeGreaterThanOrEqual(1);
      });
      const stateMsg = received.find((r) => /\/tap\/\d+\/state$/.test(r.topic))!;
      const payload = json(stateMsg);
      expect(payload).toMatchObject({
        level_pct: 100, remaining_l: 19, beer_name: 'Hazy IPA', pouring: false, last_pour_ml: null,
      });
    });

    it('coalesces bursts of state_changed into ONE publish per debounce window, published after debounceMs', async () => {
      seedTap(1);
      await subscribeAll();
      source = await makeSource(50);
      await vi.waitFor(() => expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).not.toHaveLength(0));
      received = [];

      // Burst of state_changed events well within the debounce window.
      for (let i = 0; i < 5; i += 1) {
        bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
      }
      // Immediately after the burst, nothing has published yet (still inside the window).
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).toHaveLength(0);

      // Once the debounce window elapses, exactly one publish went out for the whole burst.
      await vi.waitFor(() => {
        expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).toHaveLength(1);
      }, { timeout: 1000 });
    });

    it('a later state_changed after the window closes triggers a NEW publish', async () => {
      seedTap(1);
      await subscribeAll();
      source = await makeSource(20);
      await vi.waitFor(() => expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).not.toHaveLength(0));
      received = [];

      bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
      await vi.waitFor(() => expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).toHaveLength(1));
      received = [];

      bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
      await vi.waitFor(() => expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).toHaveLength(1));
    });

    it('ignores state_changed events for other scopes', async () => {
      seedTap(1);
      await subscribeAll();
      source = await makeSource(20);
      await vi.waitFor(() => expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).not.toHaveLength(0));
      received = [];

      bus.emit('state_changed', { scope: 'notifications', ts: new Date().toISOString() });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).toHaveLength(0);
    });
  });

  describe('discovery re-publish on shape changes', () => {
    it('re-publishes discovery when a NEW tap appears; a plain state refresh does not', async () => {
      seedTap(1);
      await subscribeAll();
      source = await makeSource(20);
      await vi.waitFor(() => expect(byTopicSuffix('/config').length).toBeGreaterThanOrEqual(5));
      const firstConfigCount = byTopicSuffix('/config').length;
      received = [];

      // Plain refresh, no shape change -- discovery must NOT republish.
      bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
      await vi.waitFor(() => expect(received.filter((r) => /\/tap\/\d+\/state$/.test(r.topic))).toHaveLength(1));
      expect(byTopicSuffix('/config')).toHaveLength(0);

      // Now add a second tap -- shape changed, discovery republishes (superset, including the new tap's).
      received = [];
      seedTap(2);
      bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
      await vi.waitFor(() => expect(byTopicSuffix('/config').length).toBeGreaterThan(0));
      expect(byTopicSuffix('/config').length).toBeGreaterThanOrEqual(firstConfigCount * 2);
    });

    it('re-publishes discovery when a keg swap changes the tapped beer', async () => {
      const { tapId } = seedTap(1, 'Original Beer');
      await subscribeAll();
      source = await makeSource(20);
      await vi.waitFor(() => expect(byTopicSuffix('/config').length).toBeGreaterThanOrEqual(5));
      received = [];

      const newBeer = createBeer(db, { name: 'New Beer' });
      swapKeg(db, { tapId, newBeerId: newBeer.id, sizeMl: 19000, volStartMl: 19000 });
      bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });

      await vi.waitFor(() => expect(byTopicSuffix('/config').length).toBeGreaterThan(0));
      const beerCfgMsgs = byTopic(`homeassistant/sensor/kegtron_tap_${tapId}/beer/config`);
      expect(beerCfgMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('re-publishes discovery when a Kegtron Pro monitor is bound/unbound', async () => {
      const { tapId } = seedTap(1);
      const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
      const mon = upsertMonitor(db, ref);

      await subscribeAll();
      source = await makeSource(20);
      await vi.waitFor(() => expect(byTopicSuffix('/config').length).toBeGreaterThanOrEqual(5));
      expect(byTopicSuffix(`kegtron_monitor_${mon.id}/temp/config`)).toHaveLength(0);
      received = [];

      bindMonitorToTap(db, mon.id, tapId);
      bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });

      await vi.waitFor(() => expect(byTopicSuffix(`kegtron_monitor_${mon.id}/temp/config`)).toHaveLength(1));
    });
  });

  describe('event relay (non-retained)', () => {
    it('relays pour_completed to <appTopicPrefix>/event/pour, non-retained', async () => {
      const { tapId } = seedTap(3, 'Session IPA');
      const ref = { type: 'kegtron_pro' as const, identifier: 'dev1', portIndex: 0 };
      const mon = upsertMonitor(db, ref);
      bindMonitorToTap(db, mon.id, tapId);

      await subscribeAll();
      source = await makeSource();
      await vi.waitFor(() => expect(statusEvents.some((s) => s.healthy)).toBe(true));
      received = [];

      const ts = new Date().toISOString();
      bus.emit('pour_completed', { monitor: ref, volumeMl: 355, durationMs: 4000, source: 'cloud', ts });

      await vi.waitFor(() => expect(byTopic('kegtron-dashboard/event/pour')).toHaveLength(1));
      const msg = byTopic('kegtron-dashboard/event/pour')[0]!;
      expect(json(msg)).toEqual({ tap: 3, beer: 'Session IPA', volumeMl: 355, ts });

      // Non-retention proof: a client subscribing AFTER the fact receives nothing.
      const late = await lateSubscribeCollect('kegtron-dashboard/event/pour', 100);
      expect(late).toHaveLength(0);
    });

    it('relays alert_fired to <appTopicPrefix>/event/alert, non-retained', async () => {
      await subscribeAll();
      source = await makeSource();
      await vi.waitFor(() => expect(statusEvents.some((s) => s.healthy)).toBe(true));
      received = [];

      const ts = new Date().toISOString();
      bus.emit('alert_fired', {
        ruleId: 1, ruleName: 'Keg Low', severity: 'warning', title: 'Keg low', body: 'Below 15%', tapId: 7, ts,
      });

      await vi.waitFor(() => expect(byTopic('kegtron-dashboard/event/alert')).toHaveLength(1));
      const msg = byTopic('kegtron-dashboard/event/alert')[0]!;
      expect(json(msg)).toEqual({ rule: 'Keg Low', severity: 'warning', title: 'Keg low', tapId: 7, ts });

      const late = await lateSubscribeCollect('kegtron-dashboard/event/alert', 100);
      expect(late).toHaveLength(0);
    });

    it('alert_fired with no tapId relays tapId: null', async () => {
      await subscribeAll();
      source = await makeSource();
      await vi.waitFor(() => expect(statusEvents.some((s) => s.healthy)).toBe(true));
      received = [];

      const ts = new Date().toISOString();
      bus.emit('alert_fired', { ruleId: 2, ruleName: 'App started', severity: 'info', title: 'x', body: '', ts });

      await vi.waitFor(() => expect(byTopic('kegtron-dashboard/event/alert')).toHaveLength(1));
      expect(json(byTopic('kegtron-dashboard/event/alert')[0]!).tapId).toBeNull();
    });
  });

  describe('teardown', () => {
    it('stop() unsubscribes bus listeners -- further bus events publish nothing', async () => {
      seedTap(1);
      await subscribeAll();
      source = await makeSource(20);
      // Wait for the initial connect-triggered discovery+state burst to fully arrive --
      // otherwise a still-in-flight publish from BEFORE stop() could land during the
      // post-stop wait below and be mistaken for one caused by the events emitted after.
      await vi.waitFor(() => expect(received.some((r) => /\/tap\/\d+\/state$/.test(r.topic))).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 100)); // let the rest of the burst drain
      await source.stop();
      const stopped = source;
      source = null;
      received = [];

      bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
      bus.emit('pour_completed', {
        monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 },
        volumeMl: 100, durationMs: 1, source: 'cloud', ts: new Date().toISOString(),
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(received).toHaveLength(0);
      void stopped;
    });

    it('stop() is idempotent', async () => {
      source = await makeSource();
      await source.stop();
      await expect(source.stop()).resolves.toBeUndefined();
    });
  });

  describe('LWT (last will)', () => {
    it('an ungraceful disconnect (socket destroyed, no clean DISCONNECT) delivers the retained "offline" will', async () => {
      await subscribeAll();
      source = await makeSource();
      await vi.waitFor(() => expect(byTopic('kegtron-dashboard/availability').some((r) => r.payload === 'online')).toBe(true));
      received = [];

      // Simulate a crash: destroy the underlying TCP stream directly, bypassing mqtt.js's
      // own end()/DISCONNECT handshake (which would otherwise make the broker discard the
      // will, per the MQTT spec) -- see haPublisher.ts header comment.
      const client = (source as unknown as { client: MqttClient }).client;
      client.stream.destroy();

      await vi.waitFor(() => {
        const avail = byTopic('kegtron-dashboard/availability');
        expect(avail.some((r) => r.payload === 'offline')).toBe(true);
      }, { timeout: 2000 });

      const late = await lateSubscribeCollect('kegtron-dashboard/availability');
      expect(late).toHaveLength(1);
      expect(late[0]).toMatchObject({ payload: 'offline', retain: true });

      // The client is now dead at the transport level; stop() must still resolve cleanly
      // (idempotent path -- client.connected is false, no publish attempted).
      await source.stop();
      source = null;
    });
  });
});
