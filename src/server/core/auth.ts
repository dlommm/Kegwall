import type Database from 'better-sqlite3';
import { randomBytes, createHash } from 'node:crypto';
import { getUser, type User } from '../db/users.js';

const SESSION_DAYS = 30;

/** Exported for the one non-lookup use of a token hash: the users route passes the ACTING
 * session's hash to `deleteSessionsForUser` (db/users.ts) so a self-service password
 * change revokes every OTHER session without logging the requester out. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(db: Database.Database, userId: number): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, hashToken(token), expiresAt);
  return { token, expiresAt };
}

export function getUserForToken(db: Database.Database, token: string): User | null {
  const hash = hashToken(token);
  const r = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(hash) as { user_id: number; expires_at: string } | undefined;
  if (!r) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  return getUser(db, r.user_id);
}

export function destroySession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Deletes every expired session row. `getUserForToken` only lazily deletes an expired
 * row when its exact token is presented again, so sessions from browsers that never come
 * back would otherwise accumulate forever — this sweep runs on successful login (a rare,
 * already-write-path moment), keeping the table bounded without a background timer. */
export function sweepExpiredSessions(db: Database.Database): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}
