import type Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { ConflictError, NotFoundError } from '../core/errors.js';

export type Role = 'admin' | 'editor' | 'viewer';

export interface User {
  id: number; username: string | null; displayName: string; role: Role | null;
  isDrinker: boolean; avatarColor: string | null; createdAt: string;
}

function rowToUser(r: any): User {
  return {
    id: r.id, username: r.username, displayName: r.display_name, role: r.role,
    isDrinker: !!r.is_drinker, avatarColor: r.avatar_color, createdAt: r.created_at,
  };
}

export function createUser(db: Database.Database, input: {
  username: string; displayName: string; password: string; role: Role; isDrinker?: boolean;
}): User {
  const hash = bcrypt.hashSync(input.password, 10);
  const res = db.prepare(`INSERT INTO users
      (username, display_name, password_hash, role, is_drinker, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.username, input.displayName, hash, input.role,
      input.isDrinker === false ? 0 : 1, new Date().toISOString());
  return getUser(db, Number(res.lastInsertRowid))!;
}

export function createDrinker(db: Database.Database, input: {
  displayName: string; avatarColor?: string;
}): User {
  const res = db.prepare(`INSERT INTO users (display_name, avatar_color, is_drinker, created_at)
      VALUES (?, ?, 1, ?)`)
    .run(input.displayName, input.avatarColor ?? null, new Date().toISOString());
  return getUser(db, Number(res.lastInsertRowid))!;
}

export function getUser(db: Database.Database, id: number): User | null {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return r ? rowToUser(r) : null;
}

export function listUsers(db: Database.Database): User[] {
  return db.prepare('SELECT * FROM users ORDER BY display_name').all().map(rowToUser);
}

export function listDrinkers(db: Database.Database): User[] {
  return db.prepare('SELECT * FROM users WHERE is_drinker = 1 ORDER BY display_name')
    .all().map(rowToUser);
}

export function verifyPassword(db: Database.Database, username: string, password: string): User | null {
  const r = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!r?.password_hash) return null;
  return bcrypt.compareSync(password, r.password_hash) ? rowToUser(r) : null;
}

export function countAdmins(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin'`).get() as any).c;
}

export function updateUser(db: Database.Database, id: number, input: {
  displayName?: string; role?: Role; password?: string; avatarColor?: string | null;
  isDrinker?: boolean;
}): User {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!existing) throw new NotFoundError(`user ${id}`);
  if (existing.role === 'admin' && input.role && input.role !== 'admin' && countAdmins(db) === 1) {
    throw new ConflictError('cannot demote the last admin');
  }
  db.prepare(`UPDATE users SET display_name = ?, role = ?, password_hash = ?,
      avatar_color = ?, is_drinker = ? WHERE id = ?`)
    .run(input.displayName ?? existing.display_name,
      input.role ?? existing.role,
      input.password ? bcrypt.hashSync(input.password, 10) : existing.password_hash,
      input.avatarColor === undefined ? existing.avatar_color : input.avatarColor,
      input.isDrinker === undefined ? existing.is_drinker : (input.isDrinker ? 1 : 0),
      id);
  return getUser(db, id)!;
}

export function deleteUser(db: Database.Database, id: number): void {
  const r = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any;
  if (!r) throw new NotFoundError(`user ${id}`);
  if (r.role === 'admin' && countAdmins(db) === 1) {
    throw new ConflictError('cannot delete the last admin');
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE pours SET drinker_id = NULL WHERE drinker_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  tx();
}
