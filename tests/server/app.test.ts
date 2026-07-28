import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

describe('app', () => {
  it('responds to health check', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('SqliteError mapping in the global error handler', () => {
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

  it('maps a duplicate wall slug UNIQUE violation to 409 conflict, naming the field', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/walls', cookies: adminCookies,
      payload: { slug: 'main', name: 'Main Wall', config: {} },
    });
    expect(first.statusCode).toBe(201);

    const dupe = await app.inject({
      method: 'POST', url: '/api/walls', cookies: adminCookies,
      payload: { slug: 'main', name: 'Second Wall', config: {} },
    });
    expect(dupe.statusCode).toBe(409);
    const body = dupe.json();
    expect(body.error).toBe('conflict');
    expect(body.message).toContain('walls.slug');
    // never leaks the raw SQL statement
    expect(body.message).not.toMatch(/INSERT INTO|UNIQUE constraint failed/i);
  });

  it('maps a duplicate tap number UNIQUE violation to 409 conflict, naming the field', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
    });
    expect(first.statusCode).toBe(201);

    const dupe = await app.inject({
      method: 'POST', url: '/api/taps', cookies: adminCookies, payload: { number: 1 },
    });
    expect(dupe.statusCode).toBe(409);
    const body = dupe.json();
    expect(body.error).toBe('conflict');
    expect(body.message).toContain('taps.number');
    expect(body.message).not.toMatch(/INSERT INTO|UNIQUE constraint failed/i);
  });

  it('maps a foreign key violation to 400 validation without leaking raw SQL', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/kegs', cookies: adminCookies,
      payload: { beerId: 999999, sizeMl: 19000, volStartMl: 19000 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('validation');
    expect(body.message).not.toMatch(/INSERT INTO|FOREIGN KEY constraint failed/i);
  });
});
