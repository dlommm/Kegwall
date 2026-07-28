import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
});
afterEach(async () => { await app.close(); });

async function setupAdmin() {
  return app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
}

function cookieOf(res: any): { session: string } {
  const c = res.cookies.find((c: any) => c.name === 'session');
  return { session: c.value };
}

describe('auth routes', () => {
  it('first-run setup creates admin, second call conflicts', async () => {
    expect((await setupAdmin()).statusCode).toBe(201);
    expect((await setupAdmin()).statusCode).toBe(409);
  });

  it('login sets cookie; /me returns the user; logout clears', async () => {
    await setupAdmin();
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'dan', password: 'hunter22' },
    });
    expect(login.statusCode).toBe(200);
    const cookies = cookieOf(login);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(me.json()).toMatchObject({ username: 'dan', role: 'admin' });
    await app.inject({ method: 'POST', url: '/api/auth/logout', cookies });
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(after.statusCode).toBe(401);
  });

  it('rejects bad credentials with 401', async () => {
    await setupAdmin();
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'dan', password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('needs-setup reports true before any login user exists, false after', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/auth/needs-setup' });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ needsSetup: true });

    await setupAdmin();

    const after = await app.inject({ method: 'GET', url: '/api/auth/needs-setup' });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual({ needsSetup: false });
  });

  it('needs-setup requires no auth (public) and never leaks user data', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/needs-setup' });
    expect(Object.keys(res.json())).toEqual(['needsSetup']);
  });
});
