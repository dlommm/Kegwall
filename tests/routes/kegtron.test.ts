import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Same fixture used by shadow.test.ts / cloudSource.test.ts — a JSON transcription of
// kegtron-pro.v2.yaml's GetDeviceShadow "Example KT-420" sample value. port0's config
// carries userName 'King Cobra' / maker 'Anheuser-Busch' / style 'Malt Liquor' / abv 6 /
// ibu 11 / srm 4 — used below to assert the imported beer's fields.
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '../fixtures/kegtron/device-shadow.json',
);
const shadowFixture: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

const DEVICE_KEY = 'device-secret-b91e7d';

let app: FastifyInstance;
let mdash: FastifyInstance;
let adminCookies: { session: string };
let editorCookies: { session: string };
let viewerCookies: { session: string };

// Fake mdash.net server (never call the real mdash.net from tests, per this repo's
// established convention — see mdashClient.test.ts / cloudSource.test.ts).
let shadowResponse: unknown;
let seenShadowToken: unknown;
let rpcStatus: number;
let seenRpcToken: unknown;
let seenRpcBody: unknown;
let seenRpcPath: string | undefined;

async function listenMdash(): Promise<string> {
  mdash = Fastify();
  mdash.get('/api/v2/m/device', async (req) => {
    seenShadowToken = (req.query as Record<string, string>).access_token;
    return shadowResponse;
  });
  mdash.post('/api/v2/m/device/rpc/Kegtron.ResetVolume', async (req, reply) => {
    seenRpcToken = (req.query as Record<string, string>).access_token;
    seenRpcBody = req.body;
    seenRpcPath = req.url.split('?')[0];
    if (rpcStatus !== 200) {
      reply.code(rpcStatus);
      return { error: 'device offline' };
    }
    return true;
  });
  await mdash.listen({ port: 0, host: '127.0.0.1' });
  const address = mdash.server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

async function createMonitor(
  type: 'kegtron_pro' | 'kegtron_gen1', identifier: string, portIndex: number,
  meta: Record<string, unknown>,
): Promise<number> {
  app.ctx.bus.emit('device_discovered', {
    monitor: { type, identifier, portIndex },
    serial: identifier,
    meta,
  });
  const list = await app.inject({ method: 'GET', url: '/api/monitors', cookies: adminCookies });
  const found = (list.json() as any[]).find(
    (m) => m.type === type && m.identifier === identifier && m.portIndex === portIndex,
  );
  return found.id;
}

beforeEach(async () => {
  shadowResponse = shadowFixture;
  seenShadowToken = undefined;
  rpcStatus = 200;
  seenRpcToken = undefined;
  seenRpcBody = undefined;
  seenRpcPath = undefined;

  const baseUrl = await listenMdash();

  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  // Hidden test-injectability setting (not surfaced in any admin UI) — points the
  // route's MdashClient at the fake server above instead of the real mdash.net.
  app.ctx.settings.set('kegtronBaseUrl', baseUrl);

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
  await mdash.close();
});

describe('settings schema', () => {
  it('exposes a hidden kegtronBaseUrl setting defaulting to https://mdash.net', async () => {
    // Fresh app (not the one pointed at the fake server) proves the schema default.
    const fresh = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
    expect(fresh.ctx.settings.get('kegtronBaseUrl')).toBe('https://mdash.net');
    await fresh.close();
  });
});

describe('POST /api/kegtron/import/:monitorId', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/kegtron/import/1' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a viewer (needs editor role)', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: viewerCookies,
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates a beer from the fixture shadow port config, for an editor', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });

    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: editorCookies,
    });

    expect(res.statusCode).toBe(201);
    expect(seenShadowToken).toBe(DEVICE_KEY);
    const beer = res.json();
    expect(beer).toMatchObject({
      name: 'King Cobra', brewery: 'Anheuser-Busch', style: 'Malt Liquor',
      abv: 6, ibu: 11, srm: 4,
    });
    expect(JSON.stringify(res.body)).not.toContain(DEVICE_KEY);

    const list = await app.inject({ method: 'GET', url: '/api/beers', cookies: adminCookies });
    expect(list.json()).toHaveLength(1);
  });

  it('imports the correct port when portIndex > 0', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 2, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Schlitz', brewery: 'Pabst Brewing' });
  });

  it('400s for a non-pro (Gen 1) monitor', async () => {
    const id = await createMonitor('kegtron_gen1', 'aa:bb:cc:dd:ee:ff', 0, {});
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s when the device shadow has no beer name for that port', async () => {
    shadowResponse = {
      id: 'device9',
      shadow: {
        state: {
          reported: {
            online: true,
            config: { port0: { maker: 'Acme', style: 'Lager', abv: 5, ibu: 10, srm: 3 } },
            config_readonly: { port0: { volStart: 0, volDisp: 0 }, portCount: 1 },
          },
        },
      },
    };
    const id = await createMonitor('kegtron_pro', 'device9', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown monitor id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/kegtron/import/999999', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(404);
  });

  it('502s with a clean message when mdash.net is unreachable, without leaking the device key', async () => {
    // A dedicated dead port (bound then immediately released) rather than tearing down
    // the shared `mdash` fixture mid-test — keeps this test isolated from the others'
    // shared server lifecycle / afterEach cleanup.
    const dead = Fastify();
    await dead.listen({ port: 0, host: '127.0.0.1' });
    const deadPort = (dead.server.address() as { port: number }).port;
    await dead.close();
    app.ctx.settings.set('kegtronBaseUrl', `http://127.0.0.1:${deadPort}`);

    const id = await createMonitor('kegtron_pro', 'deviceX', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(DEVICE_KEY);
  });
});

describe('POST /api/kegtron/reset-volume/:monitorId', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/kegtron/reset-volume/1' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a viewer (needs editor role)', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/reset-volume/${id}`, cookies: viewerCookies,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('hits the fake RPC endpoint with the right path and {port} body for an editor', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 2, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/reset-volume/${id}`, cookies: editorCookies,
      payload: { volStartMl: 19000 },
    });
    expect(res.statusCode).toBe(200);
    expect(seenRpcPath).toBe('/api/v2/m/device/rpc/Kegtron.ResetVolume');
    expect(seenRpcToken).toBe(DEVICE_KEY);
    // The YAML's Kegtron.ResetVolume RPC schema only accepts {port}; it always resets
    // volStart to config.volSize on-device (there's no arbitrary-volStart param on this
    // RPC — that's a different RPC, Kegtron.UserOverride).
    expect(seenRpcBody).toEqual({ port: 2 });
    expect(JSON.stringify(res.body)).not.toContain(DEVICE_KEY);
  });

  it('works with no body at all (volStartMl is optional)', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/reset-volume/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(200);
    expect(seenRpcBody).toEqual({ port: 0 });
  });

  it('400s for a non-pro (Gen 1) monitor', async () => {
    const id = await createMonitor('kegtron_gen1', 'aa:bb:cc:dd:ee:ff', 0, {});
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/reset-volume/${id}`, cookies: editorCookies,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown monitor id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/kegtron/reset-volume/999999', cookies: editorCookies,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('502s with a clean message on mdash RPC failure, without leaking the device key', async () => {
    rpcStatus = 503;
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/reset-volume/${id}`, cookies: editorCookies,
      payload: {},
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(DEVICE_KEY);
  });
});
