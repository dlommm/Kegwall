import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';
import { Aedes } from 'aedes';
import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { MqttSender } from '../../src/server/notify/mqttSender.js';

// Real local aedes MQTT broker -- same fake-upstream-real-protocol pattern as
// tests/ingest/mqttSource.test.ts (this repo's established precedent for testing
// anything mqtt.js-based), rather than mocking the `mqtt` package.

const MQTT_DEFAULTS = {
  gen1TopicPrefix: 'home/TheengsGateway',
  haPublishEnabled: false,
  haDiscoveryPrefix: 'homeassistant',
  appTopicPrefix: 'kegwall',
  motionTopics: [],
};

let broker: Aedes;
let server: net.Server;
let brokerPort: number;
let settings: SettingsStore;
let subscriber: MqttClient | null;
let received: { topic: string; payload: string }[];

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
  subscriber.on('message', (topic, payload) => received.push({ topic, payload: payload.toString('utf8') }));
}

beforeEach(async () => {
  await startBroker();
  settings = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
  settings.set('mqtt', { ...MQTT_DEFAULTS, url: `mqtt://127.0.0.1:${brokerPort}` });
  await subscribeAll();
});

afterEach(async () => {
  if (subscriber) {
    await new Promise<void>((resolve) => subscriber!.end(true, {}, () => resolve()));
    subscriber = null;
  }
  await stopBroker();
});

describe('MqttSender', () => {
  it('publishes a topic/payload to the configured broker', async () => {
    const sender = new MqttSender(settings);
    try {
      await sender.publish('kegwall/event/pour', '{"volume_ml":355}');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(received).toContainEqual({ topic: 'kegwall/event/pour', payload: '{"volume_ml":355}' });
    } finally {
      await sender.close();
    }
  });

  it('reuses the same connection across multiple publishes (connect on demand once)', async () => {
    const connectFn = vi.fn((url: string, opts?: IClientOptions) => mqtt.connect(url, opts));
    const sender = new MqttSender(settings, { connectFn });
    try {
      await sender.publish('a/topic', '1');
      await sender.publish('a/topic', '2');
      await sender.publish('a/topic', '3');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(received.filter((r) => r.topic === 'a/topic')).toHaveLength(3);
      expect(connectFn).toHaveBeenCalledTimes(1);
    } finally {
      await sender.close();
    }
  });

  it('throws a clear error when mqtt is not configured', async () => {
    const emptySettings = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
    const sender = new MqttSender(emptySettings, { backoffMs: [], sleep: () => Promise.resolve() });
    await expect(sender.publish('a/b', 'x')).rejects.toThrow(/not configured/i);
  });

  it('redaction: a connection failure never leaks the broker address', async () => {
    const badSettings = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
    badSettings.set('mqtt', { ...MQTT_DEFAULTS, url: 'mqtt://127.0.0.1:1' }); // nothing listens on :1
    const sender = new MqttSender(badSettings, {
      timeoutMs: 300, backoffMs: [], sleep: () => Promise.resolve(),
    });
    let msg = '';
    try {
      await sender.publish('a/b', 'x');
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg).not.toContain('127.0.0.1');
    expect(msg).toMatch(/mqtt/i);
  });

  it('retries and succeeds once the broker becomes reachable', async () => {
    // Point at a port nothing is listening on yet, then bring a broker up on that exact
    // port before the retry loop's final attempt.
    const freeSettings = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
    // Grab an ephemeral port and immediately release it by closing this probe server,
    // then start a second aedes broker on that same port for the sender to eventually
    // reach on a retry.
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, resolve));
    const freePort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    freeSettings.set('mqtt', { ...MQTT_DEFAULTS, url: `mqtt://127.0.0.1:${freePort}` });
    // Real (unfaked) backoff delays here, deliberately -- this test needs actual wall-clock
    // spacing between attempts so the second broker (started 30ms in, below) has time to
    // come up before a later retry reaches it.
    const sender = new MqttSender(freeSettings, { timeoutMs: 500, backoffMs: [50, 150] });

    let secondBroker: Aedes | undefined;
    let secondServer: net.Server | undefined;
    const publishPromise = sender.publish('retry/topic', 'payload');
    // Bring the broker up shortly after the first connect attempt has had a chance to fail.
    setTimeout(async () => {
      secondBroker = await Aedes.createBroker();
      secondServer = net.createServer(secondBroker.handle);
      secondServer.listen(freePort);
    }, 30);

    try {
      await publishPromise;
    } finally {
      await sender.close();
      if (secondServer) await new Promise<void>((resolve) => secondServer!.close(() => resolve()));
      if (secondBroker) await new Promise<void>((resolve) => secondBroker!.close(() => resolve()));
    }
  });

  it('close() ends the underlying client cleanly (idempotent, no-op when never connected)', async () => {
    const sender = new MqttSender(settings);
    await expect(sender.close()).resolves.toBeUndefined();
    await sender.publish('x/y', 'z');
    await expect(sender.close()).resolves.toBeUndefined();
    await expect(sender.close()).resolves.toBeUndefined(); // idempotent second close
  });
});
