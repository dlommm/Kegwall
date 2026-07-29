import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import {
  mkdtempSync, existsSync, writeFileSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BOUNDARY = 'ktdashtestboundary';

/** Same hand-built multipart helper as tests/routes/uploads.test.ts — see that file's
 * doc comment for why (no `form-data` dep, `app.inject` has no multipart helper). */
function multipartBody(filename: string, mimetype: string, fileBuf: Buffer): Buffer {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
    + `Content-Type: ${mimetype}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  return Buffer.concat([head, fileBuf, tail]);
}

function multipartHeaders() {
  return { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const VALID_DB_BYTES = Buffer.concat([SQLITE_HEADER, Buffer.alloc(100, 1)]);

let app: FastifyInstance;
let dataDir: string;
let adminCookies: { session: string };

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ktdash-'));
  app = await buildApp({ dataDir });
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  adminCookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };
});
afterEach(async () => { await app.close(); });

async function loginAsEditor(): Promise<{ session: string }> {
  await app.inject({
    method: 'POST', url: '/api/users', cookies: adminCookies,
    payload: { username: 'ed', displayName: 'Ed', password: 'password1', role: 'editor' },
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'ed', password: 'password1' },
  });
  return { session: login.cookies.find((c: any) => c.name === 'session')!.value };
}

describe('GET /api/admin/backup', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/backup' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-admin (editor) request with 403', async () => {
    const editorCookies = await loginAsEditor();
    const res = await app.inject({ method: 'GET', url: '/api/admin/backup', cookies: editorCookies });
    expect(res.statusCode).toBe(403);
  });

  it('streams a valid, openable SQLite snapshot of the live data with a dated filename', async () => {
    await app.inject({
      method: 'POST', url: '/api/beers', cookies: adminCookies, payload: { name: 'Snapshot Beer' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/backup', cookies: adminCookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="kegwall-backup-\d{4}-\d{2}-\d{2}\.db"$/,
    );

    const verifyDir = mkdtempSync(join(tmpdir(), 'ktdash-verify-'));
    const snapPath = join(verifyDir, 'snapshot.db');
    writeFileSync(snapPath, res.rawPayload);

    const snap = new Database(snapPath, { readonly: true });
    const beers = snap.prepare('SELECT name FROM beers').all();
    expect(beers).toEqual([{ name: 'Snapshot Beer' }]);
    // Proves it's a REAL, fully-migrated database, not just a beers-table dump.
    const tables = snap.prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all().map((r: any) => r.name);
    expect(tables).toContain('schema_migrations');
    expect(tables).toContain('users');
    snap.close();
  });
});

describe('POST /api/admin/restore', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/restore',
      headers: multipartHeaders(), payload: multipartBody('restore.db', 'application/octet-stream', VALID_DB_BYTES),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-admin (editor) request with 403', async () => {
    const editorCookies = await loginAsEditor();
    const res = await app.inject({
      method: 'POST', url: '/api/admin/restore', cookies: editorCookies,
      headers: multipartHeaders(), payload: multipartBody('restore.db', 'application/octet-stream', VALID_DB_BYTES),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a file that does not start with the SQLite magic header, with 400, and stages nothing', async () => {
    const bad = Buffer.concat([Buffer.from('not a database, just text'), Buffer.alloc(50, 0)]);
    const res = await app.inject({
      method: 'POST', url: '/api/admin/restore', cookies: adminCookies,
      headers: multipartHeaders(), payload: multipartBody('restore.db', 'application/octet-stream', bad),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
    expect(existsSync(join(dataDir, 'pending-restore.db'))).toBe(false);
  });

  it('validates by magic bytes, not the declared mimetype header', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/restore', cookies: adminCookies,
      // Content-Type header lies (claims image/png); the actual bytes are a real SQLite header.
      headers: multipartHeaders(), payload: multipartBody('restore.db', 'image/png', VALID_DB_BYTES),
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a file with a valid SQLite magic header, stages it byte-for-byte, and tells the admin to restart', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/restore', cookies: adminCookies,
      headers: multipartHeaders(), payload: multipartBody('restore.db', 'application/octet-stream', VALID_DB_BYTES),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.message.toLowerCase()).toContain('restart');

    const pendingPath = join(dataDir, 'pending-restore.db');
    expect(existsSync(pendingPath)).toBe(true);
    expect(readFileSync(pendingPath).equals(VALID_DB_BYTES)).toBe(true);
  });

  it("accepts a file larger than the label-upload endpoint's 5MB default (proves the "
    + 'per-call 50MB override on req.file() actually raises the ceiling, rather than just '
    + "inheriting uploads.ts's plugin-registration default)", async () => {
    const overFiveMb = Buffer.concat([SQLITE_HEADER, Buffer.alloc(6 * 1024 * 1024, 1)]);
    const res = await app.inject({
      method: 'POST', url: '/api/admin/restore', cookies: adminCookies,
      headers: multipartHeaders(), payload: multipartBody('restore.db', 'application/octet-stream', overFiveMb),
    });
    expect(res.statusCode).toBe(200);
    expect(existsSync(join(dataDir, 'pending-restore.db'))).toBe(true);
  });

  it('rejects a file over the 50MB limit with 413 and stages nothing', async () => {
    const oversized = Buffer.concat([SQLITE_HEADER, Buffer.alloc(51 * 1024 * 1024, 1)]);
    const res = await app.inject({
      method: 'POST', url: '/api/admin/restore', cookies: adminCookies,
      headers: multipartHeaders(), payload: multipartBody('big.db', 'application/octet-stream', oversized),
    });
    expect(res.statusCode).toBe(413);
    expect(existsSync(join(dataDir, 'pending-restore.db'))).toBe(false);
  });

  it("doesn't disturb the label-upload endpoint's own 5MB limit (proves the per-call override "
    + "doesn't leak back into uploads.ts's registration)", async () => {
    const oversizedLabel = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(6 * 1024 * 1024, 1),
    ]);
    const res = await app.inject({
      method: 'POST', url: '/api/uploads/label', cookies: adminCookies,
      headers: multipartHeaders(), payload: multipartBody('big.png', 'image/png', oversizedLabel),
    });
    expect(res.statusCode).toBe(413);
  });
});
