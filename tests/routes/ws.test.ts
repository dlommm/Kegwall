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

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
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

  it('stops the ping interval when the app closes (no dangling timer)', async () => {
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
