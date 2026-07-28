import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fake upstream server standing in for BOTH Open Brewery DB and Untappd (distinguished
// by path, exactly like the real APIs) plus a handful of "label image" endpoints for the
// Untappd import download tests — never call the real openbrewerydb.org/untappd.com from
// tests, per this repo's established convention (see mdashClient.test.ts / kegtron.test.ts).
const CLIENT_ID = 'untappd-client-id-8f3a';
const CLIENT_SECRET = 'untappd-client-secret-b91e';

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

let app: FastifyInstance;
let upstream: FastifyInstance;
let upstreamUrl: string;
let seenBreweryQuery: Record<string, unknown> | undefined;
let seenUntappdQuery: Record<string, unknown> | undefined;
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

  upstream.get('/v4/search/beer', async (req, reply) => {
    seenUntappdQuery = req.query as Record<string, unknown>;
    const q = (req.query as any).q;
    if (q === 'ServerError') {
      reply.code(500);
      return { error: 'boom' };
    }
    if (q === 'Timeout') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {};
    }
    return {
      response: {
        beers: {
          count: 1,
          items: [
            {
              checkin_count: 120,
              beer: {
                bid: 123,
                beer_name: 'Citra IPA',
                beer_label: `${upstreamUrl}/images/valid.png`,
                beer_abv: 6.5,
                beer_ibu: 60,
                beer_style: 'IPA - American',
              },
              brewery: { brewery_id: 456, brewery_name: 'Test Brewery' },
            },
          ],
        },
      },
    };
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
  seenUntappdQuery = undefined;
  upstreamUrl = await listenUpstream();

  // Short timeout override (a la wsPingIntervalMs/MdashClient.timeoutMs) so the timeout
  // tests below run in milliseconds instead of the real 5s production default.
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')), lookupTimeoutMs: 100 });
  app.ctx.settings.set('openBreweryBaseUrl', upstreamUrl);
  app.ctx.settings.set('untappdBaseUrl', upstreamUrl);

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
  it('exposes hidden openBreweryBaseUrl/untappdBaseUrl settings with real defaults', async () => {
    const fresh = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
    expect(fresh.ctx.settings.get('openBreweryBaseUrl')).toBe('https://api.openbrewerydb.org');
    expect(fresh.ctx.settings.get('untappdBaseUrl')).toBe('https://api.untappd.com');
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

describe('GET /api/lookup/untappd', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/lookup/untappd?q=Citra' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a viewer (needs editor role)', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/untappd?q=Citra', cookies: viewerCookies,
    });
    expect(res.statusCode).toBe(403);
  });

  it('501s with {error: "not_configured"} when Untappd creds are absent, even for an editor', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/untappd?q=Citra', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ error: 'not_configured', message: expect.any(String) });
  });

  it('maps results to {name, brewery, style, abv, ibu, labelUrl} when configured, sending creds as query params', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/untappd?q=Citra', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(200);
    expect(seenUntappdQuery?.client_id).toBe(CLIENT_ID);
    expect(seenUntappdQuery?.client_secret).toBe(CLIENT_SECRET);
    expect(seenUntappdQuery?.q).toBe('Citra');
    expect(res.json()).toEqual([{
      name: 'Citra IPA',
      brewery: 'Test Brewery',
      style: 'IPA - American',
      abv: 6.5,
      ibu: 60,
      labelUrl: `${upstreamUrl}/images/valid.png`,
    }]);
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
  });

  it('returns an empty array for a blank query without calling the upstream service (used to probe config status)', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/untappd?q=', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(seenUntappdQuery).toBeUndefined();
  });

  it('degrades gracefully (502) on an upstream error, never leaking creds in the error body', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/untappd?q=ServerError', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_ID);
  });

  it('degrades gracefully (502) on a timeout, never leaking creds', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const start = Date.now();
    const res = await app.inject({
      method: 'GET', url: '/api/lookup/untappd?q=Timeout', cookies: editorCookies,
    });
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(502);
    expect(elapsed).toBeLessThan(500);
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
  });
});

describe('POST /api/lookup/untappd/import', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/lookup/untappd/import', payload: { labelUrl: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a viewer (needs editor role)', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'POST', url: '/api/lookup/untappd/import', cookies: viewerCookies,
      payload: { labelUrl: `${upstreamUrl}/images/valid.png` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('501s when Untappd is not configured', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/lookup/untappd/import', cookies: editorCookies,
      payload: { labelUrl: `${upstreamUrl}/images/valid.png` },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toBe('not_configured');
  });

  it('downloads a valid label server-side and stores it under /labels, returning {path}', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'POST', url: '/api/lookup/untappd/import', cookies: editorCookies,
      payload: { labelUrl: `${upstreamUrl}/images/valid.png` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.path).toMatch(/^\/labels\/[0-9a-f-]+\.png$/);

    const fetched = await app.inject({ method: 'GET', url: body.path });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('400s for a malformed or non-http(s) labelUrl', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    for (const bad of ['not-a-url', 'ftp://example.com/x.png', 'file:///etc/passwd']) {
      const res = await app.inject({
        method: 'POST', url: '/api/lookup/untappd/import', cookies: editorCookies,
        payload: { labelUrl: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('400s when the downloaded content is not a supported image type, regardless of declared content-type', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'POST', url: '/api/lookup/untappd/import', cookies: editorCookies,
      payload: { labelUrl: `${upstreamUrl}/images/invalid.txt` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('413s when the downloaded label exceeds the 5MB cap', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'POST', url: '/api/lookup/untappd/import', cookies: editorCookies,
      payload: { labelUrl: `${upstreamUrl}/images/big.png` },
    });
    expect(res.statusCode).toBe(413);
  });

  it('502s when the upstream image host errors', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const res = await app.inject({
      method: 'POST', url: '/api/lookup/untappd/import', cookies: editorCookies,
      payload: { labelUrl: `${upstreamUrl}/images/error` },
    });
    expect(res.statusCode).toBe(502);
  });

  it('502s (fails closed within the timeout) when the download hangs', async () => {
    app.ctx.settings.set('untappd', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    const start = Date.now();
    const res = await app.inject({
      method: 'POST', url: '/api/lookup/untappd/import', cookies: editorCookies,
      payload: { labelUrl: `${upstreamUrl}/images/slow` },
    });
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(502);
    expect(elapsed).toBeLessThan(500);
  });
});
