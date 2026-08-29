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
  it('creates a login user and verifies password', async () => {
    const u = await createUser(db, {
      username: 'dan', displayName: 'Dan', password: 'hunter22', role: 'admin',
    });
    expect(u).not.toHaveProperty('passwordHash');
    expect((await verifyPassword(db, 'dan', 'hunter22'))?.id).toBe(u.id);
    expect(await verifyPassword(db, 'dan', 'wrong')).toBeNull();
    expect(await verifyPassword(db, 'ghost', 'hunter22')).toBeNull();
  });

  // Perf batch: createUser/updateUser/verifyPassword moved from bcryptjs's sync APIs
  // (which block the event loop ~100ms, freezing ingest) to the async promise APIs.
  // The stored hash must keep the exact same bcrypt cost factor (10) as before.
  it('hashes with the same bcrypt cost factor (10) as the old sync path', async () => {
    const u = await createUser(db, {
      username: 'dan', displayName: 'Dan', password: 'hunter22', role: 'admin',
    });
    const hash = (db.prepare('SELECT password_hash h FROM users WHERE id = ?').get(u.id) as any).h;
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('drinker-only profiles cannot log in but appear in drinker list', async () => {
    createDrinker(db, { displayName: 'Guest Sam' });
    expect(listDrinkers(db)).toHaveLength(1);
    expect(await verifyPassword(db, 'Guest Sam', '')).toBeNull();
  });

  it('refuses to delete the last admin', async () => {
    const admin = await createUser(db, {
      username: 'a', displayName: 'A', password: 'pw123456', role: 'admin',
    });
    expect(countAdmins(db)).toBe(1);
    expect(() => deleteUser(db, admin.id)).toThrow(ConflictError);
  });
});
