import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// POST /api/channels/:name/test (admin role): builds a test message and sends it via the
// named `alertChannels` config, returning {ok} or {ok:false, message} -- errors are
// humanized here (never a raw sender error / secret / URL leaked to the client).

let app: FastifyInstance;
let upstream: FastifyInstance;
let upstreamUrl: string;
let ntfyRequests: number;
let ntfyShouldFail: boolean;
let adminCookies: { session: string };
let editorCookies: { session: string };
let viewerCookies: { session: string };

async function listenUpstream(): Promise<string> {
  const fake = Fastify();
  fake.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  fake.post('/:topic', async (_req, reply) => {
    ntfyRequests += 1;
    if (ntfyShouldFail) {
      reply.code(500);
      return { error: 'boom' };
    }
    return { ok: true };
  });
  await fake.listen({ port: 0, host: '127.0.0.1' });
  upstream = fake;
  const address = fake.server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  ntfyRequests = 0;
  ntfyShouldFail = false;
  upstreamUrl = await listenUpstream();

  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });

  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  adminCookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };

  await app.inject({
    method: 'POST', url: '/api/users', cookies: adminCookies,
    payload: { username: 'ed', displayName: 'Ed', password: 'password1', role: 'editor' },
  });
  const editorLogin = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'ed', password: 'password1' },
  });
  editorCookies = { session: editorLogin.cookies.find((c: any) => c.name === 'session')!.value };

  await app.inject({
    method: 'POST', url: '/api/users', cookies: adminCookies,
    payload: { username: 'vw', displayName: 'Vw', password: 'password1', role: 'viewer' },
  });
  const viewerLogin = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'vw', password: 'password1' },
  });
  viewerCookies = { session: viewerLogin.cookies.find((c: any) => c.name === 'session')!.value };
});

afterEach(async () => {
  await app.close();
  await upstream.close();
});

describe('POST /api/channels/:name/test', () => {
  it('requires admin role -- viewer gets 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/channels/ntfy/test', cookies: viewerCookies,
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires admin role -- editor gets 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/channels/ntfy/test', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication -- no cookie gets 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/channels/ntfy/test' });
    expect(res.statusCode).toBe(401);
  });

  it('404s for an unknown channel name', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/channels/carrier-pigeon/test', cookies: adminCookies,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns {ok:false, message} when the channel is not configured yet', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/channels/ntfy/test', cookies: adminCookies,
    });
    expect(res.json()).toMatchObject({ ok: false });
    expect(res.json().message).toBeTruthy();
  });

  it('sends a real test message and returns {ok:true} when the channel is configured and reachable', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { alertChannels: { ntfy: { serverUrl: upstreamUrl, topic: 'test-topic' } } },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/channels/ntfy/test', cookies: adminCookies,
    });
    expect(res.json()).toEqual({ ok: true });
    expect(ntfyRequests).toBe(1);
  });

  it('returns a humanized {ok:false, message} without leaking the server URL when sending fails', async () => {
    ntfyShouldFail = true;
    await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { alertChannels: { ntfy: { serverUrl: upstreamUrl, topic: 'secret-topic-name' } } },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/channels/ntfy/test', cookies: adminCookies,
    });
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toContain(upstreamUrl);
    expect(body.message).not.toContain('secret-topic-name');
  });

  it('returns {ok:false} without leaking the pushover token when misconfigured', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: {
        alertChannels: {
          pushover: { token: 'super-secret-app-token', user: 'super-secret-user-key' },
        },
      },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/channels/pushover/test', cookies: adminCookies,
    });
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain('super-secret-app-token');
    expect(JSON.stringify(body)).not.toContain('super-secret-user-key');
  });
});
