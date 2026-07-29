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

describe('sources routes', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(res.statusCode).toBe(401);
  });

  it('returns source status list for a logged-in viewer', async () => {
    const setup = await app.inject({
      method: 'POST', url: '/api/auth/setup',
      payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
    });
    const cookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };

    const res = await app.inject({ method: 'GET', url: '/api/sources', cookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(6);
    for (const entry of body) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('registered');
      expect(entry).toHaveProperty('healthy');
      expect(entry).toHaveProperty('detail');
      expect(entry).toHaveProperty('lastEventAt');
    }
  });

  it('reflects live status from ctx.sources via the bus', async () => {
    const setup = await app.inject({
      method: 'POST', url: '/api/auth/setup',
      payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
    });
    const cookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };

    app.ctx.bus.emit('source_status', {
      source: 'kegtron_udp', healthy: false, detail: 'no packets', ts: '2026-07-27T00:00:00.000Z',
    });

    const res = await app.inject({ method: 'GET', url: '/api/sources', cookies });
    const entry = res.json().find((s: any) => s.name === 'kegtron_udp');
    expect(entry.healthy).toBe(false);
    expect(entry.detail).toBe('no packets');
  });
});
