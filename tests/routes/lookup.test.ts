import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { downloadAndStoreLabel } from '../../src/server/routes/lookup.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

// Fake upstream server standing in for Open Brewery DB, plus a handful of "label image"
// endpoints used directly (unit-style, no route/auth involved) by `downloadAndStoreLabel`'s
// own test coverage below — never call the real openbrewerydb.org from tests, per this
// repo's established convention (see mdashClient.test.ts / kegtron.test.ts).
//
// The Untappd search/import integration this file originally also covered (GET
// /api/lookup/untappd, POST /api/lookup/untappd/import) was removed entirely — Untappd
// stopped granting new developer API credentials, making the feature unusable for any new
// install (see CHANGELOG). `downloadAndStoreLabel` survives that removal unchanged: its
// only caller now is `routes/kegtron.ts`'s Pro import (covered by its own tests in
// kegtron.test.ts), but its full behavior — malformed input, the SSRF guard, oversized/
// malformed downloads, upstream failures — is exercised once here, directly against the
// exported function, rather than through a route.

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

let app: FastifyInstance;
let upstream: FastifyInstance;
let upstreamUrl: string;
let seenBreweryQuery: Record<string, unknown> | undefined;
let adminCookies: { session: string };
let editorCookies: { session: string };
let viewerCookies: { session: string };

async function listenUpstream(): Promise<string> {
  upstream = Fastify();

  upstream.get('/v1/breweries/search', async (req, reply) => {
    seenBreweryQuery = req.query as Record<string, unknown>;
    const q = (req.query as any).query;
    if (q === 'ServerError') {
      reply.code(500);
      return { error: 'boom' };
    }
    if (q === 'Timeout') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return [];
    }
    if (q === 'Legacy') {
      return [{ name: 'Old Guard Brewing', city: 'Millbrook', state: 'New York' }];
    }
    if (q === 'NoName') {
      return [{ name: '', city: 'Nowhere', state: 'XX' }];
    }
    if (q === 'BadJson') {
      reply.header('content-type', 'application/json');
      return reply.send('{not valid json');
    }
    return [
      { id: 'abc', name: 'Modern Brew Co', brewery_type: 'micro', city: 'Portland', state_province: 'Oregon' },
    ];
  });

  upstream.get('/images/valid.png', async (_req, reply) => {
    reply.header('content-type', 'image/png');
    return PNG_BYTES;
  });

  upstream.get('/images/invalid.txt', async (_req, reply) => {
    reply.header('content-type', 'image/png'); // lies about the type; magic bytes decide
    return Buffer.from('not actually an image, just text pretending');
  });

  upstream.get('/images/big.png', async (_req, reply) => {
    reply.header('content-type', 'image/png');
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(6 * 1024 * 1024, 1),
    ]);
  });

  upstream.get('/images/error', async (_req, reply) => {
    reply.code(500);
    return { error: 'boom' };
  });

  upstream.get('/images/slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return PNG_BYTES;
  });

  await upstream.listen({ port: 0, host: '127.0.0.1' });
  const address = upstream.server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  seenBreweryQuery = undefined;
  upstreamUrl = await listenUpstream();

  // Short timeout override (a la wsPingIntervalMs/MdashClient.timeoutMs) so the timeout
  // test below runs in milliseconds instead of the real 5s production default.
  app = await buildApp({
    dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')),
    lookupTimeoutMs: 100,
  });
  app.ctx.settings.set('openBreweryBaseUrl', upstreamUrl);

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

describe('settings schema', () => {
  it('exposes a hidden openBreweryBaseUrl setting with its real default', async () => {
    const fresh = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
    expect(fresh.ctx.settings.get('openBreweryBaseUrl')).toBe('https://api.openbrewerydb.org');
    await fresh.close();
  });
});

describe('GET /api/lookup/breweries', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/lookup/breweries?q=Modern' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a viewer (needs editor role)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/breweries?q=Modern', cookies: viewerCookies,
    });
    expect(res.statusCode).toBe(403);
  });

  it('maps results to {name, city, state} for an editor', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/breweries?q=Modern', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(200);
    expect(seenBreweryQuery?.query).toBe('Modern');
    expect(res.json()).toEqual([{ name: 'Modern Brew Co', city: 'Portland', state: 'Oregon' }]);
  });

  it('falls back to a legacy "state" field when state_province is absent', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/breweries?q=Legacy', cookies: editorCookies,
    });
    expect(res.json()).toEqual([{ name: 'Old Guard Brewing', city: 'Millbrook', state: 'New York' }]);
  });

  it('drops rows with no name', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/breweries?q=NoName', cookies: editorCookies,
    });
    expect(res.json()).toEqual([]);
  });

  it('returns an empty array for a blank query without calling the upstream service', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/breweries?q=', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(seenBreweryQuery).toBeUndefined();
  });

  it('degrades gracefully (502, no raw upstream body) when the upstream service errors', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/breweries?q=ServerError', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream_error');
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });

  it('degrades gracefully (502) when the upstream service exceeds the timeout', async () => {
    const start = Date.now();
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/breweries?q=Timeout', cookies: editorCookies,
    });
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(502);
    expect(elapsed).toBeLessThan(500);
  });

  it('degrades gracefully (502, not a raw 500) when the upstream service returns malformed JSON', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/breweries?q=BadJson', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream_error');
  });
});

// ---------------------------------------------------------------------------
// downloadAndStoreLabel — the generic remote label download helper (SSRF-guarded
// download -> size-capped read -> magic-byte validation -> stored under labelsDir). Its
// only production caller today is routes/kegtron.ts's Pro import (see kegtron.test.ts for
// that integration), so it's exercised directly here rather than through a route.
// ---------------------------------------------------------------------------
describe('downloadAndStoreLabel', () => {
  let labelsDir: string;

  beforeEach(() => {
    labelsDir = mkdtempSync(join(tmpdir(), 'ktdash-labels-'));
  });

  it('downloads a valid label and stores it under labelsDir, returning {ok:true, path}', async () => {
    const result = await downloadAndStoreLabel(labelsDir, `${upstreamUrl}/images/valid.png`, {
      timeoutMs: 1000, allowInsecureHosts: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.path).toMatch(/^\/labels\/[0-9a-f-]+\.png$/);
    const stored = readFileSync(join(labelsDir, basename(result.path)));
    expect(stored.equals(PNG_BYTES)).toBe(true);
  });

  it('400s for a malformed or non-http(s) rawUrl', async () => {
    for (const bad of ['not-a-url', 'ftp://example.com/x.png', 'file:///etc/passwd']) {
      const result = await downloadAndStoreLabel(labelsDir, bad, { timeoutMs: 1000, allowInsecureHosts: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
  });

  it('400s when the downloaded content is not a supported image type, regardless of declared content-type', async () => {
    const result = await downloadAndStoreLabel(labelsDir, `${upstreamUrl}/images/invalid.txt`, {
      timeoutMs: 1000, allowInsecureHosts: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('413s when the downloaded label exceeds the 5MB cap', async () => {
    const result = await downloadAndStoreLabel(labelsDir, `${upstreamUrl}/images/big.png`, {
      timeoutMs: 1000, allowInsecureHosts: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it('502s when the upstream image host errors', async () => {
    const result = await downloadAndStoreLabel(labelsDir, `${upstreamUrl}/images/error`, {
      timeoutMs: 1000, allowInsecureHosts: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
  });

  it('502s (fails closed within the timeout) when the download hangs', async () => {
    const start = Date.now();
    const result = await downloadAndStoreLabel(labelsDir, `${upstreamUrl}/images/slow`, {
      timeoutMs: 100, allowInsecureHosts: true,
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
    expect(elapsed).toBeLessThan(500);
  });

  // ---------------------------------------------------------------------------
  // SSRF guard: `downloadAndStoreLabel` reaches a real server-side fetch against a
  // caller-supplied URL, so it's the one place in the app where a user-supplied (or
  // device-derived, via routes/kegtron.ts's labelUrl decode) host could make the SERVER
  // probe internal services / cloud metadata on someone's behalf. Every test below calls
  // the function with NO `allowInsecureHosts` override — i.e. the real, strict,
  // production default.
  // ---------------------------------------------------------------------------
  describe('SSRF guard', () => {
    // Set by whichever test needs it — a stand-in DNS resolver so these tests never
    // touch real DNS.
    let resolveHost: ((hostname: string) => Promise<string[]>) | undefined;

    beforeEach(() => {
      resolveHost = undefined;
    });

    it.each([
      ['http://127.0.0.1/label.png', 'loopback IPv4'],
      ['http://192.168.1.1/label.png', 'private IPv4 (192.168/16)'],
      ['http://169.254.169.254/latest/meta-data/', 'link-local IPv4 (cloud metadata)'],
      ['http://10.0.0.5/label.png', 'private IPv4 (10/8)'],
      ['http://172.16.0.1/label.png', 'private IPv4 (172.16/12)'],
      ['http://0.0.0.0/label.png', 'unspecified IPv4'],
      ['http://[::1]/label.png', 'loopback IPv6'],
      ['http://[fe80::1]/label.png', 'link-local IPv6'],
      ['http://[fc00::1]/label.png', 'unique-local IPv6'],
    ])('rejects a literal %s (%s) with a 400, without ever attempting a fetch', async (rawUrl) => {
      const start = Date.now();
      const result = await downloadAndStoreLabel(labelsDir, rawUrl, { timeoutMs: 1000 });
      const elapsed = Date.now() - start;
      expect(result).toEqual({
        ok: false, status: 400, error: 'validation', message: 'That image URL is not allowed',
      });
      // Fast — proves this was rejected synchronously by the guard, not after a real
      // connection attempt/timeout to an unroutable address like 169.254.169.254.
      expect(elapsed).toBeLessThan(90);
    });

    it('rejects a hostname that resolves (per the injected resolver) to a private address', async () => {
      resolveHost = async (hostname) => {
        expect(hostname).toBe('internal.example.test');
        return ['10.1.2.3'];
      };
      const result = await downloadAndStoreLabel(labelsDir, 'http://internal.example.test/label.png', {
        timeoutMs: 1000, resolveHost: (h) => resolveHost!(h),
      });
      expect(result).toEqual({
        ok: false, status: 400, error: 'validation', message: 'That image URL is not allowed',
      });
    });

    it('rejects a hostname if ANY of its resolved addresses is private, even if another is public', async () => {
      resolveHost = async () => ['8.8.8.8', '10.1.2.3'];
      const result = await downloadAndStoreLabel(labelsDir, 'http://multi-homed.example.test/label.png', {
        timeoutMs: 1000, resolveHost: (h) => resolveHost!(h),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it('allows a hostname that resolves to a public address through to the real fetch', async () => {
      // "localhost" is used as the hostname so the REAL fetch() call (which does its own,
      // un-injected DNS resolution) connects to our loopback-bound fake server below — the
      // injected resolver below only feeds the GUARD's own check, standing in for
      // whatever real public address a real hostname would resolve to.
      resolveHost = async (hostname) => {
        expect(hostname).toBe('localhost');
        return ['8.8.8.8'];
      };
      const fakeLabelServer = Fastify();
      fakeLabelServer.get('/label.png', async (_req, reply) => {
        reply.header('content-type', 'image/png');
        return PNG_BYTES;
      });
      await fakeLabelServer.listen({ port: 0, host: '127.0.0.1' });
      const port = (fakeLabelServer.server.address() as { port: number }).port;

      try {
        const result = await downloadAndStoreLabel(labelsDir, `http://localhost:${port}/label.png`, {
          timeoutMs: 1000, resolveHost: (h) => resolveHost!(h),
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.path).toMatch(/^\/labels\/[0-9a-f-]+\.png$/);
      } finally {
        await fakeLabelServer.close();
      }
    });

    it('refuses to follow a redirect — a validated host cannot be used to reach a different one via a 302', async () => {
      // The guard only validates the ORIGINAL host (here, "localhost", made to look
      // public via the injected resolver, same trick as the previous test) — this test's
      // point is that the redirect target ("the second server") must never be reached at
      // all, regardless of what it is, because `redirect: 'error'` refuses to follow it.
      resolveHost = async (hostname) => {
        expect(hostname).toBe('localhost');
        return ['8.8.8.8'];
      };

      let secondServerHits = 0;
      const secondServer = Fastify();
      secondServer.get('/private-secret.png', async (_req, reply) => {
        secondServerHits += 1;
        reply.header('content-type', 'image/png');
        return PNG_BYTES;
      });
      await secondServer.listen({ port: 0, host: '127.0.0.1' });
      const secondPort = (secondServer.server.address() as { port: number }).port;

      const redirectingServer = Fastify();
      redirectingServer.get('/label.png', async (_req, reply) => {
        reply.code(302).header('location', `http://localhost:${secondPort}/private-secret.png`).send();
      });
      await redirectingServer.listen({ port: 0, host: '127.0.0.1' });
      const redirectingPort = (redirectingServer.server.address() as { port: number }).port;

      try {
        const result = await downloadAndStoreLabel(labelsDir, `http://localhost:${redirectingPort}/label.png`, {
          timeoutMs: 1000, resolveHost: (h) => resolveHost!(h),
        });
        expect(result).toEqual({
          ok: false, status: 400, error: 'validation',
          message: 'That image URL redirects somewhere else. Use the direct image URL.',
        });
        expect(secondServerHits).toBe(0);
      } finally {
        await redirectingServer.close();
        await secondServer.close();
      }
    });

    it('fails closed (400) when the hostname cannot be resolved at all', async () => {
      resolveHost = async () => {
        throw new Error('ENOTFOUND');
      };
      const result = await downloadAndStoreLabel(labelsDir, 'http://does-not-resolve.example.test/label.png', {
        timeoutMs: 1000, resolveHost: (h) => resolveHost!(h),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });
  });
});
