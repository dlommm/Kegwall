import type Database from 'better-sqlite3';
import { randomBytes, createHash } from 'node:crypto';
import { getUser, type User } from '../db/users.js';

const SESSION_DAYS = 30;

function hashToken(token: string): string {
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
  const r = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(hashToken(token)) as { user_id: number; expires_at: string } | undefined;
  if (!r) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return getUser(db, r.user_id);
}

export function destroySession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
