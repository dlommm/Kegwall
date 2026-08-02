import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
let url: string;

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  await app.listen({ port: 0 });
  const address = app.server.address() as { port: number };
  url = `ws://127.0.0.1:${address.port}/ws`;
});
afterEach(async () => { await app.close(); });

// Track messages per socket with a persistent listener to handle multiple frames
// arriving in a single TCP read (ws.once() loses frames in this case).
const messageQueues = new Map<WebSocket, any[]>();
const pendingResolvers = new Map<WebSocket, ((msg: any) => void)[]>();

function trackMessages(ws: WebSocket): void {
  if (messageQueues.has(ws)) return; // already tracking
  messageQueues.set(ws, []);
  pendingResolvers.set(ws, []);

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const queue = messageQueues.get(ws)!;
    const resolvers = pendingResolvers.get(ws)!;

    if (resolvers.length > 0) {
      resolvers.shift()!(msg);
    } else {
      queue.push(msg);
    }
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  trackMessages(ws);
  return new Promise((resolve) => {
    const queue = messageQueues.get(ws)!;
    if (queue.length > 0) {
      resolve(queue.shift()!);
    } else {
      pendingResolvers.get(ws)!.push(resolve);
    }
  });
}

describe('/ws', () => {
  it('sends a snapshot on connect', async () => {
    const ws = new WebSocket(url);
    const msg = await nextMessage(ws);
    expect(msg.type).toBe('snapshot');
    expect(Array.isArray(msg.taps)).toBe(true);
    ws.close();
  });

  it('broadcasts on state_changed', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws); // initial snapshot
    const next = nextMessage(ws);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    const msg = await next;
    expect(msg.type).toBe('snapshot');
    ws.close();
  });

  // Phase 3 final review, finding I1: an idle taproom (no pours, cloud source only pushes
  // on change) never gets a `state_changed` event, so without a heartbeat the client's
  // 60s staleness timer trips on a perfectly healthy socket. `wsPingIntervalMs` overrides
  // the production 30s interval so this test doesn't have to wait 30s for real.
  it('sends a ping heartbeat to open clients on an interval, independent of state_changed', async () => {
    await app.close();
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')), wsPingIntervalMs: 20 });
    await app.listen({ port: 0 });
    const address = app.server.address() as { port: number };
    url = `ws://127.0.0.1:${address.port}/ws`;

    const ws = new WebSocket(url);
    await nextMessage(ws); // initial snapshot
    const msg = await nextMessage(ws); // the heartbeat, unprompted by any state change
    expect(msg.type).toBe('ping');
    expect(typeof msg.ts).toBe('string');
    ws.close();
  });

  it('pings every connected client, not just the first to connect', async () => {
    await app.close();
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')), wsPingIntervalMs: 20 });
    await app.listen({ port: 0 });
    const address = app.server.address() as { port: number };
    url = `ws://127.0.0.1:${address.port}/ws`;

    const wsA = new WebSocket(url);
    const wsB = new WebSocket(url);
    await nextMessage(wsA);
    await nextMessage(wsB);

    const [msgA, msgB] = await Promise.all([nextMessage(wsA), nextMessage(wsB)]);
    expect(msgA.type).toBe('ping');
    expect(msgB.type).toBe('ping');
    wsA.close();
    wsB.close();
  });

  // Phase 5 Task 4: wall_banner/wall_theme_override bus events (emitted by the automation
  // engine's wall_banner/party_mode actions -- see automation/engine.ts) relay over WS to
  // ALL connected clients, unconditionally (unlike state_changed's scope check).
  it('relays a wall_banner bus event as {type:"banner", ...} to all clients', async () => {
    const wsA = new WebSocket(url);
    const wsB = new WebSocket(url);
    await nextMessage(wsA);
    await nextMessage(wsB);

    const [msgA, msgB] = await Promise.all([
      nextMessage(wsA), nextMessage(wsB),
      (async () => {
        app.ctx.bus.emit('wall_banner', { text: 'Free pours at 6pm', kind: 'celebrate', durationMs: 5000 });
      })(),
    ]);
    expect(msgA).toEqual({
      type: 'banner', text: 'Free pours at 6pm', kind: 'celebrate', durationMs: 5000,
    });
    expect(msgB).toEqual(msgA);
    wsA.close();
    wsB.close();
  });

  it('relays a wall_banner event with no durationMs (omitted, not null)', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws);
    const next = nextMessage(ws);
    app.ctx.bus.emit('wall_banner', { text: 'Hello', kind: 'info' });
    const msg = await next;
    expect(msg).toEqual({ type: 'banner', text: 'Hello', kind: 'info' });
    ws.close();
  });

  it('relays a wall_theme_override bus event as {type:"theme_override", minutes}', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws);
    const next = nextMessage(ws);
    app.ctx.bus.emit('wall_theme_override', { minutes: 10 });
    const msg = await next;
    expect(msg).toEqual({ type: 'theme_override', minutes: 10 });
    ws.close();
  });

  it('relays a state_changed(scope:"notifications") event as {type:"notifications", unackedCount}', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws);
    const next = nextMessage(ws);
    app.ctx.bus.emit('state_changed', { scope: 'notifications', ts: new Date().toISOString() });
    const msg = await next;
    expect(msg).toEqual({ type: 'notifications', unackedCount: 0 });
    ws.close();
  });

  it('relays a state_changed(scope:"walls") event as {type:"walls_changed"}', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws);
    const next = nextMessage(ws);
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    const msg = await next;
    expect(msg).toEqual({ type: 'walls_changed' });
    ws.close();
  });

  it('relays a state_changed(scope:"faces") event as {type:"faces_changed"}', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws);
    const next = nextMessage(ws);
    app.ctx.bus.emit('state_changed', { scope: 'faces', ts: new Date().toISOString() });
    const msg = await next;
    expect(msg).toEqual({ type: 'faces_changed' });
    ws.close();
  });

  it('a state_changed(scope:"sources") event does not broadcast anything (ignored, same as before)', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws);
    let gotExtra = false;
    ws.on('message', () => { gotExtra = true; });
    app.ctx.bus.emit('state_changed', { scope: 'sources', ts: new Date().toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gotExtra).toBe(false);
    ws.close();
  });

  it('stops the ping interval when the app closes (no dangling timer)', async () => {
    // Regression guard (Phase 6 flake sweep, Phase 3 ledger hygiene nit): this test used
    // to reassign `app` to a freshly-built instance without closing the beforeEach-built
    // one first, leaking a live FastifyInstance + listening socket on every run. Close it
    // explicitly (and prove it actually closed) before replacing the binding.
    const beforeEachApp = app;
    await expect(beforeEachApp.close()).resolves.toBeUndefined();
    expect(beforeEachApp.server.listening).toBe(false);

    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')), wsPingIntervalMs: 20 });
    await app.listen({ port: 0 });
    // Regression guard: closing must not throw, and must actually clear the interval —
    // if it leaked, the still-running interval would keep the process alive / keep
    // touching a closed socket set on the next tick.
    await expect(app.close()).resolves.toBeUndefined();
    // Rebuild so the shared afterEach's app.close() has a live app to close.
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
    await app.listen({ port: 0 });
  });
});

describe('display_power relay', () => {
  it('replays each zone state after the connect snapshot', async () => {
    app.ctx.db.prepare('INSERT INTO walls (slug, name, config) VALUES (?, ?, ?)')
      .run('main', 'Main', JSON.stringify({}));
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    const ws = new WebSocket(url);
    await nextMessage(ws); // snapshot
    const msg = await nextMessage(ws);
    expect(msg).toMatchObject({ type: 'display_power', wallSlug: 'main', state: 'active' });
    ws.close();
  });

  it('broadcasts display_power_changed transitions', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws); // snapshot (no walls ⇒ no replay frames)
    const next = nextMessage(ws);
    app.ctx.bus.emit('display_power_changed', {
      wallId: 1, wallSlug: 'main', state: 'off', ts: new Date().toISOString(),
    });
    const msg = await next;
    expect(msg).toMatchObject({ type: 'display_power', wallSlug: 'main', state: 'off' });
    ws.close();
  });
});

// Displays & Presence hub Task 3: motion_detected relay — mirrors display_power_changed's
// broadcast-to-everyone shape (no per-wall routing at the WS layer).
describe('motion relay', () => {
  it('relays a motion_detected bus event as {type:"motion", sourceId, wallSlug, ts}', async () => {
    const ws = new WebSocket(url);
    await nextMessage(ws); // snapshot
    const next = nextMessage(ws);
    const ts = new Date().toISOString();
    app.ctx.bus.emit('motion_detected', { wallSlug: 'main', source: 'mqtt', sourceId: 'abc', ts });
    const msg = await next;
    expect(msg).toEqual({ type: 'motion', sourceId: 'abc', wallSlug: 'main', ts });
    ws.close();
  });
});
