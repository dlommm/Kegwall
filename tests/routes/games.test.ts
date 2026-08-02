import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app.js';
import { createDrinker } from '../../src/server/db/users.js';

let app: FastifyInstance;
let adminCookies: { session: string };
let viewerCookies: { session: string };

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktgames-')) });
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup', payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  adminCookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };
  await app.inject({
    method: 'POST', url: '/api/users', cookies: adminCookies,
    payload: { username: 'vw', displayName: 'Vw', password: 'password1', role: 'viewer' },
  });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'vw', password: 'password1' } });
  viewerCookies = { session: login.cookies.find((c: any) => c.name === 'session')!.value };
});
afterEach(async () => { await app.close(); });

describe('games routes', () => {
  it('lists the seeded 100-game catalog for a viewer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games', cookies: viewerCookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(100);
    expect(res.json().some((g: any) => g.name === 'Keg Race')).toBe(true);
  });

  it('a viewer cannot start a game (editor only)', async () => {
    const games = (await app.inject({ method: 'GET', url: '/api/games', cookies: viewerCookies })).json();
    const res = await app.inject({
      method: 'POST', url: '/api/games/sessions', cookies: viewerCookies, payload: { gameId: games[0].id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('starts a game with participants, exposes it as active, blocks a second, then ends it', async () => {
    const games = (await app.inject({ method: 'GET', url: '/api/games', cookies: adminCookies })).json();
    const kegRace = games.find((g: any) => g.name === 'Keg Race');
    const alice = createDrinker(app.ctx.db, { displayName: 'Alice' });

    const start = await app.inject({
      method: 'POST', url: '/api/games/sessions', cookies: adminCookies,
      payload: { gameId: kegRace.id, participantDrinkerIds: [alice.id], settings: { targetOz: 100 } },
    });
    expect(start.statusCode).toBe(201);
    const sessionId = start.json().session.id;
    expect(start.json().participants).toHaveLength(1);

    const active = await app.inject({ method: 'GET', url: '/api/games/active', cookies: viewerCookies });
    expect(active.json().game.name).toBe('Keg Race');
    expect(active.json().session.settings).toEqual({ targetOz: 100 });

    // Only one game at a time.
    const second = await app.inject({
      method: 'POST', url: '/api/games/sessions', cookies: adminCookies, payload: { gameId: kegRace.id },
    });
    expect(second.statusCode).toBe(409);

    const end = await app.inject({
      method: 'POST', url: `/api/games/sessions/${sessionId}/end`, cookies: adminCookies,
      payload: { results: [{ drinkerId: alice.id, score: 100, rank: 1 }] },
    });
    expect(end.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/games/active', cookies: viewerCookies })).json()).toBeNull();
  });

  it('serves the public game strip, null when idle and hydrated when running', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/public/game' })).json()).toBeNull();

    const games = (await app.inject({ method: 'GET', url: '/api/games', cookies: adminCookies })).json();
    const alice = createDrinker(app.ctx.db, { displayName: 'Alice' });
    await app.inject({
      method: 'POST', url: '/api/games/sessions', cookies: adminCookies,
      payload: { gameId: games[0].id, participantDrinkerIds: [alice.id] },
    });
    const strip = await app.inject({ method: 'GET', url: '/api/public/game' });
    expect(strip.json().gameName).toBe(games[0].name);
    expect(strip.json().players[0].displayName).toBe('Alice');
    expect(strip.json().players[0].volumeMl).toBe(0);
  });
});
