import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import {
  createDisplay, pairDisplay, getDisplayByToken, getDisplay,
} from '../../src/server/db/displays.js';

let db: Database.Database;
beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

describe('display token pairing', () => {
  it('migration 018 adds token_hash + paired_at columns', () => {
    const cols = (db.prepare('PRAGMA table_info(displays)').all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain('token_hash');
    expect(cols).toContain('paired_at');
  });

  it('pairDisplay mints a raw token once, stores only its hash, and sets paired_at', () => {
    const d = createDisplay(db, { name: 'Bar TV' });
    expect(d.pairedAt).toBeNull();

    const paired = pairDisplay(db, d.code);
    expect(paired).not.toBeNull();
    const { display, token } = paired!;
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 raw bytes hex
    expect(display.pairedAt).not.toBeNull();

    // Only the HASH is stored — never the raw token.
    const row = db.prepare('SELECT token_hash FROM displays WHERE id = ?').get(d.id) as any;
    expect(row.token_hash).toBeTruthy();
    expect(row.token_hash).not.toBe(token);
  });

  it('getDisplayByToken round-trips the raw token to its display; wrong/empty → null', () => {
    const d = createDisplay(db, { name: 'Patio TV' });
    const { token } = pairDisplay(db, d.code)!;
    expect(getDisplayByToken(db, token)?.id).toBe(d.id);
    expect(getDisplayByToken(db, 'deadbeef')).toBeNull();
    expect(getDisplayByToken(db, '')).toBeNull();
  });

  it('re-pairing rotates the token (old one stops working)', () => {
    const d = createDisplay(db, { name: 'Wall' });
    const first = pairDisplay(db, d.code)!.token;
    const second = pairDisplay(db, d.code)!.token;
    expect(second).not.toBe(first);
    expect(getDisplayByToken(db, first)).toBeNull(); // old token invalidated
    expect(getDisplayByToken(db, second)?.id).toBe(d.id);
  });

  it('pairDisplay returns null for an unknown code', () => {
    expect(pairDisplay(db, 'NOSUCHCODE')).toBeNull();
  });

  it('pairing is case-insensitive on the code', () => {
    const d = createDisplay(db, { name: 'X' });
    expect(pairDisplay(db, d.code.toLowerCase())).not.toBeNull();
    expect(getDisplay(db, d.id)?.pairedAt).not.toBeNull();
  });
});
