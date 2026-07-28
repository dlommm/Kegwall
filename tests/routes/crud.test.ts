import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
let adminCookies: { session: string };

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  const c = setup.cookies.find((c: any) => c.name === 'session')!;
  adminCookies = { session: c.value };
});
afterEach(async () => { await app.close(); });

describe('crud routes', () => {
  it('rejects unauthenticated beer creation', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/beers', payload: { name: 'X' } });
    expect(res.statusCode).toBe(401);
  });

  it('creates and lists beers as admin', async () => {
    const create = await app.inject({
      method: 'POST', url: '/api/beers', cookies: adminCookies,
      payload: { name: 'Citra IPA', abv: 6.5, srm: 6 },
    });
    expect(create.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/beers', cookies: adminCookies });
    expect(list.json()).toHaveLength(1);
  });

  it('viewer can read but not write', async () => {
    await app.inject({
      method: 'POST', url: '/api/users', cookies: adminCookies,
      payload: { username: 'v', displayName: 'V', password: 'password1', role: 'viewer' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'v', password: 'password1' },
    });
    const vc = { session: login.cookies.find((c: any) => c.name === 'session')!.value };
    expect((await app.inject({ method: 'GET', url: '/api/beers', cookies: vc })).statusCode).toBe(200);
    const write = await app.inject({
      method: 'POST', url: '/api/beers', cookies: vc, payload: { name: 'No' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('runs the keg swap flow', async () => {
    const beer = (await app.inject({
      method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
    })).json();
    const tap = (await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
    })).json();
    const swap = await app.inject({
      method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
      payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000 },
    });
    expect(swap.statusCode).toBe(201);
    expect(swap.json()).toMatchObject({ status: 'on_tap', beerId: beer.id });
  });

  it('validates wall config and applies defaults', async () => {
    const ok = await app.inject({
      method: 'POST', url: '/api/walls', cookies: adminCookies,
      payload: { slug: 'main', name: 'Main Wall', config: {} },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().config.columns).toBe(2);
    const bad = await app.inject({
      method: 'POST', url: '/api/walls', cookies: adminCookies,
      payload: { slug: 'bad', name: 'Bad', config: { columns: 9 } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('fetches a single wall by id and 404s for unknown ids', async () => {
    const created = (await app.inject({
      method: 'POST', url: '/api/walls', cookies: adminCookies,
      payload: { slug: 'single', name: 'Single Wall', config: {} },
    })).json();
    const get = await app.inject({
      method: 'GET', url: `/api/walls/${created.id}`, cookies: adminCookies,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ slug: 'single', name: 'Single Wall' });
    const missing = await app.inject({
      method: 'GET', url: '/api/walls/999999', cookies: adminCookies,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('masks settings secrets', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { kegtronApiKey: 'supersecretapikey' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/settings', cookies: adminCookies });
    expect(res.json().kegtronApiKey).toBe('••••ikey');
  });
});
