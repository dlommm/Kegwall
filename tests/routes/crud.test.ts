import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordTelemetrySampled } from '../../src/server/db/telemetry.js';

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

  describe('keg_type (manual asset override, keg-asset fill indicator feature)', () => {
    it('POST /api/taps/:id/swap accepts and persists an explicit kegType', async () => {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      const swap = await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: {
          beerId: beer.id, sizeMl: 19000, volStartMl: 19000, kegType: 'cornelius',
        },
      });
      expect(swap.statusCode).toBe(201);
      expect(swap.json()).toMatchObject({ kegType: 'cornelius' });
    });

    it('POST /api/taps/:id/swap defaults kegType to null (auto-match) when omitted', async () => {
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
      expect(swap.json()).toMatchObject({ kegType: null });
    });

    it('POST /api/taps/:id/swap 400s for an unrecognized kegType', async () => {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      const swap = await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: {
          beerId: beer.id, sizeMl: 19000, volStartMl: 19000, kegType: 'not-a-real-asset',
        },
      });
      expect(swap.statusCode).toBe(400);
    });

    it('POST /api/kegs accepts and persists an explicit kegType', async () => {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const res = await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: {
          beerId: beer.id, sizeMl: 19000, volStartMl: 19000, kegType: 'mini-keg',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ kegType: 'mini-keg' });
    });

    it('POST /api/kegs 400s for an unrecognized kegType', async () => {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const res = await app.inject({
        method: 'POST', url: '/api/kegs', cookies: adminCookies,
        payload: {
          beerId: beer.id, sizeMl: 19000, volStartMl: 19000, kegType: 'not-a-real-asset',
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('keg_tapped / keg_kicked bus events (Phase 5 Task 3: feeds the automation '
    + 'engine\'s keg_tapped/keg_kicked triggers)', () => {
    it('POST /api/taps/:id/swap onto an EMPTY tap emits only keg_tapped (no incumbent to kick)', async () => {
      const tapped: unknown[] = [];
      const kicked: unknown[] = [];
      app.ctx.bus.on('keg_tapped', (e) => tapped.push(e));
      app.ctx.bus.on('keg_kicked', (e) => kicked.push(e));

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
      const keg = swap.json();

      expect(kicked).toHaveLength(0);
      expect(tapped).toHaveLength(1);
      expect(tapped[0]).toMatchObject({ tapId: tap.id, kegId: keg.id, beerId: beer.id });
      expect((tapped[0] as any).ts).toBeTruthy();
    });

    it('POST /api/taps/:id/swap onto an OCCUPIED tap emits keg_kicked (outgoing keg) then keg_tapped (incoming)', async () => {
      const beerA = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const beerB = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'IPA' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      const firstKeg = (await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: { beerId: beerA.id, sizeMl: 19000, volStartMl: 19000 },
      })).json();

      const events: { type: string; payload: unknown }[] = [];
      app.ctx.bus.on('keg_tapped', (e) => events.push({ type: 'keg_tapped', payload: e }));
      app.ctx.bus.on('keg_kicked', (e) => events.push({ type: 'keg_kicked', payload: e }));

      const swap2 = await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: { beerId: beerB.id, sizeMl: 19000, volStartMl: 19000 },
      });
      const secondKeg = swap2.json();

      expect(events.map((e) => e.type)).toEqual(['keg_kicked', 'keg_tapped']);
      expect(events[0]!.payload).toMatchObject({ tapId: tap.id, kegId: firstKeg.id, beerId: beerA.id });
      expect(events[1]!.payload).toMatchObject({ tapId: tap.id, kegId: secondKeg.id, beerId: beerB.id });
    });

    it('PATCH /api/kegs/:id to status "kicked" emits keg_kicked once (on the actual transition)', async () => {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      const keg = (await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000 },
      })).json();

      const kicked: unknown[] = [];
      app.ctx.bus.on('keg_kicked', (e) => kicked.push(e));

      await app.inject({
        method: 'PATCH', url: `/api/kegs/${keg.id}`, cookies: adminCookies, payload: { status: 'kicked' },
      });
      expect(kicked).toHaveLength(1);
      expect(kicked[0]).toMatchObject({ tapId: tap.id, kegId: keg.id, beerId: beer.id });

      // A second PATCH to the SAME status is not a transition -- must not re-fire.
      await app.inject({
        method: 'PATCH', url: `/api/kegs/${keg.id}`, cookies: adminCookies, payload: { status: 'kicked' },
      });
      expect(kicked).toHaveLength(1);
    });

    it('PATCH /api/kegs/:id to status "on_tap" emits keg_tapped once (on the actual transition)', async () => {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      const keg = (await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000 },
      })).json();
      await app.inject({
        method: 'PATCH', url: `/api/kegs/${keg.id}`, cookies: adminCookies, payload: { status: 'kicked' },
      });

      const tapped: unknown[] = [];
      app.ctx.bus.on('keg_tapped', (e) => tapped.push(e));

      await app.inject({
        method: 'PATCH', url: `/api/kegs/${keg.id}`, cookies: adminCookies, payload: { status: 'on_tap' },
      });
      expect(tapped).toHaveLength(1);
      expect(tapped[0]).toMatchObject({ tapId: tap.id, kegId: keg.id, beerId: beer.id });
    });

    it('PATCH /api/kegs/:id to status "archived" emits neither event', async () => {
      const beer = (await app.inject({
        method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Pils' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      })).json();
      const keg = (await app.inject({
        method: 'POST', url: `/api/taps/${tap.id}/swap`, cookies: adminCookies,
        payload: { beerId: beer.id, sizeMl: 19000, volStartMl: 19000 },
      })).json();

      const events: unknown[] = [];
      app.ctx.bus.on('keg_tapped', (e) => events.push(e));
      app.ctx.bus.on('keg_kicked', (e) => events.push(e));

      await app.inject({
        method: 'PATCH', url: `/api/kegs/${keg.id}`, cookies: adminCookies, payload: { status: 'archived' },
      });
      expect(events).toHaveLength(0);
    });
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

  describe('wall devices (device→wall scoping)', () => {
    async function makeWall(slug: string): Promise<number> {
      return (await app.inject({
        method: 'POST', url: '/api/walls', cookies: adminCookies,
        payload: { slug, name: slug, config: {} },
      })).json().id;
    }

    it('PUT replaces the assignment, GET reads it back, and state_changed fires', async () => {
      const wallId = await makeWall('devwall');
      app.ctx.bus.emit('device_discovered', {
        monitor: { type: 'kegtron_pro', identifier: 'dev1', portIndex: 0 },
      });
      const events: unknown[] = [];
      app.ctx.bus.on('state_changed', (e) => events.push(e));

      const put = await app.inject({
        method: 'PUT', url: `/api/walls/${wallId}/devices`, cookies: adminCookies,
        payload: { devices: [{ type: 'kegtron_pro', identifier: 'dev1' }] },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual([{ type: 'kegtron_pro', identifier: 'dev1' }]);
      expect(events).toHaveLength(1);

      const get = await app.inject({
        method: 'GET', url: `/api/walls/${wallId}/devices`, cookies: adminCookies,
      });
      expect(get.json()).toEqual([{ type: 'kegtron_pro', identifier: 'dev1' }]);
    });

    it('rejects an unknown device pair with a 400 naming it', async () => {
      const wallId = await makeWall('badwall');
      const bad = await app.inject({
        method: 'PUT', url: `/api/walls/${wallId}/devices`, cookies: adminCookies,
        payload: { devices: [{ type: 'kegtron_pro', identifier: 'ghost' }] },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().message).toContain('ghost');
    });

    it('404s an unknown wall id', async () => {
      const missing = await app.inject({
        method: 'GET', url: '/api/walls/999999/devices', cookies: adminCookies,
      });
      expect(missing.statusCode).toBe(404);
    });
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
      },
    });
    const getRes = await app.inject({ method: 'GET', url: '/api/settings', cookies: adminCookies });
    const masked = getRes.json();
    expect(masked.kegtronApiKey).toBe('••••ikey');
    expect(masked.mqtt.password).toBe('••••');

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

  it('refuses to bind a Govee sensor to a tap', async () => {
    app.ctx.bus.emit('device_discovered', {
      monitor: { type: 'govee_sensor', identifier: 'AA:BB', portIndex: 0 },
    });
    const tap = (await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 77 },
    })).json();
    const monitors = (await app.inject({ method: 'GET', url: '/api/monitors', cookies: adminCookies })).json();
    const sensor = monitors.find((m: any) => m.identifier === 'AA:BB');
    const res = await app.inject({
      method: 'POST', url: `/api/monitors/${sensor.id}/bind`, cookies: adminCookies,
      payload: { tapId: tap.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Govee');
  });

  it('serves the device-reported keg config on /api/monitors as deviceKeg', async () => {
    app.ctx.bus.emit('volume_update', {
      monitor: { type: 'kegtron_pro', identifier: 'device1', portIndex: 0 },
      volStartMl: 29337, volDispensedMl: 530, sizeMl: 29337,
      ts: '2026-07-29T00:00:00.000Z',
    });
    const list = await app.inject({ method: 'GET', url: '/api/monitors', cookies: adminCookies });
    expect(list.statusCode).toBe(200);
    const mon = list.json().find((m: any) => m.identifier === 'device1');
    expect(mon.deviceKeg).toEqual({
      sizeMl: 29337, volStartMl: 29337, ts: '2026-07-29T00:00:00.000Z',
    });
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

  describe('GET /api/monitors/:id/telemetry (Task 6)', () => {
    async function makeProMonitor(identifier: string): Promise<number> {
      app.ctx.bus.emit('device_discovered', {
        monitor: { type: 'kegtron_pro', identifier, portIndex: 0 },
        serial: identifier,
        meta: {},
      });
      const list = await app.inject({ method: 'GET', url: '/api/monitors', cookies: adminCookies });
      return (list.json() as any[]).find((m) => m.identifier === identifier).id;
    }

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/monitors/1/telemetry' });
      expect(res.statusCode).toBe(401);
    });

    it('404s for an unknown monitor id', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/monitors/999999/telemetry', cookies: adminCookies,
      });
      expect(res.statusCode).toBe(404);
    });

    it('a viewer can read telemetry (viewer role, not editor-gated)', async () => {
      const monitorId = await makeProMonitor('mon-viewer');
      await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: { username: 'vwtel', displayName: 'VwTel', password: 'password1', role: 'viewer' },
      });
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { username: 'vwtel', password: 'password1' },
      });
      const viewerCookies = { session: login.cookies.find((c: any) => c.name === 'session')!.value };

      const res = await app.inject({
        method: 'GET', url: `/api/monitors/${monitorId}/telemetry`, cookies: viewerCookies,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('reuses listTelemetry to return recorded temp/humidity rows', async () => {
      const monitorId = await makeProMonitor('mon-data');
      const now = new Date();
      recordTelemetrySampled(app.ctx.db, monitorId, 4.2, 50, now.toISOString());

      const res = await app.inject({
        method: 'GET', url: `/api/monitors/${monitorId}/telemetry`, cookies: adminCookies,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject([{ temp: 4.2, humidity: 50 }]);
    });

    it('defaults to a 24h window and excludes older rows', async () => {
      const monitorId = await makeProMonitor('mon-window');
      const now = new Date();
      const old = new Date(now.getTime() - 30 * 60 * 60 * 1000);
      const recent = new Date(now.getTime() - 60 * 60 * 1000);
      recordTelemetrySampled(app.ctx.db, monitorId, 3.0, 40, old.toISOString());
      recordTelemetrySampled(app.ctx.db, monitorId, 4.0, 45, recent.toISOString());

      const res = await app.inject({
        method: 'GET', url: `/api/monitors/${monitorId}/telemetry`, cookies: adminCookies,
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ temp: 4.0, humidity: 45 });
    });

    it('honors an explicit ?hours= window', async () => {
      const monitorId = await makeProMonitor('mon-hours');
      const now = new Date();
      const fortyHoursAgo = new Date(now.getTime() - 40 * 60 * 60 * 1000);
      recordTelemetrySampled(app.ctx.db, monitorId, 5.0, 55, fortyHoursAgo.toISOString());

      const narrow = await app.inject({
        method: 'GET', url: `/api/monitors/${monitorId}/telemetry?hours=24`, cookies: adminCookies,
      });
      expect(narrow.json()).toEqual([]);

      const wide = await app.inject({
        method: 'GET', url: `/api/monitors/${monitorId}/telemetry?hours=48`, cookies: adminCookies,
      });
      expect(wide.json()).toHaveLength(1);
    });

    it('400s when hours is above the 168 max', async () => {
      const monitorId = await makeProMonitor('mon-toobig');
      const res = await app.inject({
        method: 'GET', url: `/api/monitors/${monitorId}/telemetry?hours=200`, cookies: adminCookies,
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s when hours is below the 1 minimum', async () => {
      const monitorId = await makeProMonitor('mon-toosmall');
      const res = await app.inject({
        method: 'GET', url: `/api/monitors/${monitorId}/telemetry?hours=0`, cookies: adminCookies,
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s for a non-numeric hours value', async () => {
      const monitorId = await makeProMonitor('mon-nan');
      const res = await app.inject({
        method: 'GET', url: `/api/monitors/${monitorId}/telemetry?hours=abc`, cookies: adminCookies,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('taps: hidden flag', () => {
    it('defaults false, round-trips via POST/PATCH, and excludes the tap from wall allowedTapIds', async () => {
      const created = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 41 },
      })).json();
      expect(created.hidden).toBe(false);

      const patched = (await app.inject({
        method: 'PATCH', url: `/api/taps/${created.id}`, cookies: adminCookies,
        payload: { hidden: true },
      })).json();
      expect(patched.hidden).toBe(true);

      // Bind a device port to it, assign the device to a wall — the hidden tap must
      // still not appear in the wall's allowed set.
      app.ctx.bus.emit('device_discovered', {
        monitor: { type: 'kegtron_pro', identifier: 'hidden-dev', portIndex: 0 },
      });
      const monitors = (await app.inject({ method: 'GET', url: '/api/monitors', cookies: adminCookies })).json();
      const mon = monitors.find((m: any) => m.identifier === 'hidden-dev');
      await app.inject({
        method: 'POST', url: `/api/monitors/${mon.id}/bind`, cookies: adminCookies,
        payload: { tapId: created.id },
      });
      const wall = (await app.inject({
        method: 'POST', url: '/api/walls', cookies: adminCookies,
        payload: { slug: 'hiddenwall', name: 'H', config: {} },
      })).json();
      await app.inject({
        method: 'PUT', url: `/api/walls/${wall.id}/devices`, cookies: adminCookies,
        payload: { devices: [{ type: 'kegtron_pro', identifier: 'hidden-dev' }] },
      });
      const payload = (await app.inject({ method: 'GET', url: '/api/public/wall/hiddenwall' })).json();
      expect(payload.allowedTapIds).toEqual([]);

      // Un-hide: the tap joins the wall's allowed set.
      await app.inject({
        method: 'PATCH', url: `/api/taps/${created.id}`, cookies: adminCookies,
        payload: { hidden: false },
      });
      const after = (await app.inject({ method: 'GET', url: '/api/public/wall/hiddenwall' })).json();
      expect(after.allowedTapIds).toEqual([created.id]);
    });
  });

  describe('taps: default drinker (Phase 5 Task 0)', () => {
    it('defaults to null, and can be set via POST/PATCH', async () => {
      const drinker = (await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: { drinkerOnly: true, displayName: 'Bob' },
      })).json();

      const created = await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
      });
      expect(created.json().defaultDrinkerId).toBeNull();

      const withDefault = await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies,
        payload: { number: 2, defaultDrinkerId: drinker.id },
      });
      expect(withDefault.statusCode).toBe(201);
      expect(withDefault.json().defaultDrinkerId).toBe(drinker.id);

      const patched = await app.inject({
        method: 'PATCH', url: `/api/taps/${created.json().id}`, cookies: adminCookies,
        payload: { defaultDrinkerId: drinker.id },
      });
      expect(patched.json().defaultDrinkerId).toBe(drinker.id);

      const cleared = await app.inject({
        method: 'PATCH', url: `/api/taps/${withDefault.json().id}`, cookies: adminCookies,
        payload: { defaultDrinkerId: null },
      });
      expect(cleared.json().defaultDrinkerId).toBeNull();
    });

    it('GET /api/taps includes defaultDrinkerId for a viewer', async () => {
      const drinker = (await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: { drinkerOnly: true, displayName: 'Sam' },
      })).json();
      await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies,
        payload: { number: 1, defaultDrinkerId: drinker.id },
      });
      const list = await app.inject({ method: 'GET', url: '/api/taps', cookies: adminCookies });
      expect(list.json()[0].defaultDrinkerId).toBe(drinker.id);
    });

    // Fix round 1 (Task 0 review): the FK on default_drinker_id only blocks a
    // nonexistent user id, not a real login-only staff account that opted out of drinker
    // status (is_drinker=0) — without an explicit is_drinker check here, a raw API call
    // could set such a staff member's id as a tap's default and have StateManager
    // (core/state.ts) publicly attribute every future pour on that tap to them,
    // unvalidated. NOTE: a login user's `is_drinker` actually DEFAULTS to 1
    // (db/users.ts's createUser: `input.isDrinker === false ? 0 : 1`) — a genuine
    // "opted-out staff" fixture needs an explicit `PATCH .../users/:id {isDrinker:
    // false}`, matching the real admin UI flow (UsersPage's "Also a drinker" toggle).
    async function createNonDrinkerLoginUser(username: string): Promise<number> {
      const created = (await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: {
          username, displayName: username, password: 'password1', role: 'viewer',
        },
      })).json();
      await app.inject({
        method: 'PATCH', url: `/api/users/${created.id}`, cookies: adminCookies,
        payload: { isDrinker: false },
      });
      return created.id;
    }

    it('400s POST /api/taps when defaultDrinkerId refers to a non-drinker (login) user', async () => {
      const staffId = await createNonDrinkerLoginUser('staffonly1');
      const res = await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies,
        payload: { number: 9, defaultDrinkerId: staffId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation', message: 'No such drinker' });
    });

    it('400s POST /api/taps when defaultDrinkerId does not exist at all', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies,
        payload: { number: 9, defaultDrinkerId: 999999 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('200s POST /api/taps when defaultDrinkerId refers to a real drinker', async () => {
      const drinker = (await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: { drinkerOnly: true, displayName: 'Real Drinker' },
      })).json();
      const res = await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies,
        payload: { number: 9, defaultDrinkerId: drinker.id },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().defaultDrinkerId).toBe(drinker.id);
    });

    it('400s PATCH /api/taps/:id when defaultDrinkerId refers to a non-drinker (login) user', async () => {
      const staffId = await createNonDrinkerLoginUser('staffonly2');
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 10 },
      })).json();
      const res = await app.inject({
        method: 'PATCH', url: `/api/taps/${tap.id}`, cookies: adminCookies,
        payload: { defaultDrinkerId: staffId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation', message: 'No such drinker' });
      // and the tap's default was never actually set
      expect((await app.inject({ method: 'GET', url: '/api/taps', cookies: adminCookies }))
        .json().find((t: any) => t.id === tap.id).defaultDrinkerId).toBeNull();
    });

    it('200s PATCH /api/taps/:id when defaultDrinkerId refers to a real drinker, and null still clears it', async () => {
      const drinker = (await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: { drinkerOnly: true, displayName: 'Real Drinker 2' },
      })).json();
      const tap = (await app.inject({
        method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 11 },
      })).json();

      const set = await app.inject({
        method: 'PATCH', url: `/api/taps/${tap.id}`, cookies: adminCookies,
        payload: { defaultDrinkerId: drinker.id },
      });
      expect(set.statusCode).toBe(200);
      expect(set.json().defaultDrinkerId).toBe(drinker.id);

      const cleared = await app.inject({
        method: 'PATCH', url: `/api/taps/${tap.id}`, cookies: adminCookies,
        payload: { defaultDrinkerId: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().defaultDrinkerId).toBeNull();
    });
  });

  describe('PATCH /api/pours/:id/drinker (Phase 5 Task 0 — admin reassign/unclaim)', () => {
    async function recordPourViaTap(): Promise<{ pourId: number; drinkerId: number; tapId: number }> {
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
      // No direct "create monitor" route — a monitor row only exists once a source has
      // reported it; the bus event above is what real device discovery emits.
      app.ctx.bus.emit('device_discovered', {
        monitor: { type: 'kegtron_pro', identifier: 'dev', portIndex: 0 }, meta: {},
      });
      const monitors = await app.inject({ method: 'GET', url: '/api/monitors', cookies: adminCookies });
      const monitorId = monitors.json()[0].id;
      await app.inject({
        method: 'POST', url: `/api/monitors/${monitorId}/bind`, cookies: adminCookies,
        payload: { tapId: tap.id },
      });
      app.ctx.bus.emit('pour_completed', {
        monitor: { type: 'kegtron_pro', identifier: 'dev', portIndex: 0 },
        volumeMl: 400, durationMs: null, source: 'cloud', ts: new Date().toISOString(),
      });
      const pours = (await app.inject({ method: 'GET', url: '/api/pours', cookies: adminCookies })).json();
      const pourId = pours[0].id;
      const drinker = (await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: { drinkerOnly: true, displayName: 'Reassign Target' },
      })).json();
      return { pourId, drinkerId: drinker.id, tapId: tap.id };
    }

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({ method: 'PATCH', url: '/api/pours/1/drinker', payload: { drinkerId: 1 } });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a viewer (needs editor role)', async () => {
      await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: { username: 'vwp', displayName: 'VwP', password: 'password1', role: 'viewer' },
      });
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { username: 'vwp', password: 'password1' },
      });
      const viewerCookies = { session: login.cookies.find((c: any) => c.name === 'session')!.value };
      const res = await app.inject({
        method: 'PATCH', url: '/api/pours/1/drinker', cookies: viewerCookies, payload: { drinkerId: 1 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('reassigns a pour to a drinker (editor)', async () => {
      const { pourId, drinkerId } = await recordPourViaTap();
      const res = await app.inject({
        method: 'PATCH', url: `/api/pours/${pourId}/drinker`, cookies: adminCookies,
        payload: { drinkerId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().drinkerId).toBe(drinkerId);
    });

    it('unclaims a pour (drinkerId: null), overriding an existing claim — admin override, '
      + 'unlike the public claim route which 409s on an already-claimed pour', async () => {
      const { pourId, drinkerId } = await recordPourViaTap();
      await app.inject({
        method: 'PATCH', url: `/api/pours/${pourId}/drinker`, cookies: adminCookies,
        payload: { drinkerId },
      });
      const unclaim = await app.inject({
        method: 'PATCH', url: `/api/pours/${pourId}/drinker`, cookies: adminCookies,
        payload: { drinkerId: null },
      });
      expect(unclaim.statusCode).toBe(200);
      expect(unclaim.json().drinkerId).toBeNull();
    });

    it('reassigns a pour that already has a different drinker (admin override)', async () => {
      const { pourId, drinkerId: first } = await recordPourViaTap();
      const second = (await app.inject({
        method: 'POST', url: '/api/users', cookies: adminCookies,
        payload: { drinkerOnly: true, displayName: 'Second Target' },
      })).json();
      await app.inject({
        method: 'PATCH', url: `/api/pours/${pourId}/drinker`, cookies: adminCookies,
        payload: { drinkerId: first },
      });
      const reassigned = await app.inject({
        method: 'PATCH', url: `/api/pours/${pourId}/drinker`, cookies: adminCookies,
        payload: { drinkerId: second.id },
      });
      expect(reassigned.statusCode).toBe(200);
      expect(reassigned.json().drinkerId).toBe(second.id);
    });

    it('400s for a drinkerId that is not a drinker (e.g. a login user, or unknown id)', async () => {
      const { pourId } = await recordPourViaTap();
      const res = await app.inject({
        method: 'PATCH', url: `/api/pours/${pourId}/drinker`, cookies: adminCookies,
        payload: { drinkerId: 999999 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s for an unknown pour id', async () => {
      const res = await app.inject({
        method: 'PATCH', url: '/api/pours/999999/drinker', cookies: adminCookies, payload: { drinkerId: null },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
