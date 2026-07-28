import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Phase 5 Task 4: GET /api/automations/templates, POST /api/automations/from-template,
// full automations CRUD (editor role, per the plan's Global Constraints), and
// POST /api/automations/:id/run (synthetic-ctx test-run). Every mutating route emits
// `automations_changed` on the bus so the live engine picks up the edit (Task 3's
// engine already subscribes + calls reloadRules() -- this is the emission side).
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

describe('GET /api/automations/templates', () => {
  it('lists all 9 templates with id/label/description/params', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/automations/templates', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(9);
    expect(body.find((t: any) => t.id === 'keg_low')).toMatchObject({
      id: 'keg_low', label: expect.any(String), description: expect.any(String),
      params: [{ name: 'thresholdPct', label: expect.any(String), type: 'number', default: 15 }],
    });
    // build/paramsSchema are not serializable and must not leak
    expect(body[0].build).toBeUndefined();
    expect(body[0].paramsSchema).toBeUndefined();
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/automations/templates' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/automations/from-template', () => {
  it('creates a rule from a single-rule template with default params and emits automations_changed', async () => {
    const events: unknown[] = [];
    app.ctx.bus.on('automations_changed', (e) => events.push(e));

    const res = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'keg_low' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.automations).toHaveLength(1);
    expect(body.automations[0]).toMatchObject({ name: expect.stringContaining('Keg low'), isAlert: true });
    expect(events).toHaveLength(1);

    const list = await app.inject({ method: 'GET', url: '/api/automations', cookies: adminCookies });
    expect(list.json()).toHaveLength(1);
  });

  it('accepts custom params', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'keg_low', params: { thresholdPct: 25 } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().automations[0].trigger).toMatchObject({ thresholdPct: 25 });
  });

  it('a multi-rule template (temp_out_of_range) creates 2 automations from one call', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'temp_out_of_range', params: { minTemp: 1, maxTemp: 8 } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().automations).toHaveLength(2);
  });

  it('404s for an unknown template id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s for invalid params', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'keg_low', params: { thresholdPct: 500 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires editor role -- viewer gets 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: viewerCookies,
      payload: { template: 'keg_low' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('automations CRUD', () => {
  it('GET /api/automations lists rules; GET /api/automations/:id fetches one; 404 for unknown', async () => {
    await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'new_keg_tapped' },
    });
    const list = await app.inject({ method: 'GET', url: '/api/automations', cookies: viewerCookies });
    expect(list.json()).toHaveLength(1);
    const id = list.json()[0].id;

    const one = await app.inject({ method: 'GET', url: `/api/automations/${id}`, cookies: viewerCookies });
    expect(one.statusCode).toBe(200);
    expect(one.json().id).toBe(id);

    const missing = await app.inject({ method: 'GET', url: '/api/automations/999999', cookies: viewerCookies });
    expect(missing.statusCode).toBe(404);
  });

  it('POST /api/automations creates a rule from a raw body and emits automations_changed', async () => {
    const events: unknown[] = [];
    app.ctx.bus.on('automations_changed', (e) => events.push(e));

    const res = await app.inject({
      method: 'POST', url: '/api/automations', cookies: adminCookies,
      payload: {
        name: 'Banner on pour',
        trigger: { type: 'pour_completed' },
        actions: [{
          type: 'wall_banner', text: '{{beer.name}} poured', kind: 'celebrate', durationMs: 6000,
        }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Banner on pour', enabled: true });
    expect(events).toHaveLength(1);
  });

  it('POST /api/automations 400s on an invalid rule body', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/automations', cookies: adminCookies,
      payload: { name: 'Bad', trigger: { type: 'not_a_real_trigger' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/automations/:id updates a rule and emits automations_changed', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'new_keg_tapped' },
    });
    const id = created.json().automations[0].id;

    const events: unknown[] = [];
    app.ctx.bus.on('automations_changed', (e) => events.push(e));

    const res = await app.inject({
      method: 'PATCH', url: `/api/automations/${id}`, cookies: adminCookies,
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('PATCH /api/automations/:id 404s for an unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/automations/999999', cookies: adminCookies, payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/automations/:id removes the rule and emits automations_changed', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'new_keg_tapped' },
    });
    const id = created.json().automations[0].id;

    const events: unknown[] = [];
    app.ctx.bus.on('automations_changed', (e) => events.push(e));

    const res = await app.inject({ method: 'DELETE', url: `/api/automations/${id}`, cookies: adminCookies });
    expect(res.statusCode).toBe(204);
    expect(events).toHaveLength(1);

    const list = await app.inject({ method: 'GET', url: '/api/automations', cookies: adminCookies });
    expect(list.json()).toHaveLength(0);
  });

  it('requires authentication -- no cookie gets 401 on every route', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/automations' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/automations', payload: {} })).statusCode).toBe(401);
  });

  it('requires editor role for mutations -- viewer gets 403 on POST/PATCH/DELETE', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/automations/from-template', cookies: adminCookies,
      payload: { template: 'new_keg_tapped' },
    });
    const id = created.json().automations[0].id;

    expect((await app.inject({
      method: 'POST', url: '/api/automations', cookies: viewerCookies, payload: {},
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'PATCH', url: `/api/automations/${id}`, cookies: viewerCookies, payload: {},
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'DELETE', url: `/api/automations/${id}`, cookies: viewerCookies,
    })).statusCode).toBe(403);
  });
});

describe('POST /api/automations/:id/run', () => {
  it('runs the rule against a synthetic ctx and returns per-action results', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/automations', cookies: adminCookies,
      payload: {
        name: 'Banner test',
        trigger: { type: 'pour_completed' },
        actions: [{
          type: 'wall_banner', text: '{{beer.name}} poured', kind: 'celebrate',
        }],
      },
    });
    const id = created.json().id;

    const res = await app.inject({ method: 'POST', url: `/api/automations/${id}/run`, cookies: adminCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [{ type: 'wall_banner', ok: true }] });
  });

  it('a manual run does not mark the rule as fired (lastFiredAt unchanged)', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/automations', cookies: adminCookies,
      payload: {
        name: 'Banner test',
        trigger: { type: 'pour_completed' },
        actions: [{ type: 'wall_banner', text: 'x', kind: 'info' }],
      },
    });
    const id = created.json().id;
    await app.inject({ method: 'POST', url: `/api/automations/${id}/run`, cookies: adminCookies });

    const after = await app.inject({ method: 'GET', url: `/api/automations/${id}`, cookies: adminCookies });
    expect(after.json().lastFiredAt).toBeNull();
  });

  it('404s for an unknown id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/automations/999999/run', cookies: adminCookies });
    expect(res.statusCode).toBe(404);
  });

  it('requires editor role -- viewer gets 403', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/automations', cookies: adminCookies,
      payload: {
        name: 'X', trigger: { type: 'pour_completed' }, actions: [],
      },
    });
    const id = created.json().id;
    const res = await app.inject({ method: 'POST', url: `/api/automations/${id}/run`, cookies: viewerCookies });
    expect(res.statusCode).toBe(403);
  });
});
