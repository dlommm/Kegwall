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
import { StateManager } from '../../src/server/core/state.js';
import { KegtronCloudSource } from '../../src/server/ingest/kegtron/cloudSource.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg } from '../../src/server/db/kegs.js';

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

const DEFAULT_SERVINGS_ROWS = [
  ['2026-07-20T21:05:00Z', '2026-07-20T14:05:00', "Moe's Tavern", 'device2', 0, 200, 7134, 88.0, 'King Cobra', 4000],
  ['2026-07-21T10:00:00Z', '2026-07-21T03:00:00', "Moe's Tavern", 'device2', 2, 355, 11005, 62.5, 'Schlitz', null],
];

let app: FastifyInstance;
let wss: WebSocketServer;
let shadowRequestCount: number;
let seenServingsParams: unknown;
let serverSockets: WebSocket[];
let serverConnectionUrls: string[];
// Live-diagnosed bug fix regression coverage: mdash.net's real WS handshake 403s with NO
// `Origin` header (Kegtron's own Node example works around this by passing `{ origin: url
// }` to the `ws` client — see docs/kegtron/Notify.md's Examples section, and
// cloudSource.ts's `openWs`). This fake server doesn't reject a missing Origin (that would
// turn every OTHER test in this file red too, since they all share this same `wss`) — it
// just records what each handshake actually carried, so one dedicated test below can
// assert the real value without disturbing the rest of the suite.
let serverConnectionOrigins: (string | undefined)[];
let settings: SettingsStore;
let bus: EventBus;
let events: { event: string; payload: any }[];
let source: KegtronCloudSource | null;
// Overridable per-test (see e.g. the backfill-retry test below) — reassigning this after
// the route is already registered still works, since the route handler reads it lazily
// on each incoming request rather than capturing it once at registration time.
let servingsHandler: (req: any, reply: any) => unknown | Promise<unknown>;
// Overridable per-test, same lazy-read contract as servingsHandler above: when set, the
// shadow GET route awaits it before responding — lets the stale-poll-guard test below
// hold a poll's GET open while newer WS state lands during the await.
let shadowGate: Promise<void> | null;

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
      serverConnectionOrigins.push(req.headers.origin);
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
    if (shadowGate) await shadowGate;
    return shadowFixture;
  });
  app.post('/api/v2/m/device/data/servings-device', async (req, reply) => {
    seenServingsParams = req.body;
    return servingsHandler(req, reply);
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
  serverConnectionOrigins = [];
  shadowRequestCount = 0;
  seenServingsParams = undefined;
  servingsHandler = async () => ({ rows: DEFAULT_SERVINGS_ROWS });
  shadowGate = null;
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
  // Phase 6 flake sweep (phase5 ledger T0, "cloudSource WS-teardown flake seen once under
  // load"): `wss.close()` on a WebSocketServer that owns its own internal HTTP server (no
  // `server`/`noServer` option, as here) only waits on the underlying http.Server's own
  // connection tracking -- once a connection is upgraded to a WebSocket, Node detaches it
  // from that tracking, so `wss.close()`'s callback can fire while server-side WebSocket
  // handles (`serverSockets`, pushed by `listenWs()`'s 'connection' handler above) are
  // still open. `KegtronCloudSource.stop()` does call `ws.terminate()` client-side, but
  // that's a fire-and-forget close (no confirmation awaited) -- explicitly terminating
  // every server-side socket captured this test closes the race window instead of relying
  // on the client-side terminate()'s asynchronous propagation beating the next test's
  // beforeEach. Safe to call on an already-closed socket (no-op).
  for (const ws of serverSockets) ws.terminate();
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

  // Live-diagnosed tonight against real mdash.net: it 403s the notify WS handshake when no
  // `Origin` header is present. Kegtron's own Node.js example (docs/kegtron/Notify.md)
  // works around this by passing `{ origin: url }` to the `ws` client constructor — a bare
  // `new WebSocket(url)` (no origin option) sends no Origin header at all, so every real
  // device connection 403s and the source degrades to 5-min polling ("all N device
  // connections down"). This fake server doesn't reject a missing Origin itself (see
  // `serverConnectionOrigins`'s doc comment above), so this test is a direct, isolated
  // assertion on what the client actually sent — RED without the `{ origin: url }` fix in
  // cloudSource.ts's `openWs`, GREEN with it.
  it('opens the notify WebSocket with an Origin header (mdash.net 403s the handshake without one)', async () => {
    settings.set('kegtronApiKey', API_KEY);
    const baseUrl = await listenHttp();

    source = new KegtronCloudSource({ bus, settings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();

    await vi.waitFor(() => expect(serverConnectionOrigins).toHaveLength(1));
    expect(serverConnectionOrigins[0]).toBeTruthy();
    // Matches Kegtron's own example exactly: `origin` is set to the full notify URL
    // itself (not just a scheme+host), same value serverConnectionUrls[0] captures as the
    // request path/query.
    expect(serverConnectionOrigins[0]).toContain('/api/v2/m/device/notify');
    expect(serverConnectionOrigins[0]).toContain(`access_token=${DEVICE_KEY}`);
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

describe('KegtronCloudSource backfill retry (Fix round 1)', () => {
  it('retries a failed first-connect backfill on the next reconnect, and emits the pours exactly once', async () => {
    settings.set('kegtronApiKey', API_KEY);
    let servingsAttempts = 0;
    servingsHandler = async (_req, reply) => {
      servingsAttempts++;
      if (servingsAttempts === 1) {
        reply.code(503);
        return { error: 'temporarily unavailable' };
      }
      return { rows: DEFAULT_SERVINGS_ROWS };
    };
    const baseUrl = await listenHttp();
    source = new KegtronCloudSource({ bus, settings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await vi.waitFor(() => expect(serverSockets).toHaveLength(1));

    // First backfill attempt (triggered by the initial WS open) fails — asserted via the
    // attempt counter rather than a fixed delay, since the failure is itself async.
    await vi.waitFor(() => expect(servingsAttempts).toBe(1));
    // Give the failed attempt's promise a tick to fully unwind (clear backfillInFlight)
    // before forcing the reconnect that should retry it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(byEvent('pour_completed')).toHaveLength(0);

    // Force a WS drop + reconnect — the retry path.
    serverSockets[0]!.close();
    await vi.waitFor(() => expect(serverSockets).toHaveLength(2), { timeout: 3000 });

    // Second backfill attempt (triggered by the reconnect's WS open) succeeds.
    await vi.waitFor(() => expect(servingsAttempts).toBe(2), { timeout: 3000 });
    await vi.waitFor(() => expect(byEvent('pour_completed')).toHaveLength(2), { timeout: 3000 });

    // Give any further (incorrect) reconnect/backfill activity a chance to fire, then
    // confirm the pours were emitted exactly once — no duplicate/overlapping backfill.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(servingsAttempts).toBe(2);
    expect(byEvent('pour_completed')).toHaveLength(2);
  });
});

describe('KegtronCloudSource backfill cursor persistence (Final review C1)', () => {
  it('persists a per-device backfill high-water mark so pours are not duplicated when a '
    + 'fresh source (same settings/db) reconnects after a restart', async () => {
    const baseUrl = await listenHttp();
    const db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
    const localSettings = new SettingsStore(db);
    localSettings.set('kegtronApiKey', API_KEY);
    const localBus = new EventBus();
    const state = new StateManager(db, localBus);
    state.start();

    // Pre-wire a monitor/tap/keg for device2 port0 BEFORE the source ever starts, so
    // the first backfill's pour is actually recorded into `pours` via StateManager
    // (cloud's own device_discovered later just upserts the same row, idempotently).
    const monitor = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 });
    const beer = createBeer(db, { name: 'Pils' });
    const tap = createTap(db, { number: 1 });
    createKeg(db, { beerId: beer.id, sizeMl: 19700, volStartMl: 19700, tapId: tap.id });
    bindMonitorToTap(db, monitor.id, tap.id);

    // A single historical serving well inside the 7-day backfill window relative to
    // real "now" (avoids depending on the shared fixture's fixed 2026-07-20/21 dates
    // vs. whatever the real system clock happens to be at test-run time). This mock
    // servings endpoint HONORS the `start` param -- unlike the shared `beforeEach`'s
    // handler, which ignores it -- because proving the fix means proving the query
    // itself narrows on the second run, not just that an event count happens to match.
    const historicalTs = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    servingsHandler = async (req: any) => {
      const start = req.body.params[0] as string;
      const startMs = Date.parse(start.replace(' ', 'T') + 'Z');
      const rows = Date.parse(historicalTs) >= startMs
        ? [[historicalTs, '', "Moe's Tavern", 'device2', 0, 200, 7134, 88.0, 'King Cobra', 4000]]
        : [];
      return { rows };
    };

    const pourCount = () => (db.prepare('SELECT COUNT(*) c FROM pours').get() as { c: number }).c;

    source = new KegtronCloudSource({ bus: localBus, settings: localSettings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await vi.waitFor(() => expect(pourCount()).toBe(1));
    // The cursor was persisted to settings, keyed by the mdash device id.
    expect(Object.keys(localSettings.get('backfillCursors'))).toEqual(['device2']);

    await source.stop();

    // Fresh source instance -- same settings/db, simulating a process restart or a
    // source-relevant settings PATCH (bootstrap.ts tears down and rebuilds every
    // source from scratch; see registerConfiguredSources' header comment).
    source = new KegtronCloudSource({ bus: localBus, settings: localSettings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    // Give the second backfill a full chance to run and (incorrectly, pre-fix) emit +
    // record a duplicate.
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Unchanged -- the persisted cursor pushed `start` in the second backfill's request
    // past the already-imported historical row, so the start-respecting mock returned
    // no rows for it.
    expect(pourCount()).toBe(1);
  });
});

describe('KegtronCloudSource backfill vs live-recorded pours', () => {
  it('a restart backfill does not re-record a pour the live feed already recorded after the cursor', async () => {
    const baseUrl = await listenHttp();
    const db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
    const localSettings = new SettingsStore(db);
    localSettings.set('kegtronApiKey', API_KEY);
    const localBus = new EventBus();
    const state = new StateManager(db, localBus);
    state.start();
    const monitor = upsertMonitor(db, { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 });
    const beer = createBeer(db, { name: 'Pils' });
    const tap = createTap(db, { number: 1 });
    createKeg(db, { beerId: beer.id, sizeMl: 19700, volStartMl: 19700, tapId: tap.id });
    bindMonitorToTap(db, monitor.id, tap.id);
    const pourCount = () => (db.prepare('SELECT COUNT(*) c FROM pours').get() as { c: number }).c;

    // First run: nothing historical; the backfill just sets the cursor to "now".
    let liveRow: unknown[] | null = null;
    servingsHandler = async (req: any) => {
      const start = req.body.params[0] as string;
      const startMs = Date.parse(start.replace(' ', 'T') + 'Z');
      return { rows: liveRow && Date.parse(liveRow[0] as string) >= startMs ? [liveRow] : [] };
    };
    source = new KegtronCloudSource({ bus: localBus, settings: localSettings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await vi.waitFor(() => expect(Object.keys(localSettings.get('backfillCursors'))).toEqual(['device2']));

    // Later, a pour arrives LIVE (WS shadow diff / UDP) and is recorded.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const liveTs = new Date().toISOString();
    localBus.emit('pour_completed', {
      monitor: { type: 'kegtron_pro', identifier: 'device2', portIndex: 0 },
      volumeMl: 200, durationMs: 4000, source: 'cloud', ts: liveTs,
    });
    expect(pourCount()).toBe(1);
    liveRow = [liveTs, '', "Moe's Tavern", 'device2', 0, 200, 7134, 88.0, 'King Cobra', 4000];
    await source.stop();

    // Process restart: fresh bus + StateManager (so a fresh in-memory deduper), same DB.
    // mdash now reports that same serving.
    const restartBus = new EventBus();
    new StateManager(db, restartBus).start();
    source = new KegtronCloudSource({ bus: restartBus, settings: localSettings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(pourCount()).toBe(1);
  });
});

describe('KegtronCloudSource stale poll guard', () => {
  it('discards an in-flight poll result once a WS "updated" applied newer state — the same pour is never re-emitted', async () => {
    settings.set('kegtronApiKey', API_KEY);
    const baseUrl = await listenHttp();
    source = new KegtronCloudSource({ bus, settings, baseUrl, wsBaseUrl, ...FAST_OPTS });
    await source.start();
    await vi.waitFor(() => expect(serverSockets).toHaveLength(1));
    // Let the post-connect servings backfill (2 rows) settle first so the counts below
    // are unambiguous — same isolation move as the WS-push test above.
    await vi.waitFor(() => expect(byEvent('pour_completed')).toHaveLength(2));

    // Hold the NEXT shadow GET open, then kick a poll directly. (openWs's 'open' handler
    // clears the poll TIMER, but a tick whose GET is already awaiting can't be cancelled
    // — that in-flight await racing a WS 'updated' is exactly the bug under test.)
    let releaseShadow!: () => void;
    shadowGate = new Promise((resolve) => { releaseShadow = resolve; });
    const deviceState = (source as any).devices.get(DEVICE_KEY);
    const pollPromise = (source as any).pollShadowOnce(deviceState) as Promise<void>;
    await vi.waitFor(() => expect(shadowRequestCount).toBeGreaterThan(1)); // GET is in flight

    // While the poll's GET hangs, a WS 'updated' raises port0 — the pour emits once.
    const updated = JSON.stringify({
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
    });
    serverSockets[0]!.send(updated);
    await vi.waitFor(() => expect(byEvent('pour_completed')).toHaveLength(3));

    // The poll's (older, pre-pour) response finally lands — it must be discarded.
    releaseShadow();
    await pollPromise;

    // Re-delivering the SAME update must diff as a no-op. Pre-fix, the stale poll had
    // rewound the cached shadow to its pre-pour snapshot, so this re-diffed the raise
    // and re-emitted an already-reported pour_completed.
    serverSockets[0]!.send(updated);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(byEvent('pour_completed')).toHaveLength(3);
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
