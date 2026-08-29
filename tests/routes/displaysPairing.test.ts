import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { FastifyInstance } from 'fastify';
import { createUser } from '../../src/server/db/users.js';
import {
  getDisplay, pairDisplay, isPairCodeExpired, PAIR_CODE_TTL_MS,
} from '../../src/server/db/displays.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Pairing-code hardening (server-hardening review, 2026-08-29):
//   1. the code value never lands in the app log (the log is viewer-readable via
//      routes/logs.ts — a logged code was a leaked code);
//   2. codes expire PAIR_CODE_TTL_MS after they're minted, so a leaked code can't
//      rotate the display's token forever (token-rotation DoS);
//   3. an editor re-opens the window via POST /api/displays/:id/regenerate-code.
// Same buildApp + login harness as tests/routes/placesDisplays.test.ts.
// ---------------------------------------------------------------------------

let app: FastifyInstance;
let cookies: Record<string, string>;

beforeEach(async () => {
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'ktdash-')) });
  await createUser(app.ctx.db, {
    username: 'admin', displayName: 'Admin', password: 'hunter22', role: 'admin',
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'hunter22' },
  });
  const sessionCookie = login.cookies.find((c) => c.name === 'session')!;
  cookies = { [sessionCookie.name]: sessionCookie.value };
});
afterEach(async () => { await app.close(); });

async function createTestDisplay(name = 'Bar TV'): Promise<{ id: number; code: string }> {
  const created = await app.inject({
    method: 'POST', url: '/api/displays', payload: { name }, cookies,
  });
  expect(created.statusCode).toBe(201);
  return created.json();
}

/** Backdates the display's current code past its TTL, as if it was minted long ago. */
function expireCode(id: number): void {
  app.ctx.db.prepare('UPDATE displays SET code_issued_at = ? WHERE id = ?')
    .run(new Date(Date.now() - PAIR_CODE_TTL_MS - 60_000).toISOString(), id);
}

function logMessages(): string[] {
  return (app.ctx.db.prepare('SELECT message FROM logs').all() as { message: string }[])
    .map((r) => r.message);
}

describe('pairing-code log hygiene', () => {
  it('never writes the code value into the app log (create, pair, regenerate)', async () => {
    const display = await createTestDisplay();
    const paired = await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: display.code },
    });
    expect(paired.statusCode).toBe(200);
    const regen = await app.inject({
      method: 'POST', url: `/api/displays/${display.id}/regenerate-code`, cookies,
    });
    expect(regen.statusCode).toBe(200);

    const messages = logMessages();
    // The lifecycle IS logged — just without the secret.
    expect(messages.some((m) => m.includes('created'))).toBe(true);
    expect(messages.some((m) => m.includes('paired'))).toBe(true);
    for (const code of [display.code, regen.json().code]) {
      expect(messages.some((m) => m.includes(code))).toBe(false);
    }
  });
});

describe('pairing-code expiry', () => {
  it('pairs normally while the code is inside its TTL window', async () => {
    const display = await createTestDisplay();
    const paired = await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: display.code },
    });
    expect(paired.statusCode).toBe(200);
    expect(paired.json().token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('410s an expired code with a "regenerate it" message, and mints no token', async () => {
    const display = await createTestDisplay();
    expireCode(display.id);
    const paired = await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: display.code },
    });
    expect(paired.statusCode).toBe(410);
    expect(paired.json()).toMatchObject({ error: 'expired' });
    expect(getDisplay(app.ctx.db, display.id)!.pairedAt).toBeNull();
  });

  it('pairDisplay itself fails closed on an expired code (not just the route pre-check)', async () => {
    const display = await createTestDisplay();
    expireCode(display.id);
    expect(pairDisplay(app.ctx.db, display.code)).toBeNull();
    expect(isPairCodeExpired(getDisplay(app.ctx.db, display.id)!)).toBe(true);
  });

  it('still 404s a code that never existed', async () => {
    const paired = await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: 'ZZZZZZ' },
    });
    expect(paired.statusCode).toBe(404);
  });
});

describe('POST /api/displays/:id/regenerate-code', () => {
  it('mints a fresh code with a fresh TTL window; the old code stops working', async () => {
    const display = await createTestDisplay();
    expireCode(display.id);

    const regen = await app.inject({
      method: 'POST', url: `/api/displays/${display.id}/regenerate-code`, cookies,
    });
    expect(regen.statusCode).toBe(200);
    const fresh = regen.json();
    expect(fresh.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(fresh.code).not.toBe(display.code);

    const oldCode = await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: display.code },
    });
    expect(oldCode.statusCode).toBe(404); // old code no longer exists at all

    const paired = await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: fresh.code },
    });
    expect(paired.statusCode).toBe(200);
    expect(paired.json().token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not invalidate an already-paired display\'s token', async () => {
    const display = await createTestDisplay();
    const paired = await app.inject({
      method: 'POST', url: '/api/public/display/pair', payload: { code: display.code },
    });
    const tokenHashBefore = app.ctx.db
      .prepare('SELECT token_hash FROM displays WHERE id = ?').get(display.id) as any;
    expect(paired.statusCode).toBe(200);

    await app.inject({
      method: 'POST', url: `/api/displays/${display.id}/regenerate-code`, cookies,
    });
    const tokenHashAfter = app.ctx.db
      .prepare('SELECT token_hash FROM displays WHERE id = ?').get(display.id) as any;
    expect(tokenHashAfter.token_hash).toBe(tokenHashBefore.token_hash);
  });

  it('requires an editor session', async () => {
    const display = await createTestDisplay();
    const anon = await app.inject({
      method: 'POST', url: `/api/displays/${display.id}/regenerate-code`,
    });
    expect(anon.statusCode).toBe(401);
  });

  it('404s an unknown display', async () => {
    const missing = await app.inject({
      method: 'POST', url: '/api/displays/999/regenerate-code', cookies,
    });
    expect(missing.statusCode).toBe(404);
  });
});
