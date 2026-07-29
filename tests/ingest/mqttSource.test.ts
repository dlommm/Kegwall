import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';
import { Aedes } from 'aedes';
import mqtt, { type MqttClient } from 'mqtt';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { EventBus } from '../../src/server/core/events.js';
import { Gen1MqttSource } from '../../src/server/ingest/gen1/mqttSource.js';

// This file spins up a REAL local aedes broker (see startBroker() below) rather than
// mocking `mqtt` -- same fake-upstream-real-protocol precedent as tests/ingest/
// haPublisher.test.ts, tests/notify/mqttSender.test.ts, and the automation engine's
// `mqtt_publish` action tests. Phase 6 flake sweep: this file is intentionally kept in
// vitest.config.ts's `server-mqtt-broker` project (`fileParallelism: false`) alongside
// those other 3 files -- see that config file's header comment for the empirically
// reproduced "Invalid header flag bits" stream-corruption flake this avoids.

// See the fixture file's own header comment for full provenance/citations -- Theengs
// Decoder has no built-in Kegtron device profile (verified 2026-07-28), so this fixture
// models Theengs' general MQTT envelope conventions + kegtron-ble's verified sensor key
// names as a documented best-effort inference, not a confirmed real payload.
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '../fixtures/kegtron/theengs-messages.jsonl',
);

function loadLines(): string[] {
  return readFileSync(FIXTURE_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

const LINES = loadLines();
const KT200_PORT0_FIRST = LINES[0]!;
const KT200_PORT0_SECOND = LINES[1]!;
const KT200_PORT1 = LINES[2]!;
const NON_KEGTRON = LINES[3]!;
const MALFORMED = LINES[4]!;
const KT100_ALIAS_KEYS = LINES[5]!;

let broker: Aedes;
let server: net.Server;
let brokerPort: number;
let bus: EventBus;
let events: { event: string; payload: any }[];
let settings: SettingsStore;
let source: Gen1MqttSource | null;
let publisher: MqttClient | null;

function byEvent(name: string): any[] {
  return events.filter((e) => e.event === name).map((e) => e.payload);
}

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

async function publish(topic: string, payload: string): Promise<void> {
  if (!publisher) {
    publisher = mqtt.connect(`mqtt://127.0.0.1:${brokerPort}`);
    await new Promise<void>((resolve, reject) => {
      publisher!.once('connect', () => resolve());
      publisher!.once('error', reject);
    });
  }
  await new Promise<void>((resolve, reject) => {
    publisher!.publish(topic, payload, (err) => (err ? reject(err) : resolve()));
  });
}

async function makeSource(
  opts: Partial<ConstructorParameters<typeof Gen1MqttSource>[0]> = {},
): Promise<Gen1MqttSource> {
  const src = new Gen1MqttSource({ bus, settings, ...opts });
  await src.start();
  return src;
}

beforeEach(async () => {
  await startBroker();
  bus = new EventBus();
  events = [];
  for (const name of ['volume_update', 'device_discovered', 'pour_completed', 'source_status'] as const) {
    bus.on(name, (payload) => events.push({ event: name, payload }));
  }
  settings = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
  source = null;
  publisher = null;
});

afterEach(async () => {
  if (source) await source.stop();
  if (publisher) {
    await new Promise<void>((resolve) => publisher!.end(true, {}, () => resolve()));
    publisher = null;
  }
  await stopBroker();
});

describe('Gen1MqttSource.start() with no settings.mqtt configured', () => {
  it('emits an unhealthy source_status and never attempts to connect', async () => {
    source = await makeSource();
    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'gen1_mqtt', healthy: false, detail: expect.stringContaining('not configured') }),
    ]);
    expect(byEvent('volume_update')).toHaveLength(0);
  });
});

describe('Gen1MqttSource full message flow against an aedes broker', () => {
  beforeEach(() => {
    settings.set('mqtt', {
      url: `mqtt://127.0.0.1:${brokerPort}`,
      gen1TopicPrefix: 'home/TheengsGateway',
      haPublishEnabled: false,
      haDiscoveryPrefix: 'homeassistant',
      appTopicPrefix: 'kegwall',
    });
  });

  it('publishing a fixture Theengs Kegtron message yields volume_update + one device_discovered', async () => {
    source = await makeSource();
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));

    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_FIRST);

    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));
    expect(byEvent('volume_update')[0]).toEqual({
      monitor: { type: 'kegtron_gen1', identifier: 'aa:bb:cc:11:22:33', portIndex: 0 },
      volStartMl: 5000,
      volDispensedMl: 1000,
      sizeMl: 18927,
      ts: expect.any(String),
    });
    expect(byEvent('device_discovered')).toHaveLength(1);
    expect(byEvent('device_discovered')[0]).toMatchObject({
      monitor: { type: 'kegtron_gen1', identifier: 'aa:bb:cc:11:22:33', portIndex: 0 },
    });
  });

  it('does not re-fire device_discovered for a second reading on the same MAC+port', async () => {
    source = await makeSource();
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));

    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_FIRST);
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));
    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_SECOND);
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(2));

    expect(byEvent('device_discovered')).toHaveLength(1);
    expect(byEvent('volume_update')[1]).toMatchObject({ volDispensedMl: 1355 });
  });

  it('treats a different port on the same MAC as a distinct monitor with its own device_discovered', async () => {
    source = await makeSource();
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));

    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_FIRST);
    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT1);
    await vi.waitFor(() => expect(byEvent('device_discovered')).toHaveLength(2));

    const ports = byEvent('device_discovered').map((d) => d.monitor.portIndex).sort();
    expect(ports).toEqual([0, 1]);
  });

  it('ignores a non-Kegtron Theengs message on the same topic tree', async () => {
    source = await makeSource();
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));

    await publish('home/TheengsGateway/BTtoMQTT/11:22:33:44:55:66', NON_KEGTRON);
    // Publish a real Kegtron message afterward to get a deterministic sync point.
    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_FIRST);
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));
    expect(byEvent('volume_update')[0].monitor.identifier).toBe('aa:bb:cc:11:22:33');
  });

  it('drops malformed JSON without crashing and keeps processing subsequent valid messages', async () => {
    source = await makeSource();
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));

    await publish('home/TheengsGateway/BTtoMQTT/garbage', MALFORMED);
    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_FIRST);
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));
  });

  it('parses the mL-named fallback alias keys (no liter conversion) for a KT-100 message', async () => {
    source = await makeSource();
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));

    await publish('home/TheengsGateway/BTtoMQTT/DE:AD:BE:EF:00:01', KT100_ALIAS_KEYS);
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));
    expect(byEvent('volume_update')[0]).toMatchObject({
      monitor: { type: 'kegtron_gen1', identifier: 'de:ad:be:ef:00:01', portIndex: 0 },
      volStartMl: 2000,
      volDispensedMl: 400,
      sizeMl: 9464,
    });
  });

  it('drops messages for a MAC recently/actively owned by the BLE source (dedupe via shared bleActiveMacs map)', async () => {
    // Final review I1: bleActiveMacs is now a Map<mac, lastSeenMs> (not a Set) so a
    // stale entry can expire -- a fresh timestamp (just seen) is still within the TTL.
    const bleActiveMacs = new Map<string, number>([['aa:bb:cc:11:22:33', Date.now()]]);
    source = await makeSource({ bleActiveMacs });
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));

    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_FIRST);
    // Give it a moment to (not) be processed, then prove the source is otherwise alive
    // by publishing a MAC that is NOT in the dedupe set.
    await publish('home/TheengsGateway/BTtoMQTT/DE:AD:BE:EF:00:01', KT100_ALIAS_KEYS);
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));
    expect(byEvent('volume_update')[0].monitor.identifier).toBe('de:ad:be:ef:00:01');
  });

  it('processes a message again once the BLE-seen entry has gone stale past the TTL '
    + '(Final review I1: a never-expiring bleActiveMacs entry permanently silenced the MQTT fallback)', async () => {
    const bleActiveMacs = new Map<string, number>([['aa:bb:cc:11:22:33', Date.now()]]);
    // Fast test-only TTL override (same additive-optional-constructor-knob precedent as
    // cloudSource.ts's reconnectBaseMs / pourSynth.ts's stabilizeMs) -- production
    // default stays the brief's 5 minutes.
    source = await makeSource({ bleActiveMacs, bleActiveTtlMs: 30 });
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));

    await new Promise((resolve) => setTimeout(resolve, 60)); // let the BLE-seen entry go stale
    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_FIRST);

    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));
    expect(byEvent('volume_update')[0].monitor.identifier).toBe('aa:bb:cc:11:22:33');
  });

  it('stop() disconnects cleanly and further publishes produce no more events', async () => {
    source = await makeSource();
    await vi.waitFor(() => expect(byEvent('source_status').some((s) => s.healthy)).toBe(true));
    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_FIRST);
    await vi.waitFor(() => expect(byEvent('volume_update')).toHaveLength(1));

    await source.stop();
    source = null;

    await publish('home/TheengsGateway/BTtoMQTT/AA:BB:CC:11:22:33', KT200_PORT0_SECOND);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(byEvent('volume_update')).toHaveLength(1); // unchanged
  });
});
