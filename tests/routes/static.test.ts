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

  it('a missing /labels/* file 404s instead of falling back to the SPA shell '
    + '(regression: @fastify/static calls reply.callNotFound() for a missing file, which '
    + 'without this exclusion would be swallowed by the SPA fallback notFoundHandler below, '
    + 'incorrectly returning 200 + index.html for a nonexistent label)', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'ktdash-web-'));
    writeFileSync(join(webDir, 'index.html'), '<html><body>wall</body></html>');
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')), webDir });
    const res = await app.inject({ method: 'GET', url: '/labels/does-not-exist.png' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('wall');
  });

  it('serves index.html when webDir is a relative path', async () => {
    // Regression test: @fastify/static requires an absolute `root`. index.ts's default
    // (and any relative WEB_DIR override) must be resolved before reaching it, or the
    // server crashes with FST_STATIC_INVALID_OPTION as soon as dist/web exists. Every
    // other case in this file passes an already-absolute mkdtempSync() path, which
    // would stay green even if that resolve() were reverted — this one exercises a
    // genuinely relative webDir so a regression here actually fails.
    const parentDir = mkdtempSync(join(tmpdir(), 'ktdash-relweb-'));
    const relativeWebDir = 'web';
    mkdirSync(join(parentDir, relativeWebDir));
    writeFileSync(join(parentDir, relativeWebDir, 'index.html'), '<html><body>relative wall</body></html>');

    const originalCwd = process.cwd();
    process.chdir(parentDir);
    try {
      app = await buildApp({
        dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')),
        webDir: relativeWebDir,
      });
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('relative wall');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
