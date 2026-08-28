import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync } from 'node:fs';
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

  it('session cookie is httpOnly + lax + has an explicit maxAge, and Secure only over https', async () => {
    await setupAdmin();
    const plain = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'dan', password: 'hunter22' },
    });
    const plainCookie = plain.cookies.find((c: any) => c.name === 'session')!;
    expect(plainCookie.httpOnly).toBe(true);
    expect(String(plainCookie.sameSite).toLowerCase()).toBe('lax');
    expect(plainCookie.maxAge).toBeGreaterThan(0);
    expect(plainCookie.secure).toBeFalsy(); // plain HTTP → not Secure (LAN install still works)

    const https = await app.inject({
      method: 'POST', url: '/api/auth/login',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { username: 'dan', password: 'hunter22' },
    });
    const httpsCookie = https.cookies.find((c: any) => c.name === 'session')!;
    expect(httpsCookie.secure).toBe(true); // behind a TLS proxy → Secure
  });

  it('rejects bad credentials with 401', async () => {
    await setupAdmin();
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'dan', password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a successful login sweeps expired session rows left by browsers that never returned', async () => {
    // getUserForToken only lazily deletes an expired row when its exact token is
    // presented again — without the login-time sweep, abandoned sessions would pile up
    // in the table forever.
    await setupAdmin();
    const abandoned = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'dan', password: 'hunter22' },
    });
    expect(abandoned.statusCode).toBe(200);
    const db = app.ctx.db;
    db.prepare('UPDATE sessions SET expires_at = ?')
      .run(new Date(Date.now() - 1000).toISOString());

    const fresh = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'dan', password: 'hunter22' },
    });
    expect(fresh.statusCode).toBe(200);
    // Only the just-created session remains — every expired row was swept.
    expect((db.prepare('SELECT COUNT(*) c FROM sessions').get() as any).c).toBe(1);
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

describe('first-run setup claim token (enforced)', () => {
  let tokenApp: FastifyInstance;
  let dataDir: string;
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    tokenApp = await buildApp({ dataDir, requireSetupClaimToken: true });
  });
  afterEach(async () => { await tokenApp.close(); });

  function claimToken(): string {
    return readFileSync(join(dataDir, 'setup-claim-token'), 'utf8').trim();
  }

  const base = { username: 'dan', displayName: 'Dan', password: 'hunter22' };

  it('rejects setup with no token or a wrong token (401), stays unclaimed', async () => {
    expect((await tokenApp.inject({
      method: 'POST', url: '/api/auth/setup', payload: base,
    })).statusCode).toBe(401);
    expect((await tokenApp.inject({
      method: 'POST', url: '/api/auth/setup', payload: { ...base, claimToken: 'nope' },
    })).statusCode).toBe(401);
    expect((await tokenApp.inject({ method: 'GET', url: '/api/auth/needs-setup' })).json())
      .toEqual({ needsSetup: true });
  });

  it('accepts setup with the correct token and consumes it', async () => {
    const ok = await tokenApp.inject({
      method: 'POST', url: '/api/auth/setup', payload: { ...base, claimToken: claimToken() },
    });
    expect(ok.statusCode).toBe(201);
    // Token file is consumed on success.
    expect(() => readFileSync(join(dataDir, 'setup-claim-token'))).toThrow();
    // And setup can't be re-run.
    expect((await tokenApp.inject({
      method: 'POST', url: '/api/auth/setup', payload: { ...base, claimToken: 'anything' },
    })).statusCode).toBe(409);
  });
});
