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
});
