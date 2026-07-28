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

  it('PATCHing a masked GET body back does not corrupt stored secrets', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: {
        kegtronApiKey: 'supersecretapikey',
        mqtt: { url: 'mqtt://host:1883', username: 'u', password: 'realmqttpass' },
        untappd: { clientId: 'id1', clientSecret: 'realclientsecret' },
      },
    });
    const getRes = await app.inject({ method: 'GET', url: '/api/settings', cookies: adminCookies });
    const masked = getRes.json();
    expect(masked.kegtronApiKey).toBe('••••ikey');
    expect(masked.mqtt.password).toBe('••••');
    expect(masked.untappd.clientSecret).toBe('••••');

    // client edits an unrelated field and PATCHes the whole masked body back
    masked.siteName = 'Renamed Taproom';
    const roundTrip = await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies, payload: masked,
    });
    expect(roundTrip.statusCode).toBe(200);

    const after = (await app.inject({
      method: 'GET', url: '/api/settings', cookies: adminCookies,
    })).json();
    expect(after.siteName).toBe('Renamed Taproom');
    // secrets must still be intact under the hood, not literally '••••...'
    expect(after.kegtronApiKey).toBe('••••ikey');
    expect(after.mqtt.password).toBe('••••');
    expect(after.untappd.clientSecret).toBe('••••');
  });

  it('a later PATCH of an unrelated field does not wipe an already-configured secret '
    + '(regression: zod .partial() fills omitted keys with schema defaults, so a naive '
    + 'write loop over the fully-defaulted parsed body would silently reset kegtronApiKey '
    + 'back to null)', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { kegtronApiKey: 'realapikey789' },
    });

    const unrelated = await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { siteName: 'Renamed Taproom' },
    });
    expect(unrelated.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: '/api/settings', cookies: adminCookies });
    const body = res.json();
    expect(body.siteName).toBe('Renamed Taproom');
    expect(body.kegtronApiKey).toBe('••••y789');
  });

  it('setting a real new kegtronApiKey via PATCH still works', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { kegtronApiKey: 'firstrealkey123' },
    });
    const patch2 = await app.inject({
      method: 'PATCH', url: '/api/settings', cookies: adminCookies,
      payload: { kegtronApiKey: 'secondrealkey456' },
    });
    expect(patch2.statusCode).toBe(200);
    expect(patch2.json().kegtronApiKey).toBe('••••y456');
  });

  it('never leaks the mdash device key through /api/monitors, for admin or viewer', async () => {
    const DEVICE_KEY = 'device-secret-shhh';
    app.ctx.bus.emit('device_discovered', {
      monitor: { type: 'kegtron_pro', identifier: 'device1', portIndex: 0 },
      serial: 'SN1',
      meta: { deviceKey: DEVICE_KEY, maker: 'Acme', style: 'Lager' },
    });

    const adminList = await app.inject({ method: 'GET', url: '/api/monitors', cookies: adminCookies });
    expect(adminList.statusCode).toBe(200);
    expect(JSON.stringify(adminList.body)).not.toContain(DEVICE_KEY);
    const adminMon = adminList.json().find((m: any) => m.identifier === 'device1');
    expect(adminMon.meta).not.toHaveProperty('deviceKey');
    expect(adminMon.meta).toMatchObject({ maker: 'Acme', style: 'Lager' });

    await app.inject({
      method: 'POST', url: '/api/users', cookies: adminCookies,
      payload: { username: 'vwmon', displayName: 'VwMon', password: 'password1', role: 'viewer' },
    });
    const viewerLogin = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'vwmon', password: 'password1' },
    });
    const viewerCookies = { session: viewerLogin.cookies.find((c: any) => c.name === 'session')!.value };

    const viewerList = await app.inject({ method: 'GET', url: '/api/monitors', cookies: viewerCookies });
    expect(viewerList.statusCode).toBe(200);
    expect(JSON.stringify(viewerList.body)).not.toContain(DEVICE_KEY);
    const viewerMon = viewerList.json().find((m: any) => m.identifier === 'device1');
    expect(viewerMon.meta).not.toHaveProperty('deviceKey');

    // bind's response is sanitized too.
    const tap = (await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
    })).json();
    const bind = await app.inject({
      method: 'POST', url: `/api/monitors/${adminMon.id}/bind`, cookies: adminCookies,
      payload: { tapId: tap.id },
    });
    expect(bind.statusCode).toBe(200);
    expect(JSON.stringify(bind.body)).not.toContain(DEVICE_KEY);
    expect(bind.json().meta).not.toHaveProperty('deviceKey');
  });

  it('rejects a second on_tap keg for an occupied tap with 409', async () => {
    const beer = (await app.inject({
      method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
    })).json();
    const tap = (await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
    })).json();
    const first = await app.inject({
      method: 'POST', url: '/api/kegs', cookies: adminCookies,
      payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST', url: '/api/kegs', cookies: adminCookies,
      payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id },
    });
    expect(second.statusCode).toBe(409);
  });

  describe('on-deck queue + promote (Task 5)', () => {
    async function makeBeerAndTap() {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      return { beer, tap };
    }

    it('POST /api/kegs accepts status on_deck and queues it behind the tap', async () => {
      const { beer, tap } = await makeBeerAndTap();
      const res = await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: {
          beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id, status: 'on_deck',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: 'on_deck', tapId: tap.id });
    });

    it('POST /api/kegs 400s for status on_deck without a tapId', async () => {
      const { beer } = await makeBeerAndTap();
      const res = await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, status: 'on_deck' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('GET /api/taps/:id/on-deck lists queued kegs for that tap; requires auth; 404s for an unknown tap', async () => {
      const { beer, tap } = await makeBeerAndTap();
      await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: {
          beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id, status: 'on_deck',
        },
      });

      const unauth = await app.inject({ method: 'GET', url: `/api/taps/${tap.id}/on-deck` });
      expect(unauth.statusCode).toBe(401);

      const res = await app.inject({
        method: 'GET', url: `/api/taps/${tap.id}/on-deck`, cookies: adminCookies,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);

      const missing = await app.inject({
        method: 'GET', url: '/api/taps/999999/on-deck', cookies: adminCookies,
      });
      expect(missing.statusCode).toBe(404);
    });

    it('POST /api/taps/:id/swap with fromKegId promotes the queued keg instead of creating a new row', async () => {
      const { beer, tap } = await makeBeerAndTap();
      const initial = await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000 },
      });
      expect(initial.statusCode).toBe(201);

      const queued = (await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: {
          beerId: beer.id, sizeMl: 20000, volStartMl: 20000, tapId: tap.id, status: 'on_deck',
        },
      })).json();

      const promote = await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: { fromKegId: queued.id },
      });
      expect(promote.statusCode).toBe(201);
      expect(promote.json()).toMatchObject({ id: queued.id, status: 'on_tap' });

      const kegs = await app.inject({ method: 'GET', url: '/api/kegs', cookies: adminCookies });
      expect(kegs.json()).toHaveLength(2); // no third row created by the promotion
    });

    it('POST /api/taps/:id/swap 400s when neither fromKegId nor a full beer/size/volume payload is given', async () => {
      const { tap } = await makeBeerAndTap();
      const res = await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies, payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('DELETE /api/kegs/:id removes an on-deck keg; requires editor; 400s for a non-on_deck keg; 404s unknown', async () => {
      const { beer, tap } = await makeBeerAndTap();
      const queued = (await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: {
          beerId: beer.id, sizeMl: 20000, volStartMl: 20000, tapId: tap.id, status: 'on_deck',
        },
      })).json();

      const unauth = await app.inject({ method: 'DELETE', url: `/api/kegs/${queued.id}` });
      expect(unauth.statusCode).toBe(401);

      const del = await app.inject({
        method: 'DELETE', url: `/api/kegs/${queued.id}`, cookies: adminCookies,
      });
      expect(del.statusCode).toBe(204);
      const onDeck = await app.inject({
        method: 'GET', url: `/api/taps/${tap.id}/on-deck`, cookies: adminCookies,
      });
      expect(onDeck.json()).toEqual([]);

      const onTap = (await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id },
      })).json();
      const badDelete = await app.inject({
        method: 'DELETE', url: `/api/kegs/${onTap.id}`, cookies: adminCookies,
      });
      expect(badDelete.statusCode).toBe(400);

      const missing = await app.inject({
        method: 'DELETE', url: '/api/kegs/999999', cookies: adminCookies,
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  it('tap create/update/delete each broadcast state_changed (Task 5: keeps the admin taps '
    + 'page live over /ws without a manual reload)', async () => {
    const events: unknown[] = [];
    app.ctx.bus.on('state_changed', (e) => events.push(e));

    const tap = (await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 9 },
    })).json();
    expect(events).toHaveLength(1);

    await app.inject({
      method: 'PATCH', url: `/api/taps/${tap.id}`, cookies: adminCookies, payload: { name: 'Renamed' },
    });
    expect(events).toHaveLength(2);

    await app.inject({ method: 'DELETE', url: `/api/taps/${tap.id}`, cookies: adminCookies });
    expect(events).toHaveLength(3);
  });

  describe('deleteTap conflict explanation (Task 5)', () => {
    it('deleting a tap with kegs on record 409s with an explanation', async () => {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id },
      });
      const res = await app.inject({
        method: 'DELETE', url: `/api/taps/${tap.id}`, cookies: adminCookies,
      });
      expect(res.statusCode).toBe(409);
      const message = res.json().message;
      expect(message).toContain('keg');
      // states the real, permanent constraint — no route can delete historical kegs,
      // so "remove them first" would send an operator looking for a control that
      // doesn't exist.
      expect(message).toContain("can't be deleted");
      expect(message).not.toContain('remove them first');
    });

    it('deleting an empty, unbound tap succeeds', async () => {
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      const res = await app.inject({
        method: 'DELETE', url: `/api/taps/${tap.id}`, cookies: adminCookies,
      });
      expect(res.statusCode).toBe(204);
    });
  });
});
