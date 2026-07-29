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

// Same packed value as shadow.test.ts's decodeUntappdLabelUrl suite: 0x74b90 (hex
// portion) << 32 | 1937040 (decimal portion) -> /site/beer_logos/beer-1937040_74b90.jpeg.
const LABEL_URL_PACKED = 2053406686285456;

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

/** Deep-clones `shadowFixture` with port0's `config.labelUrl` overridden — the fixture
 * itself always has `labelUrl: 0` (no label), so tests exercising the decode+download
 * path need their own copy. */
function shadowWithLabelUrl(labelUrl: number | string): unknown {
  const clone = structuredClone(shadowFixture) as any;
  clone.shadow.state.reported.config.port0.labelUrl = labelUrl;
  return clone;
}

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
let rssiStatus: number;
let rssiValue: number;
let seenRssiToken: unknown;

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
  mdash.post('/api/v2/m/device/rpc/Kegtron.GetWiFiRssi', async (req, reply) => {
    seenRssiToken = (req.query as Record<string, string>).access_token;
    if (rssiStatus !== 200) {
      reply.code(rssiStatus);
      return { error: 'device offline' };
    }
    return rssiValue;
  });
  // Stand-in for untappd.akamaized.net (Phase 5 Task 0's labelUrl-decode item) — same
  // fake server as mdash itself, on a distinct path, per `untappdImageBaseUrl`'s
  // test-injectable pattern (db/settings.ts).
  mdash.get('/site/beer_logos/beer-1937040_74b90.jpeg', async (_req, reply) => {
    reply.header('content-type', 'image/png');
    return PNG_BYTES;
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
  rssiStatus = 200;
  rssiValue = -47;
  seenRssiToken = undefined;

  const baseUrl = await listenMdash();

  // `lookupAllowInsecureHosts: true` — the labelUrl-decode+download tests below reuse
  // routes/lookup.ts's SSRF-guarded download path against the fake `mdash` server above,
  // which (like every other fake server in this test suite) binds to 127.0.0.1; the
  // guard correctly rejects that by default (see lookup.test.ts's own SSRF guard
  // describe block for the un-bypassed case).
  app = await buildApp({
    dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')),
    lookupAllowInsecureHosts: true,
    lookupTimeoutMs: 500,
  });
  // Hidden test-injectability settings (not surfaced in any admin UI) — point the
  // route's MdashClient, and the labelUrl-decode download, at the fake server above
  // instead of the real mdash.net / untappd.akamaized.net.
  app.ctx.settings.set('kegtronBaseUrl', baseUrl);
  app.ctx.settings.set('untappdImageBaseUrl', baseUrl);

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

  // Phase 5 Task 0 spec-parity item: decode the port's labelUrl and download the label
  // art via the same SSRF-guarded path routes/lookup.ts's Untappd import uses.
  it("decodes the port's labelUrl and downloads the label art alongside the beer", async () => {
    shadowResponse = shadowWithLabelUrl(LABEL_URL_PACKED);
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });

    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: editorCookies,
    });

    expect(res.statusCode).toBe(201);
    const beer = res.json();
    expect(beer.name).toBe('King Cobra');
    expect(beer.labelImage).toMatch(/^\/labels\/.+\.png$/);
  });

  it('has no labelUrl (0) -> creates the beer with no label image, same as before', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().labelImage).toBeNull();
  });

  it("still creates the beer (with no label image) when the label download fails — a bad label isn't a reason to fail the whole import", async () => {
    // 4294967297 = (1 << 32) | 1 -> decodes to /site/beer_logos/beer-1_1.jpeg, which no
    // route is registered for on the fake server, so the download 404s (a non-2xx status
    // the shared download path already treats as a clean failure, not a crash).
    shadowResponse = shadowWithLabelUrl(4294967297);
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });

    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/import/${id}`, cookies: editorCookies,
    });

    expect(res.statusCode).toBe(201);
    const beer = res.json();
    expect(beer.name).toBe('King Cobra');
    expect(beer.labelImage).toBeNull();
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
      payload: {},
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

  it('400s (does not silently drop) when volStartMl is provided — the RPC cannot honor it', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/reset-volume/${id}`, cookies: editorCookies,
      payload: { volStartMl: 19000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'validation',
      message: 'volStartMl is not supported by Kegtron.ResetVolume; the device resets to its configured keg size',
    });
    // The RPC must never actually be called when the request is rejected.
    expect(seenRpcToken).toBeUndefined();
    expect(seenRpcBody).toBeUndefined();
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

describe('POST /api/kegtron/wifi-rssi/:monitorId', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/kegtron/wifi-rssi/1' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a viewer (needs editor role)', async () => {
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/wifi-rssi/${id}`, cookies: viewerCookies,
    });
    expect(res.statusCode).toBe(403);
  });

  it('hits the fake RPC endpoint and returns the reported rssi, for an editor', async () => {
    rssiValue = -63;
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/wifi-rssi/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(200);
    expect(seenRssiToken).toBe(DEVICE_KEY);
    expect(res.json()).toEqual({ rssi: -63 });
    expect(JSON.stringify(res.body)).not.toContain(DEVICE_KEY);
  });

  it('400s for a non-pro (Gen 1) monitor', async () => {
    const id = await createMonitor('kegtron_gen1', 'aa:bb:cc:dd:ee:ff', 0, {});
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/wifi-rssi/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown monitor id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/kegtron/wifi-rssi/999999', cookies: editorCookies,
    });
    expect(res.statusCode).toBe(404);
  });

  it('502s with a clean message when mdash.net is unreachable, without leaking the device key', async () => {
    rssiStatus = 503;
    const id = await createMonitor('kegtron_pro', 'device2', 0, { deviceKey: DEVICE_KEY });
    const res = await app.inject({
      method: 'POST', url: `/api/kegtron/wifi-rssi/${id}`, cookies: editorCookies,
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(DEVICE_KEY);
  });
});
