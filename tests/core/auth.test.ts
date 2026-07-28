import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createUser } from '../../src/server/db/users.js';
import { createSession, getUserForToken, destroySession } from '../../src/server/core/auth.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
let userId: number;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  userId = createUser(db, {
    username: 'dan', displayName: 'Dan', password: 'hunter22', role: 'admin',
  }).id;
});

describe('auth sessions', () => {
  it('creates a session and resolves the user from the raw token', () => {
    const { token } = createSession(db, userId);
    expect(getUserForToken(db, token)?.username).toBe('dan');
    // raw token never stored
    const stored = db.prepare('SELECT token_hash FROM sessions').get() as any;
    expect(stored.token_hash).not.toBe(token);
  });

  it('rejects unknown and destroyed tokens', () => {
    const { token } = createSession(db, userId);
    destroySession(db, token);
    expect(getUserForToken(db, token)).toBeNull();
    expect(getUserForToken(db, 'deadbeef')).toBeNull();
  });
});
