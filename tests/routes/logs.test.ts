import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../../src/server/db/users.js';
import { insertLog } from '../../src/server/db/logs.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: FastifyInstance;
let cookies: Record<string, string>;

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  createUser(app.ctx.db, {
    username: 'admin', displayName: 'Admin', password: 'hunter22', role: 'admin',
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'hunter22' },
  });
  const sessionCookie = login.cookies.find((c) => c.name === 'session')!;
  cookies = { [sessionCookie.name]: sessionCookie.value };
});
afterEach(async () => { await app.close(); });

describe('GET /api/logs', () => {
  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/logs' });
    expect(res.statusCode).toBe(401);
  });

  it('returns entries with level counts, total and retention', async () => {
    insertLog(app.ctx.db, { level: 'info', source: 'app', message: 'hello world' });
    insertLog(app.ctx.db, { level: 'error', source: 'kegtron', message: 'cloud timeout', detail: 'req 123' });
    const res = await app.inject({ method: 'GET', url: '/api/logs', cookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.counts.error).toBe(1);
    expect(body.total).toBe(2);
    expect(body.retentionDays).toBe(30);
  });

  it('filters by sources/levels/search', async () => {
    insertLog(app.ctx.db, { level: 'info', source: 'pours', message: 'Pour complete' });
    insertLog(app.ctx.db, { level: 'error', source: 'kegtron', message: 'cloud timeout' });
    const res = await app.inject({
      method: 'GET', url: '/api/logs?sources=kegtron&levels=error&q=timeout', cookies,
    });
    expect(res.json().entries).toHaveLength(1);
    expect(res.json().entries[0].source).toBe('kegtron');
  });

  it('exports CSV with a download disposition', async () => {
    insertLog(app.ctx.db, { level: 'info', source: 'app', message: 'has, comma' });
    const res = await app.inject({ method: 'GET', url: '/api/logs?format=csv', cookies });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('kegtron-logs.csv');
    expect(res.body.split('\n')[0]).toBe('ts,level,source,message,detail');
    expect(res.body).toContain('"has, comma"');
  });

  it('an error-level log auto-creates a notification (design footer)', async () => {
    app.ctx.log.error('kegtron', 'Cloud API timeout after 10s');
    const count = (app.ctx.db.prepare('SELECT COUNT(*) c FROM notifications').get() as any).c;
    expect(count).toBe(1);
    const res = await app.inject({ method: 'GET', url: '/api/logs?levels=error', cookies });
    expect(res.json().entries[0].message).toContain('timeout');
  });

  it('an UNCONFIGURED source going unhealthy logs a warn, not an error — no notification', async () => {
    app.ctx.bus.emit('source_status', {
      source: 'kegtron_cloud', healthy: false, detail: 'no API key configured',
      unconfigured: true, ts: new Date().toISOString(),
    });
    expect((app.ctx.db.prepare('SELECT COUNT(*) c FROM notifications').get() as any).c).toBe(0);
    const res = await app.inject({ method: 'GET', url: '/api/logs?levels=warn', cookies });
    expect(res.json().entries[0].message).toContain('no API key configured');

    // A genuinely failing (configured) source still errors + notifies.
    app.ctx.bus.emit('source_status', {
      source: 'kegtron_cloud', healthy: true, detail: 'connected', ts: new Date().toISOString(),
    });
    app.ctx.bus.emit('source_status', {
      source: 'kegtron_cloud', healthy: false, detail: 'customer fetch failed: 503',
      ts: new Date().toISOString(),
    });
    expect((app.ctx.db.prepare('SELECT COUNT(*) c FROM notifications').get() as any).c).toBe(1);
  });
});
