import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import {
  createUser, createDrinker, verifyPassword, listDrinkers, deleteUser, countAdmins,
} from '../../src/server/db/users.js';
import { ConflictError } from '../../src/server/core/errors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

describe('users repo', () => {
  it('creates a login user and verifies password', () => {
    const u = createUser(db, {
      username: 'dan', displayName: 'Dan', password: 'hunter22', role: 'admin',
    });
    expect(u).not.toHaveProperty('passwordHash');
    expect(verifyPassword(db, 'dan', 'hunter22')?.id).toBe(u.id);
    expect(verifyPassword(db, 'dan', 'wrong')).toBeNull();
    expect(verifyPassword(db, 'ghost', 'hunter22')).toBeNull();
  });

  it('drinker-only profiles cannot log in but appear in drinker list', () => {
    createDrinker(db, { displayName: 'Guest Sam' });
    expect(listDrinkers(db)).toHaveLength(1);
    expect(verifyPassword(db, 'Guest Sam', '')).toBeNull();
  });

  it('refuses to delete the last admin', () => {
    const admin = createUser(db, {
      username: 'a', displayName: 'A', password: 'pw123456', role: 'admin',
    });
    expect(countAdmins(db)).toBe(1);
    expect(() => deleteUser(db, admin.id)).toThrow(ConflictError);
  });
});
