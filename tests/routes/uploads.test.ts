import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BOUNDARY = 'ktdashtestboundary';

/** Hand-builds a minimal multipart/form-data body for a single `file` field — `light-my-
 * request` (what `app.inject` uses) has no built-in multipart helper, and this repo has no
 * `form-data` dependency to reach for instead. */
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

// A real PNG signature followed by filler bytes -- magic-byte validation only inspects
// the header, so the rest of the file need not be a structurally valid image.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

let app: FastifyInstance;
let editorCookies: { session: string };

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  const setup = await app.inject({
    method: 'POST', url: '/api/auth/setup',
    payload: { username: 'dan', displayName: 'Dan', password: 'hunter22' },
  });
  editorCookies = { session: setup.cookies.find((c: any) => c.name === 'session')!.value };
});
afterEach(async () => { await app.close(); });

describe('POST /api/uploads/label', () => {
  it('rejects an unauthenticated upload with 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/uploads/label',
      headers: multipartHeaders(),
      payload: multipartBody('label.png', 'image/png', PNG_BYTES),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a viewer-role upload with 403', async () => {
    await app.inject({
      method: 'POST', url: '/api/users', cookies: editorCookies,
      payload: { username: 'v', displayName: 'V', password: 'password1', role: 'viewer' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'v', password: 'password1' },
    });
    const viewerCookies = { session: login.cookies.find((c: any) => c.name === 'session')!.value };
    const res = await app.inject({
      method: 'POST', url: '/api/uploads/label', cookies: viewerCookies,
      headers: multipartHeaders(),
      payload: multipartBody('label.png', 'image/png', PNG_BYTES),
    });
    expect(res.statusCode).toBe(403);
  });

  it('uploads a valid PNG and serves it back byte-for-byte under /labels/', async () => {
    const upload = await app.inject({
      method: 'POST', url: '/api/uploads/label', cookies: editorCookies,
      headers: multipartHeaders(),
      payload: multipartBody('label.png', 'image/png', PNG_BYTES),
    });
    expect(upload.statusCode).toBe(201);
    const body = upload.json();
    expect(body.path).toMatch(/^\/labels\/[0-9a-f-]+\.png$/);

    const fetched = await app.inject({ method: 'GET', url: body.path });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('validates by magic bytes, not the declared mimetype header — a mislabeled file still uploads', async () => {
    // Content-Type header claims text/plain but the bytes are a real PNG signature.
    const upload = await app.inject({
      method: 'POST', url: '/api/uploads/label', cookies: editorCookies,
      headers: multipartHeaders(),
      payload: multipartBody('label.png', 'text/plain', PNG_BYTES),
    });
    expect(upload.statusCode).toBe(201);
  });

  it('rejects a file whose magic bytes are not png/jpeg/webp with 400, even with an image/* content-type header', async () => {
    const notAnImage = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(50, 0)]);
    const upload = await app.inject({
      method: 'POST', url: '/api/uploads/label', cookies: editorCookies,
      headers: multipartHeaders(),
      payload: multipartBody('label.gif', 'image/png', notAnImage),
    });
    expect(upload.statusCode).toBe(400);
    expect(upload.json().error).toBe('validation');
  });

  it('rejects a file over the 5MB limit with 413', async () => {
    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(6 * 1024 * 1024, 1),
    ]);
    const upload = await app.inject({
      method: 'POST', url: '/api/uploads/label', cookies: editorCookies,
      headers: multipartHeaders(),
      payload: multipartBody('big.png', 'image/png', oversized),
    });
    expect(upload.statusCode).toBe(413);
  });

  it('works even when webDir is absent', async () => {
    // buildApp() in this file's beforeEach never passes a webDir, so a passing roundtrip
    // test above already proves this -- this test just asserts intent explicitly.
    const res = await app.inject({
      method: 'POST', url: '/api/uploads/label', cookies: editorCookies,
      headers: multipartHeaders(),
      payload: multipartBody('label.webp', 'image/webp',
        Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(20, 1)])),
    });
    expect(res.statusCode).toBe(201);
  });
});
