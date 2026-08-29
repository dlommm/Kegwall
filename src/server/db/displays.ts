import type Database from 'better-sqlite3';
import { randomBytes, createHash } from 'node:crypto';
import { NotFoundError } from '../core/errors.js';

/**
 * Displays (design 7c): a paired physical screen. An admin creates one (which
 * mints a short pairing code), the TV opens /display and enters the code, and
 * from then on the display renders its assigned wall with optional per-display
 * overrides (look / theme / takeover style) applied over the wall's config.
 */

export interface DisplayOverrides {
  look?: string;
  themeId?: string;
  takeoverStyle?: string;
}

export interface Display {
  id: number;
  name: string;
  code: string;
  wallId: number | null;
  overrides: DisplayOverrides;
  lastSeen: string | null;
  createdAt: string;
  /** ISO timestamp of the most recent successful pair, or null if never paired. */
  pairedAt: string | null;
  /** ISO timestamp the CURRENT pairing code was minted (creation or admin regeneration).
   * The public pair endpoint only honors the code within PAIR_CODE_TTL_MS of this —
   * see isPairCodeExpired below (server-hardening review, 2026-08-29). */
  codeIssuedAt: string;
}

function rowToDisplay(r: any): Display {
  let overrides: DisplayOverrides = {};
  try {
    overrides = JSON.parse(r.overrides) ?? {};
  } catch {
    overrides = {};
  }
  return {
    id: r.id, name: r.name, code: r.code, wallId: r.wall_id,
    overrides, lastSeen: r.last_seen, createdAt: r.created_at,
    pairedAt: r.paired_at ?? null,
    // Backfill guard only (migration 0NN_pair_code_expiry.sql backfills the column):
    // a NULL code_issued_at is treated as issued-at-creation, same as the migration.
    codeIssuedAt: r.code_issued_at ?? r.created_at,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// No 0/O/1/I — the code gets typed on a TV remote or tablet keyboard.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * How long a pairing code stays claimable after it was minted (creation or
 * regeneration). Codes used to be valid FOREVER, which turned any code leak (a viewer
 * reading old logs, a shoulder-surfed admin page) into a permanent token-rotation DoS —
 * anyone knowing the code could re-pair at will, invalidating the real display's token
 * each time. 15 minutes comfortably covers the real flow (create the display, walk to
 * the TV, type the code) while bounding that exposure; an editor re-opens the window any
 * time via regeneratePairCode (POST /api/displays/:id/regenerate-code).
 */
export const PAIR_CODE_TTL_MS = 15 * 60_000;

/** True when the display's current pairing code is past its claim window. Pure clock
 * math so the route layer can give the TV a distinct "code expired — regenerate it"
 * message instead of a lying "no such code". */
export function isPairCodeExpired(display: Display, nowMs: number = Date.now()): boolean {
  return nowMs - new Date(display.codeIssuedAt).getTime() > PAIR_CODE_TTL_MS;
}

export function generatePairCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

export function listDisplays(db: Database.Database): Display[] {
  return db.prepare('SELECT * FROM displays ORDER BY name').all().map(rowToDisplay);
}

export function getDisplay(db: Database.Database, id: number): Display | null {
  const r = db.prepare('SELECT * FROM displays WHERE id = ?').get(id);
  return r ? rowToDisplay(r) : null;
}

export function getDisplayByCode(db: Database.Database, code: string): Display | null {
  const r = db.prepare('SELECT * FROM displays WHERE code = ?').get(code.toUpperCase());
  return r ? rowToDisplay(r) : null;
}

export function createDisplay(db: Database.Database, input: {
  name: string; wallId?: number | null;
}): Display {
  // Retry on the (vanishingly unlikely) code collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePairCode();
    try {
      const now = new Date().toISOString();
      const res = db.prepare(
        'INSERT INTO displays (name, code, wall_id, overrides, created_at, code_issued_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(input.name, code, input.wallId ?? null, '{}', now, now);
      return getDisplay(db, Number(res.lastInsertRowid))!;
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  throw new Error('unreachable');
}

/**
 * Mints a FRESH pairing code (and restarts its PAIR_CODE_TTL_MS claim window) for an
 * existing display — the editor-facing "my code expired / I need to re-pair this screen"
 * path. Deliberately does NOT touch token_hash: a still-working paired display keeps
 * working; only the pairing window re-opens (the next successful pair rotates the token,
 * exactly as before). Same collision-retry shape as createDisplay.
 */
export function regeneratePairCode(db: Database.Database, id: number): Display {
  if (!getDisplay(db, id)) throw new NotFoundError(`display ${id}`);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePairCode();
    try {
      db.prepare('UPDATE displays SET code = ?, code_issued_at = ? WHERE id = ?')
        .run(code, new Date().toISOString(), id);
      return getDisplay(db, id)!;
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  throw new Error('unreachable');
}

export function updateDisplay(db: Database.Database, id: number, input: {
  name?: string; wallId?: number | null; overrides?: DisplayOverrides;
}): Display {
  const existing = getDisplay(db, id);
  if (!existing) throw new NotFoundError(`display ${id}`);
  db.prepare('UPDATE displays SET name = ?, wall_id = ?, overrides = ? WHERE id = ?')
    .run(
      input.name ?? existing.name,
      input.wallId === undefined ? existing.wallId : input.wallId,
      JSON.stringify(input.overrides ?? existing.overrides),
      id,
    );
  return getDisplay(db, id)!;
}

export function touchDisplay(db: Database.Database, id: number): void {
  db.prepare('UPDATE displays SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), id);
}

/**
 * Pairs the display with the given code: mints a fresh 32-byte secret, stores its SHA-256
 * hash + `paired_at`, and returns the display plus the RAW token. The raw token is returned
 * exactly once (it's never stored in plaintext and can't be re-derived). Re-pairing an
 * already-paired display rotates the token (invalidates the old one). Returns null for an
 * unknown code. Code match is case-insensitive (getDisplayByCode upper-cases).
 *
 * Fails closed on an EXPIRED code too (also null) — the TTL must hold even for a caller
 * that skips the route layer's own isPairCodeExpired pre-check (which exists only to
 * return the friendlier 410 "regenerate it" response).
 */
export function pairDisplay(
  db: Database.Database, code: string,
): { display: Display; token: string } | null {
  const existing = getDisplayByCode(db, code);
  if (!existing) return null;
  if (isPairCodeExpired(existing)) return null;
  const token = randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  db.prepare('UPDATE displays SET token_hash = ?, paired_at = ?, last_seen = ? WHERE id = ?')
    .run(hashToken(token), now, now, existing.id);
  return { display: getDisplay(db, existing.id)!, token };
}

/** Resolves a raw display token to its display via an indexed SHA-256-hash lookup (same
 * pattern as sessions.token_hash in core/auth.ts), or null if no display has that token. */
export function getDisplayByToken(db: Database.Database, token: string): Display | null {
  if (!token) return null;
  const r = db.prepare('SELECT * FROM displays WHERE token_hash = ?').get(hashToken(token));
  return r ? rowToDisplay(r) : null;
}

export function deleteDisplay(db: Database.Database, id: number): void {
  const res = db.prepare('DELETE FROM displays WHERE id = ?').run(id);
  if (res.changes === 0) throw new NotFoundError(`display ${id}`);
}
