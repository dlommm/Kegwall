import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
let drinkerId: number;
beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const res = await app.inject({ method: 'POST', url: '/api/public/pourers', payload: { name: 'Dave' } });
  drinkerId = res.json().id;
});
afterEach(async () => { await app.close(); });

const EMB = Array.from({ length: 64 }, (_, i) => i / 64);

describe('/api/public/faces', () => {
  it('GET reports disabled with empty faces by default', async () => {
    const res = await app.inject({ url: '/api/public/faces' });
    expect(res.json()).toEqual({ enabled: false, threshold: 0.6, faces: [] });
  });

  it('POST 403s while disabled', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/public/faces', payload: { drinkerId, embedding: EMB },
    });
    expect(res.statusCode).toBe(403);
  });

  it('enroll + list round-trip when enabled, and emits faces state_changed', async () => {
    app.ctx.settings.set('faceSignIn', { enabled: true, threshold: 0.6 });
    const scopes: string[] = [];
    app.ctx.bus.on('state_changed', (e) => scopes.push(e.scope));
    const post = await app.inject({
      method: 'POST', url: '/api/public/faces', payload: { drinkerId, embedding: EMB },
    });
    expect(post.statusCode).toBe(201);
    const get = await app.inject({ url: '/api/public/faces' });
    expect(get.json().enabled).toBe(true);
    expect(get.json().faces).toHaveLength(1);
    expect(get.json().faces[0]).toMatchObject({ drinkerId });
    expect(scopes).toContain('faces');
  });

  it('POST 404s for an unknown drinker and 400s for a bad embedding', async () => {
    app.ctx.settings.set('faceSignIn', { enabled: true, threshold: 0.6 });
    expect((await app.inject({
      method: 'POST', url: '/api/public/faces', payload: { drinkerId: 9999, embedding: EMB },
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'POST', url: '/api/public/faces', payload: { drinkerId, embedding: [1, 2] },
    })).statusCode).toBe(400);
  });

  it('DELETE works even while disabled (privacy) and reports count', async () => {
    app.ctx.settings.set('faceSignIn', { enabled: true, threshold: 0.6 });
    await app.inject({ method: 'POST', url: '/api/public/faces', payload: { drinkerId, embedding: EMB } });
    app.ctx.settings.set('faceSignIn', { enabled: false, threshold: 0.6 });
    const res = await app.inject({ method: 'DELETE', url: `/api/public/faces/drinker/${drinkerId}` });
    expect(res.json()).toEqual({ deleted: 1 });
  });
});
