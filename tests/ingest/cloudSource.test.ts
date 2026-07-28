import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import WebSocket, { WebSocketServer } from 'ws';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/server/db/db.js';
import { SettingsStore } from '../../src/server/db/settings.js';
import { EventBus } from '../../src/server/core/events.js';
import { KegtronCloudSource } from '../../src/server/ingest/kegtron/cloudSource.js';

// Same fixture shape used by shadow.test.ts (a JSON transcription of
// kegtron-pro.v2.yaml's GetDeviceShadow "Example KT-420" sample value) — device id
// 'device2', 4 ports, port0 volDisp=6934/lastServing=262 (used below to construct a
// WS 'updated' push that raises both, which is diffToEvents' pour_completed condition).
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '../fixtures/kegtron/device-shadow.json',
);
const shadowFixture: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

const API_KEY = 'customer-secret-8f3a1c';
const DEVICE_KEY = 'device-secret-b91e7d';

let app: FastifyInstance;
let wss: WebSocketServer;
let shadowRequestCount: number;
let seenServingsParams: unknown;
let serverSockets: WebSocket[];
let serverConnectionUrls: string[];
let settings: SettingsStore;
let bus: EventBus;
let events: { event: string; payload: any }[];
let source: KegtronCloudSource | null;

// Fast test-only backoff/poll overrides (see mdashClient.ts's timeoutMs precedent,
// task-3-report.md "Deviations") — production defaults stay 1s->60s / 5 min.
const FAST_OPTS = { reconnectBaseMs: 5, reconnectCapMs: 20, pollIntervalMs: 100_000 };

async function listenHttp(): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

function listenWs(): Promise<string> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (ws, req) => {
      serverSockets.push(ws);
      serverConnectionUrls.push(req.url ?? '');
    });
    wss.on('listening', () => {
      const address = wss.address() as { port: number };
      resolve(`ws://127.0.0.1:${address.port}`);
    });
  });
}

function registerHttpRoutes(): void {
  app.get('/customer', async () => {
    return { pubkeys: { [DEVICE_KEY]: {} } };
  });
  app.get('/api/v2/m/device', async () => {
    shadowRequestCount++;
    return shadowFixture;
  });
  app.post('/api/v2/m/device/data/servings-device', async (req) => {
    seenServingsParams = req.body;
    return {
      rows: [
        ['2026-07-20T21:05:00Z', '2026-07-20T14:05:00', "Moe's Tavern", 'device2', 0, 200, 7134, 88.0, 'King Cobra', 4000],
        ['2026-07-21T10:00:00Z', '2026-07-21T03:00:00', "Moe's Tavern", 'device2', 2, 355, 11005, 62.5, 'Schlitz', null],
      ],
    };
  });
}

function byEvent(name: string): any[] {
  return events.filter((e) => e.event === name).map((e) => e.payload);
}

let wsBaseUrl: string;

beforeEach(async () => {
  app = Fastify();
  serverSockets = [];
  serverConnectionUrls = [];
  shadowRequestCount = 0;
  seenServingsParams = undefined;
  registerHttpRoutes();
  wsBaseUrl = await listenWs();

  bus = new EventBus();
  events = [];
  for (const name of [
    'volume_update', 'pour_completed', 'telemetry', 'device_discovered',
    'device_online', 'device_offline', 'source_status',
  ] as const) {
    bus.on(name, (payload) => events.push({ event: name, payload }));
  }

  settings = new SettingsStore(openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))));
  source = null;
});

afterEach(async () => {
  if (source) await source.stop();
  await app.close();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

describe('KegtronCloudSource.start() with no API key', () => {
  it('emits an unhealthy source_status and returns without contacting mdash', async () => {
    source = new KegtronCloudSource({ bus, settings, baseUrl: 'http://127.0.0.1:1', ...FAST_OPTS });
    await source.start();

    expect(byEvent('source_status')).toEqual([
      expect.objectContaining({ source: 'kegtron_cloud', healthy: false, detail: 'no API key configured' }),
    ]);
    expect(shadowRequestCount).toBe(0);
  });
});

describe('KegtronCloudSource discovery flow', () => {
  it('goes customer -> shadow -> bus events, includes deviceKey in device_discovered meta, backfills servings, and reports healthy', async () => {
    settings.set('kegtronApiKey', API_KEY);
    const baseUrl = await listenHttp();

    source = new KegtronCloudSource({ bus, settings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();

    const discovered = byEvent('device_discovered');
    expect(discovered).toHaveLength(4);
    for (const d of discovered) {
      expect(d.meta).toMatchObject({ deviceKey: DEVICE_KEY });
      expect(d.monitor.type).toBe('kegtron_pro');
      expect(d.monitor.identifier).toBe('device2');
    }

    expect(byEvent('volume_update')).toHaveLength(4);
    expect(byEvent('telemetry')).toHaveLength(1);

    // WS connection was opened with the device key as access_token.
    await vi.waitFor(() => expect(serverConnectionUrls).toHaveLength(1));
    expect(serverConnectionUrls[0]).toContain('/api/v2/m/device/notify');
    expect(serverConnectionUrls[0]).toContain(`access_token=${DEVICE_KEY}`);

    // Servings backfill fires after the first successful WS connect.
    await vi.waitFor(() => expect(byEvent('pour_completed')).toHaveLength(2));
    const pours = byEvent('pour_completed');
    expect(pours).toEqual(expect.arrayContaining([
      expect.objectContaining({
        monitor: { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 },
        volumeMl: 200, durationMs: 4000, source: 'cloud', ts: '2026-07-20T21:05:00Z',
      }),
      expect.objectContaining({
        monitor: { type: 'kegtron_pro', identifier: 'device2', portIndex: 2 },
        volumeMl: 355, durationMs: null, source: 'cloud', ts: '2026-07-21T10:00:00Z',
      }),
    ]));
    expect(seenServingsParams).toMatchObject({ params: [expect.any(String), 'now'] });

    await vi.waitFor(() => {
      const statuses = byEvent('source_status');
      expect(statuses.some((s) => s.healthy === true && s.detail.includes('1/1'))).toBe(true);
    });
  });
});

describe('KegtronCloudSource WS push', () => {
  it('merges an "updated" notify message into the cached shadow and emits pour_completed', async () => {
    settings.set('kegtronApiKey', API_KEY);
    const baseUrl = await listenHttp();
    source = new KegtronCloudSource({ bus, settings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await vi.waitFor(() => expect(serverSockets).toHaveLength(1));
    // Let the post-connect servings backfill (2 rows, see registerHttpRoutes) settle
    // first so it doesn't get conflated with the pour_completed asserted below.
    await vi.waitFor(() => expect(byEvent('pour_completed')).toHaveLength(2));

    const volumeUpdatesBeforePush = byEvent('volume_update').length;
    const serverSocket = serverSockets[0]!;
    serverSocket.send(JSON.stringify({
      name: 'updated',
      id: 'device2',
      data: {
        shadow: {
          state: {
            reported: {
              config_readonly: {
                port0: { lastServing: 999, volDisp: 7407, pulseCnt: 3823 },
              },
            },
          },
        },
      },
    }));

    await vi.waitFor(() => expect(byEvent('pour_completed')).toHaveLength(3));
    const pushedPour = byEvent('pour_completed').find((p) => p.volumeMl === 999);
    expect(pushedPour).toMatchObject({
      monitor: { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 },
      volumeMl: 999,
      source: 'cloud',
    });

    // Only port0 (whose volDisp changed) got a fresh volume_update from the merge; ports
    // untouched by the partial `data` patch produced no new event.
    const newVolumeUpdates = byEvent('volume_update').slice(volumeUpdatesBeforePush);
    expect(newVolumeUpdates).toHaveLength(1);
    expect(newVolumeUpdates[0]!.monitor.portIndex).toBe(0);
  });

  it('emits device_offline then device_online for every port on offline/online notifications', async () => {
    settings.set('kegtronApiKey', API_KEY);
    const baseUrl = await listenHttp();
    source = new KegtronCloudSource({ bus, settings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await vi.waitFor(() => expect(serverSockets).toHaveLength(1));

    const serverSocket = serverSockets[0]!;
    serverSocket.send(JSON.stringify({ name: 'offline', id: 'device2' }));
    await vi.waitFor(() => expect(byEvent('device_offline')).toHaveLength(4));
    expect(byEvent('device_offline').map((e) => e.monitor.portIndex).sort()).toEqual([0, 1, 2, 3]);

    serverSocket.send(JSON.stringify({ name: 'online', id: 'device2' }));
    await vi.waitFor(() => expect(byEvent('device_online')).toHaveLength(4));
  });
});

describe('KegtronCloudSource reconnect', () => {
  it('reconnects with a new WS connection and re-GETs the shadow after a drop', async () => {
    settings.set('kegtronApiKey', API_KEY);
    const baseUrl = await listenHttp();
    source = new KegtronCloudSource({ bus, settings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await vi.waitFor(() => expect(serverSockets).toHaveLength(1));
    const requestsBeforeDrop = shadowRequestCount;

    serverSockets[0]!.close();

    await vi.waitFor(() => expect(serverSockets).toHaveLength(2), { timeout: 3000 });
    await vi.waitFor(() => expect(shadowRequestCount).toBeGreaterThan(requestsBeforeDrop), { timeout: 3000 });
  });
});

describe('KegtronCloudSource.stop()', () => {
  it('closes all sockets and cancels timers, leaving no reconnect attempts afterwards', async () => {
    settings.set('kegtronApiKey', API_KEY);
    const baseUrl = await listenHttp();
    source = new KegtronCloudSource({ bus, settings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await vi.waitFor(() => expect(serverSockets).toHaveLength(1));

    await source.stop();
    await vi.waitFor(() => expect(wss.clients.size).toBe(0));

    const connectionsAtStop = serverConnectionUrls.length;
    // Give any (incorrectly still-scheduled) reconnect timer a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(serverConnectionUrls.length).toBe(connectionsAtStop);

    source = null; // already stopped; afterEach should not double-stop problematically
  });
});
