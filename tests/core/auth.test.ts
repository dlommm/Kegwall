import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createUser } from '../../src/server/db/users.js';
import {
  createSession, getUserForToken, destroySession, sweepExpiredSessions, hashToken,
} from '../../src/server/core/auth.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
let userId: number;
beforeEach(async () => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  userId = (await createUser(db, {
    username: 'dan', displayName: 'Dan', password: 'hunter22', role: 'admin',
  })).id;
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

  it('sweepExpiredSessions removes only expired rows, keeping live sessions intact', () => {
    // getUserForToken only lazily deletes an expired row when its exact token comes back
    // — a browser that never returns would leave its row forever without this sweep.
    const live = createSession(db, userId);
    const stale = createSession(db, userId);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() - 1000).toISOString(), hashToken(stale.token));
    sweepExpiredSessions(db);
    expect((db.prepare('SELECT COUNT(*) c FROM sessions').get() as any).c).toBe(1);
    expect(getUserForToken(db, live.token)?.username).toBe('dan');
    expect(getUserForToken(db, stale.token)).toBeNull();
  });
});
