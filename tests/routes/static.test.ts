import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
afterEach(async () => { await app.close(); });

describe('static serving', () => {
  it('serves index.html with SPA fallback when webDir exists', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'ktdash-web-'));
    writeFileSync(join(webDir, 'index.html'), '<html><body>wall</body></html>');
    app = await buildApp({
      dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')), webDir,
    });
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('wall');
    expect((await app.inject({ method: 'GET', url: '/wall/main' })).body).toContain('wall');
    // API routes never fall back to HTML
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(404);
  });

  it('404s cleanly when no webDir', async () => {
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
    expect((await app.inject({ method: 'GET', url: '/wall/main' })).statusCode).toBe(404);
  });
});
