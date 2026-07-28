import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { MdashClient, MdashError } from '../../src/server/ingest/kegtron/mdashClient.js';

// Fake mdash.net server — never call the real mdash.net from tests. Each route asserts
// the auth model the real API uses: access_token is always a QUERY PARAM (never a
// header, never in the body), and it carries either the customer-level API key
// (/customer) or a device-scoped DEVICE_PUBLIC_KEY (everything under /api/v2/m/device).
const API_KEY = 'customer-secret-8f3a1c';
const DEVICE_KEY = 'device-secret-b91e7d';

let app: FastifyInstance;

beforeEach(() => {
  app = Fastify();
});

afterEach(async () => {
  await app.close();
});

// Routes must be registered on `app` before calling this (Fastify forbids adding routes
// once listening has started).
async function listen(): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

describe('MdashClient.getCustomer', () => {
  it('GETs /customer with access_token query param and maps pubkeys to devicePubkeys', async () => {
    let seenToken: unknown;
    app.get('/customer', async (req) => {
      seenToken = (req.query as Record<string, string>).access_token;
      return {
        id: 'cust1',
        app_id: 'app1',
        email: 'user@example.com',
        token: API_KEY,
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
        pubkeys: { deviceA: {}, deviceB: {} },
      };
    });
    const baseUrl = await listen();

    const client = new MdashClient({ apiKey: API_KEY, baseUrl });
    const result = await client.getCustomer();

    expect(seenToken).toBe(API_KEY);
    expect(result.devicePubkeys.sort()).toEqual(['deviceA', 'deviceB']);
  });

  it('returns an empty list when pubkeys is absent', async () => {
    app.get('/customer', async () => ({}));
    const baseUrl = await listen();
    const client = new MdashClient({ apiKey: API_KEY, baseUrl });
    const result = await client.getCustomer();
    expect(result.devicePubkeys).toEqual([]);
  });
});

describe('MdashClient.getDeviceShadow', () => {
  it('GETs /api/v2/m/device with the device key as access_token and returns the body as-is', async () => {
    let seenToken: unknown;
    const shadowBody = { id: 'device2', shadow: { state: { reported: { online: true } } } };
    app.get('/api/v2/m/device', async (req) => {
      seenToken = (req.query as Record<string, string>).access_token;
      return shadowBody;
    });
    const baseUrl = await listen();

    const client = new MdashClient({ apiKey: API_KEY, baseUrl });
    const result = await client.getDeviceShadow(DEVICE_KEY);

    expect(seenToken).toBe(DEVICE_KEY);
    expect(result).toEqual(shadowBody);
  });
});

describe('MdashClient.getServings', () => {
  it('POSTs {params: [start, end]} and maps rows using the 0-indexed port_number from the spec', async () => {
    let seenToken: unknown;
    let seenBody: unknown;
    app.post('/api/v2/m/device/data/servings-device', async (req) => {
      seenToken = (req.query as Record<string, string>).access_token;
      seenBody = req.body;
      return {
        rows: [
          // [cloud_ts, device_ts, site_name, device_id, port_number, serving_volume_ml,
          //  total_volume_dispensed_ml, keg_level_percent, keg_name, serving_duration_ms]
          ['2026-04-01T21:05:00Z', '2026-04-01T14:05:00', "Moe's Tavern", 'device2', 0, 473, 7407, 88.6, 'King Cobra', 8200],
          ['2026-04-01T22:00:00Z', '2026-04-01T15:00:00', "Moe's Tavern", 'device2', 2, 355, 1000, 42.1, 'Schlitz', null],
        ],
      };
    });
    const baseUrl = await listen();

    const client = new MdashClient({ apiKey: API_KEY, baseUrl });
    const rows = await client.getServings(DEVICE_KEY, '2026-04-01', 'now');

    expect(seenToken).toBe(DEVICE_KEY);
    expect(seenBody).toEqual({ params: ['2026-04-01', 'now'] });
    expect(rows).toEqual([
      { ts: '2026-04-01T21:05:00Z', portIndex: 0, volumeMl: 473, durationMs: 8200 },
      { ts: '2026-04-01T22:00:00Z', portIndex: 2, volumeMl: 355, durationMs: null },
    ]);
  });

  it('returns an empty array when rows is absent', async () => {
    app.post('/api/v2/m/device/data/servings-device', async () => ({}));
    const baseUrl = await listen();
    const client = new MdashClient({ apiKey: API_KEY, baseUrl });
    const rows = await client.getServings(DEVICE_KEY, '2026-04-01', 'now');
    expect(rows).toEqual([]);
  });
});

describe('MdashClient.callRpc', () => {
  it('POSTs to /api/v2/m/device/rpc/{method} with the device key and forwards params as the raw body', async () => {
    let seenToken: unknown;
    let seenBody: unknown;
    app.post('/api/v2/m/device/rpc/Kegtron.CleanMode', async (req) => {
      seenToken = (req.query as Record<string, string>).access_token;
      seenBody = req.body;
      return true;
    });
    const baseUrl = await listen();

    const client = new MdashClient({ apiKey: API_KEY, baseUrl });
    const result = await client.callRpc(DEVICE_KEY, 'Kegtron.CleanMode', { mode: 1, port: 3 });

    expect(seenToken).toBe(DEVICE_KEY);
    expect(seenBody).toEqual({ mode: 1, port: 3 });
    expect(result).toBe(true);
  });

  it('sends no body when params is omitted', async () => {
    let seenBody: unknown = 'unset';
    app.post('/api/v2/m/device/rpc/Kegtron.GetVoltage', async (req) => {
      seenBody = req.body;
      return 12.04;
    });
    const baseUrl = await listen();

    const client = new MdashClient({ apiKey: API_KEY, baseUrl });
    const result = await client.callRpc(DEVICE_KEY, 'Kegtron.GetVoltage');

    expect(seenBody == null || seenBody === '').toBe(true);
    expect(result).toBe(12.04);
  });
});

describe('MdashClient error handling', () => {
  it('throws MdashError with the response status on a non-2xx response', async () => {
    app.get('/api/v2/m/device', async (_req, reply) => {
      reply.code(503);
      return { error: 'device offline' };
    });
    const baseUrl = await listen();

    const client = new MdashClient({ apiKey: API_KEY, baseUrl });
    await expect(client.getDeviceShadow(DEVICE_KEY)).rejects.toThrow(MdashError);
    await expect(client.getDeviceShadow(DEVICE_KEY)).rejects.toMatchObject({ status: 503 });
  });

  it('never includes the API key or device key in an error message', async () => {
    app.get('/customer', async (_req, reply) => {
      reply.code(401);
      return { error: 'unauthorized' };
    });
    app.get('/api/v2/m/device', async (_req, reply) => {
      reply.code(401);
      return { error: 'unauthorized' };
    });
    const baseUrl = await listen();

    const client = new MdashClient({ apiKey: API_KEY, baseUrl });

    let customerErr: unknown;
    try {
      await client.getCustomer();
    } catch (err) {
      customerErr = err;
    }
    expect(customerErr).toBeInstanceOf(MdashError);
    expect(String((customerErr as Error).message)).not.toContain(API_KEY);
    expect(JSON.stringify(customerErr)).not.toContain(API_KEY);

    let deviceErr: unknown;
    try {
      await client.getDeviceShadow(DEVICE_KEY);
    } catch (err) {
      deviceErr = err;
    }
    expect(deviceErr).toBeInstanceOf(MdashError);
    expect(String((deviceErr as Error).message)).not.toContain(DEVICE_KEY);
    expect(JSON.stringify(deviceErr)).not.toContain(DEVICE_KEY);
  });

  it('aborts and throws MdashError (without the key) when the server exceeds the timeout', async () => {
    app.get('/api/v2/m/device', async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { id: 'device2' };
    });
    const baseUrl = await listen();

    // timeoutMs is a test-only injectable override (see mdashClient.ts) — production
    // default remains the 10s the brief requires; see Deviations in task-3-report.md.
    const client = new MdashClient({ apiKey: API_KEY, baseUrl, timeoutMs: 30 });
    const start = Date.now();

    let err: unknown;
    try {
      await client.getDeviceShadow(DEVICE_KEY);
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - start;

    expect(err).toBeInstanceOf(MdashError);
    expect(elapsed).toBeLessThan(300);
    expect(String((err as Error).message)).not.toContain(DEVICE_KEY);
  });
});
