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
// Orthogonal to EMB (nonzero only where EMB is zero) → cosine 0 → never matches.
const ORTHO = EMB.map((_, i) => (i === 0 ? 1 : 0));

function enable() { app.ctx.settings.set('faceSignIn', { enabled: true, threshold: 0.6 }); }
function arm(id: number) {
  return app.inject({ method: 'POST', url: '/api/public/tablet/arm', payload: { drinkerId: id } });
}
function enroll(id: number, embedding: number[] = EMB) {
  return app.inject({ method: 'POST', url: '/api/public/faces', payload: { drinkerId: id, embedding } });
}

describe('/api/public/faces', () => {
  it('GET reports only whether the feature is enabled — never the vectors', async () => {
    expect((await app.inject({ url: '/api/public/faces' })).json()).toEqual({ enabled: false });
    enable();
    await arm(drinkerId);
    await enroll(drinkerId);
    const after = (await app.inject({ url: '/api/public/faces' })).json();
    expect(after).toEqual({ enabled: true }); // no `faces`, no `threshold` — the corpus never leaves the server
  });

  it('enroll 403s while disabled', async () => {
    expect((await enroll(drinkerId)).statusCode).toBe(403);
  });

  it('enroll requires the drinker to be ARMED at the kiosk (anti-impersonation, anti-eviction)', async () => {
    enable();
    expect((await enroll(drinkerId)).statusCode).toBe(403); // not armed
    const other = (await app.inject({
      method: 'POST', url: '/api/public/pourers', payload: { name: 'Eve' },
    })).json().id;
    await arm(other);
    expect((await enroll(drinkerId)).statusCode).toBe(403); // armed as someone else

    const scopes: string[] = [];
    app.ctx.bus.on('state_changed', (e) => scopes.push(e.scope));
    await arm(drinkerId);
    expect((await enroll(drinkerId)).statusCode).toBe(201); // armed as the target
    expect(scopes).toContain('faces');
  });

  it('enroll 400s for a bad embedding (while armed)', async () => {
    enable();
    await arm(drinkerId);
    expect((await enroll(drinkerId, [1, 2])).statusCode).toBe(400);
  });

  it('GET /faces/enrolled/:id reports a boolean, never a vector', async () => {
    enable();
    expect((await app.inject({ url: `/api/public/faces/enrolled/${drinkerId}` })).json())
      .toEqual({ enrolled: false });
    await arm(drinkerId);
    await enroll(drinkerId);
    expect((await app.inject({ url: `/api/public/faces/enrolled/${drinkerId}` })).json())
      .toEqual({ enrolled: true });
  });

  it('POST /match runs server-side: matches a probe, returns only {drinkerId, score}, 403s while disabled', async () => {
    expect((await app.inject({
      method: 'POST', url: '/api/public/faces/match', payload: { embedding: EMB },
    })).statusCode).toBe(403);

    enable();
    await arm(drinkerId);
    await enroll(drinkerId);

    const hit = await app.inject({ method: 'POST', url: '/api/public/faces/match', payload: { embedding: EMB } });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().match).toMatchObject({ drinkerId });
    expect(Object.keys(hit.json().match)).toEqual(['drinkerId', 'score']); // no embedding echoed back

    const miss = await app.inject({ method: 'POST', url: '/api/public/faces/match', payload: { embedding: ORTHO } });
    expect(miss.json().match).toBeNull();
  });

  it('public DELETE requires armed + enabled (self-service at the kiosk)', async () => {
    enable();
    await arm(drinkerId);
    await enroll(drinkerId);
    expect((await app.inject({
      method: 'DELETE', url: `/api/public/faces/drinker/${drinkerId}`,
    })).json()).toEqual({ deleted: 1 });
  });

  it('admin DELETE /api/faces/drinker/:id is admin-gated and deletes anyone\'s data', async () => {
    enable();
    await arm(drinkerId);
    await enroll(drinkerId);
    await app.inject({ method: 'DELETE', url: '/api/public/tablet/arm' }); // disarm — admin isn't at the kiosk

    expect((await app.inject({ method: 'DELETE', url: `/api/faces/drinker/${drinkerId}` })).statusCode).toBe(401);

    const setup = await app.inject({
      method: 'POST', url: '/api/auth/setup',
      payload: { username: 'a', displayName: 'A', password: 'password1' },
    });
    const cookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };
    const del = await app.inject({ method: 'DELETE', url: `/api/faces/drinker/${drinkerId}`, cookies });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(1);
  });
});
