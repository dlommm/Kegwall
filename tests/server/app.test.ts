import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';

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
