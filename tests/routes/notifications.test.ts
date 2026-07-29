import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertNotification } from '../../src/server/db/notificationsRepo.js';

// ---------------------------------------------------------------------------
// Phase 5 Task 6: the notification center's REST surface. `db/notificationsRepo.ts`
// (Task 1) shipped list/ack/ackAll/unackedCount; nothing exposed them over HTTP until
// this task. Every route -- INCLUDING the two ack endpoints -- is `viewer` role: see the
// plan's own framing ("viewer can ack; their own view state is global -- acceptable,
// note it") and this route module's doc comment.
// ---------------------------------------------------------------------------

let app: FastifyInstance;
let adminCookies: { session: string };
let viewerCookies: { session: string };

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  adminCookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };

  await app.inject({
    method: 'POST', url: '/api/users', cookies: adminCookies,
    payload: {
      username: 'vw', displayName: 'Vw', password: 'password1', role: 'viewer',
    },
  });
  const viewerLogin = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'vw', password: 'password1' },
  });
  viewerCookies = { session: viewerLogin.cookies.find((c: any) => c.name === 'session')!.value };
});

afterEach(async () => { await app.close(); });

describe('GET /api/notifications', () => {
  it('lists notifications newest-first, viewer role', async () => {
    insertNotification(app.ctx.db, { title: 'First', severity: 'info' });
    insertNotification(app.ctx.db, { title: 'Second', severity: 'warning' });

    const res = await app.inject({ method: 'GET', url: '/api/notifications', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].title).toBe('Second');
    expect(body[1].title).toBe('First');
  });

  it('paginates via limit/before', async () => {
    for (let i = 0; i < 5; i += 1) insertNotification(app.ctx.db, { title: `N${i}`, severity: 'info' });

    const page1 = await app.inject({ method: 'GET', url: '/api/notifications?limit=2', cookies: viewerCookies });
    expect(page1.json()).toHaveLength(2);
    const lastId = page1.json()[1].id;

    const page2 = await app.inject({
      method: 'GET', url: `/api/notifications?limit=2&before=${lastId}`, cookies: viewerCookies,
    });
    expect(page2.json()).toHaveLength(2);
    expect(page2.json()[0].id).toBeLessThan(lastId);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/notifications/unacked-count', () => {
  it('reports the current unacked count', async () => {
    insertNotification(app.ctx.db, { title: 'A', severity: 'info' });
    insertNotification(app.ctx.db, { title: 'B', severity: 'info' });

    const res = await app.inject({ method: 'GET', url: '/api/notifications/unacked-count', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ count: 2 });
  });
});

describe('POST /api/notifications/:id/ack', () => {
  it('acks a single notification (viewer role) and emits state_changed', async () => {
    const n = insertNotification(app.ctx.db, { title: 'A', severity: 'info' });
    const events: unknown[] = [];
    app.ctx.bus.on('state_changed', (e) => events.push(e));

    const res = await app.inject({ method: 'POST', url: `/api/notifications/${n.id}/ack`, cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().acked).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ scope: 'notifications' }));

    const count = await app.inject({ method: 'GET', url: '/api/notifications/unacked-count', cookies: viewerCookies });
    expect(count.json()).toEqual({ count: 0 });
  });

  it('404s for an unknown id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/notifications/999999/ack', cookies: viewerCookies });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/notifications/ack-all', () => {
  it('acks every unacked notification (viewer role) and reports the count affected', async () => {
    insertNotification(app.ctx.db, { title: 'A', severity: 'info' });
    insertNotification(app.ctx.db, { title: 'B', severity: 'info' });

    const res = await app.inject({ method: 'POST', url: '/api/notifications/ack-all', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ count: 2 });

    const count = await app.inject({ method: 'GET', url: '/api/notifications/unacked-count', cookies: viewerCookies });
    expect(count.json()).toEqual({ count: 0 });
  });
});
