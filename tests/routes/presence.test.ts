import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
let adminCookies: { session: string };

// Task 3: the same admin-session pattern crud.test.ts uses (POST /api/auth/setup
// creates the first admin user and returns a session cookie) — shared by every admin-
// gated presence route test below.
function injectAsAdmin(opts: InjectOptions) {
  return app.inject({ ...opts, cookies: adminCookies });
}

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  app.ctx.db.prepare('INSERT INTO walls (slug, name, config) VALUES (?, ?, ?)')
    .run('main', 'Main', JSON.stringify({}));
  app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  const c = setup.cookies.find((c: any) => c.name === 'session')!;
  adminCookies = { session: c.value };
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

  // Final-review I2: a camera wake for a REAL, currently-configured wall still routes
  // through the registry's `camera:<slug>` sentinel (`trigger()`) -- its derived Motion
  // sources row keeps getting a real, bounded `lastTriggeredAt` stamp.
  it('a camera wake for a real, configured wall stamps that wall\'s camera sentinel status', async () => {
    expect(app.ctx.motion.statusOf('camera:main').lastTriggeredAt).toBeNull();
    const res = await app.inject({
      method: 'POST', url: '/api/presence/wake', payload: { wall: 'main', source: 'camera' },
    });
    expect(res.statusCode).toBe(200);
    expect(app.ctx.motion.statusOf('camera:main').lastTriggeredAt).not.toBeNull();
  });

  // Final-review I2: a camera wake carrying a wall string that ISN'T a real, configured
  // wall (arbitrary client-controlled public input) used to route through `trigger()`
  // regardless, stamping the registry's in-memory status Map keyed by that raw garbage
  // string forever -- unbounded growth from anyone who can POST here. It must now bypass
  // the registry sentinel entirely for a wall `presence.stateOf()` doesn't recognize.
  it('a camera wake for an unrecognized wall does not stamp any registry status entry for it', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/presence/wake',
      payload: { wall: 'not-a-real-wall-xyz', source: 'camera' },
    });
    expect(res.statusCode).toBe(200);
    expect(app.ctx.motion.statusOf('camera:not-a-real-wall-xyz').lastTriggeredAt).toBeNull();
  });

  // Final-review I2: a wall-less camera wake (no `wall` at all) must still wake every
  // zone AND tag the resulting `motion_detected` event's source as 'camera' -- the
  // PREVIOUS `trigger(wall ? ... : null)` fallback routed this through `trigger(null)`,
  // which mislabels the event source as 'webhook' instead of the genuine 'camera' wake it
  // actually was.
  it('a wall-less camera wake wakes every zone and tags motion_detected with source "camera"', async () => {
    app.ctx.presence.setState('main', 'off');
    const events: { wallSlug: string | null; source: string }[] = [];
    app.ctx.bus.on('motion_detected', (e) => events.push(e));
    const res = await app.inject({
      method: 'POST', url: '/api/presence/wake', payload: { source: 'camera' },
    });
    expect(res.statusCode).toBe(200);
    expect(app.ctx.presence.stateOf('main')).toBe('active');
    expect(events.at(-1)).toMatchObject({ wallSlug: null, source: 'camera' });
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

  // Review F2: an open stream must not outlive app.close() -- its bus subscription, ping
  // timer, and underlying keep-alive socket all have to be reaped, not just abandoned.
  // Deliberately does NOT cancel the reader first (unlike the test above) -- that's
  // exactly the scenario the review's live probe caught hanging: app.close() waiting
  // forever on a still-open SSE connection nothing ever told to close.
  it('reaps an open SSE stream on app.close() (no dangling socket/timer/subscription)', async () => {
    app.ctx.settings.set('presenceWebhookToken', 'sekret');
    await app.listen({ port: 0 });
    const { port } = app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/presence/stream?wall=main&token=sekret`);
    const reader = res.body!.getReader();
    await reader.read(); // consume the initial replay frame; connection stays open

    await expect(app.close()).resolves.toBeUndefined();

    // The client side must also observe the stream end -- otherwise app.close() merely
    // orphaned the connection instead of actually closing it.
    const result = await reader.read().catch(() => ({ done: true, value: undefined }));
    expect(result.done).toBe(true);

    // Rebuild so the shared afterEach's app.close() has a live app to close (same
    // pattern as ws.test.ts's "stops the ping interval when the app closes" guard).
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  });
});

// Task 3: sources CRUD/status routes, webhook attribution, admin state.
describe('presence sources admin routes', () => {
  it('CRUD round-trip with generated ids and 401 unauthenticated', async () => {
    expect((await app.inject({ url: '/api/presence/sources' })).statusCode).toBe(401);
    const created = await injectAsAdmin({
      method: 'POST', url: '/api/presence/sources',
      payload: {
        name: 'Kitchen PIR', type: 'mqtt', enabled: true, wallSlug: 'main',
        config: { topic: 'home/pir', match: { mode: 'any' } },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(typeof id).toBe('string');
    const list = await injectAsAdmin({ url: '/api/presence/sources' });
    expect(list.json().sources).toHaveLength(1);
    await injectAsAdmin({ method: 'PATCH', url: `/api/presence/sources/${id}`, payload: { enabled: false } });
    await injectAsAdmin({ method: 'DELETE', url: `/api/presence/sources/${id}` });
    expect((await injectAsAdmin({ url: '/api/presence/sources' })).json().sources).toHaveLength(0);
  });

  it('webhook ?source= stamps the source and unknown ids still wake', async () => {
    app.ctx.settings.set('presenceWebhookToken', 't');
    const created = await injectAsAdmin({
      method: 'POST', url: '/api/presence/sources',
      payload: {
        name: 'Kitchen PIR', type: 'mqtt', enabled: true, wallSlug: 'main',
        config: { topic: 'home/pir', match: { mode: 'any' } },
      },
    });
    const id = created.json().id;
    await app.inject({ method: 'POST', url: `/api/presence/motion?token=t&source=${id}`, payload: {} });
    const list = await injectAsAdmin({ url: '/api/presence/sources' });
    expect(list.json().sources[0].status.lastTriggeredAt).not.toBeNull();
    app.ctx.presence.setState('main', 'off');
    await app.inject({ method: 'POST', url: '/api/presence/motion?token=t&source=ghost', payload: {} });
    expect(app.ctx.presence.stateOf('main')).toBe('active'); // unknown id still wakes
  });

  // Final-review C2: GET /api/presence/sources used to read the enabled-only
  // `snapshot()`, so disabling a source (its own PATCH) made it vanish from the ONLY
  // admin surface that could ever re-enable it. It now reads `snapshotAll()`.
  it('a disabled source still lists (final-review C2)', async () => {
    const created = await injectAsAdmin({
      method: 'POST', url: '/api/presence/sources',
      payload: {
        name: 'Kitchen PIR', type: 'mqtt', enabled: true, wallSlug: 'main',
        config: { topic: 'home/pir', match: { mode: 'any' } },
      },
    });
    const id = created.json().id;
    await injectAsAdmin({ method: 'PATCH', url: `/api/presence/sources/${id}`, payload: { enabled: false } });
    const list = await injectAsAdmin({ url: '/api/presence/sources' });
    expect(list.json().sources).toHaveLength(1);
    expect(list.json().sources[0].source).toMatchObject({ id, enabled: false });
  });

  // Final-review I1: a PATCH body carrying its own `id` must never override the path id
  // — the path id always wins, so a source can't be silently reassigned to a different
  // row's identity.
  it('a PATCH body id is ignored -- the path id wins (final-review I1)', async () => {
    const created = await injectAsAdmin({
      method: 'POST', url: '/api/presence/sources',
      payload: {
        name: 'Kitchen PIR', type: 'mqtt', enabled: true, wallSlug: 'main',
        config: { topic: 'home/pir', match: { mode: 'any' } },
      },
    });
    const id = created.json().id;
    const patched = await injectAsAdmin({
      method: 'PATCH', url: `/api/presence/sources/${id}`,
      payload: { id: 'attacker-supplied-id', name: 'Kitchen PIR v2' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().id).toBe(id);
    const list = await injectAsAdmin({ url: '/api/presence/sources' });
    expect(list.json().sources.map((s: any) => s.source.id)).toEqual([id]);
  });

  it('PATCH an unknown source id 404s', async () => {
    const res = await injectAsAdmin({
      method: 'PATCH', url: '/api/presence/sources/ghost-id', payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE an unknown source id is idempotent (204, no error)', async () => {
    const res = await injectAsAdmin({ method: 'DELETE', url: '/api/presence/sources/ghost-id' });
    expect(res.statusCode).toBe(204);
  });

  // Final-review M2: a deleted source's in-memory runtime status must not linger in the
  // registry forever -- re-creating a DIFFERENT source later must not somehow inherit a
  // stale status a previous, now-gone source left behind.
  it('deleting a source drops its runtime status too (final-review M2)', async () => {
    app.ctx.settings.set('presenceWebhookToken', 't');
    const created = await injectAsAdmin({
      method: 'POST', url: '/api/presence/sources',
      payload: {
        name: 'Kitchen PIR', type: 'mqtt', enabled: true, wallSlug: 'main',
        config: { topic: 'home/pir', match: { mode: 'any' } },
      },
    });
    const id = created.json().id;
    await app.inject({ method: 'POST', url: `/api/presence/motion?token=t&source=${id}`, payload: {} });
    expect(app.ctx.motion.statusOf(id).lastTriggeredAt).not.toBeNull();

    await injectAsAdmin({ method: 'DELETE', url: `/api/presence/sources/${id}` });
    expect(app.ctx.motion.statusOf(id).lastTriggeredAt).toBeNull();
  });

  it('POST /api/presence/state is admin-only and sets state', async () => {
    expect((await app.inject({
      method: 'POST', url: '/api/presence/state',
      payload: { wall: 'main', state: 'off' },
    })).statusCode).toBe(401);
    await injectAsAdmin({
      method: 'POST', url: '/api/presence/state',
      payload: { wall: 'main', state: 'off' },
    });
    expect(app.ctx.presence.stateOf('main')).toBe('off');
  });
});
