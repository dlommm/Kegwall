import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  app.ctx.db.prepare('INSERT INTO walls (slug, name, config) VALUES (?, ?, ?)')
    .run('main', 'Main', JSON.stringify({}));
  app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
});
afterEach(async () => { await app.close(); });

describe('POST /api/presence/motion', () => {
  it('503s when no token is configured', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/presence/motion?token=x' });
    expect(res.statusCode).toBe(503);
  });
  it('401s on a wrong token, wakes on the right one', async () => {
    app.ctx.settings.set('presenceWebhookToken', 'sekret');
    expect((await app.inject({ method: 'POST', url: '/api/presence/motion?token=nope' })).statusCode).toBe(401);
    app.ctx.presence.setState('main', 'off');
    const ok = await app.inject({
      method: 'POST', url: '/api/presence/motion?token=sekret', payload: { wall: 'main' },
    });
    expect(ok.statusCode).toBe(200);
    expect(app.ctx.presence.stateOf('main')).toBe('active');
  });
});

describe('POST /api/presence/wake', () => {
  it('wakes without a token', async () => {
    app.ctx.presence.setState('main', 'screensaver');
    const res = await app.inject({
      method: 'POST', url: '/api/presence/wake', payload: { wall: 'main', source: 'touch' },
    });
    expect(res.statusCode).toBe(200);
    expect(app.ctx.presence.stateOf('main')).toBe('active');
  });
});

describe('GET /api/presence/stream', () => {
  it('replays current state then pushes transitions', async () => {
    app.ctx.settings.set('presenceWebhookToken', 'sekret');
    await app.listen({ port: 0 });
    const { port } = app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/presence/stream?wall=main&token=sekret`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain('"state":"active"');
    app.ctx.presence.setState('main', 'off');
    const second = decoder.decode((await reader.read()).value);
    expect(second).toContain('"state":"off"');
    await reader.cancel();
  });
  it('401s on bad token and 404s on unknown wall', async () => {
    app.ctx.settings.set('presenceWebhookToken', 'sekret');
    expect((await app.inject({ url: '/api/presence/stream?wall=main&token=bad' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/presence/stream?wall=ghost&token=sekret' })).statusCode).toBe(404);
  });
});
