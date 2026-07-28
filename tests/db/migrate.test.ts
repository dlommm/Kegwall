import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)), '../../src/server/db/migrations',
);

describe('migrations', () => {
  it('creates all tables and is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const db = openDb(dir);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r: any) => r.name);
    for (const t of ['beers', 'taps', 'kegs', 'monitors', 'pours', 'telemetry',
      'walls', 'automations', 'notifications', 'settings', 'users', 'sessions',
      'schema_migrations']) {
      expect(tables).toContain(t);
    }
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
    // reopen: migrations must not re-run/fail
    const db2 = openDb(dir);
    expect(db2.prepare('SELECT COUNT(*) c FROM schema_migrations').get()).toEqual({ c: 3 });
    db2.close();
  });

  it('applies new migration files on top of a database migrated only through 001 (upgrade path)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const raw = new Database(join(dir, 'app.db'));
    raw.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    raw.exec(readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf8'));
    raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
      .run('001_initial.sql', new Date().toISOString());
    raw.close();

    // simulates the pre-fix on-disk state: only idx_kegs_tap exists
    const preCheck = new Database(join(dir, 'app.db'));
    const preIdx = preCheck.prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all().map((r: any) => r.name);
    expect(preIdx).toContain('idx_kegs_tap');
    expect(preIdx).not.toContain('idx_kegs_tap_active');
    preCheck.close();

    const upgraded = openDb(dir);
    const applied = upgraded.prepare('SELECT name FROM schema_migrations ORDER BY name').all()
      .map((r: any) => r.name);
    expect(applied).toEqual(['001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql']);
    const idx = upgraded.prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all().map((r: any) => r.name);
    expect(idx).toContain('idx_kegs_tap_active');
    expect(idx).not.toContain('idx_kegs_tap');
    upgraded.close();
  });

  it('applies migration 003 on a seeded pre-003 (001+002) DB: preserves data, allows on_deck, '
    + 'keeps the unique active-keg index, and leaves foreign_keys enforcement on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const raw = new Database(join(dir, 'app.db'));
    raw.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    raw.exec(readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf8'));
    raw.exec(readFileSync(join(MIGRATIONS_DIR, '002_unique_active_keg.sql'), 'utf8'));
    const now = new Date().toISOString();
    raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('001_initial.sql', now);
    raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('002_unique_active_keg.sql', now);

    // Seed pre-003 data, including a pour referencing a keg -- this exercises the FK-toggle
    // path around the table-recreate (pours.keg_id REFERENCES kegs(id)).
    raw.prepare(`INSERT INTO beers (name, created_at) VALUES ('Test Ale', ?)`).run(now);
    raw.prepare(`INSERT INTO taps (number) VALUES (1)`).run();
    raw.prepare(`INSERT INTO kegs (beer_id, tap_id, size_ml, vol_start_ml, status, created_at)
      VALUES (1, 1, 19000, 19000, 'on_tap', ?)`).run(now);
    raw.prepare(`INSERT INTO pours (keg_id, ts, volume_ml, source) VALUES (1, ?, 400, 'cloud')`).run(now);
    raw.close();

    const upgraded = openDb(dir);
    const applied = upgraded.prepare('SELECT name FROM schema_migrations ORDER BY name').all()
      .map((r: any) => r.name);
    expect(applied).toEqual(['001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql']);

    const keg = upgraded.prepare('SELECT * FROM kegs WHERE id = 1').get() as any;
    expect(keg).toMatchObject({ status: 'on_tap', vol_start_ml: 19000, tap_id: 1, beer_id: 1 });
    const pour = upgraded.prepare('SELECT * FROM pours WHERE id = 1').get() as any;
    expect(pour.keg_id).toBe(1);

    // status CHECK now allows 'on_deck'
    expect(() => upgraded.prepare(`INSERT INTO kegs (beer_id, tap_id, size_ml, vol_start_ml, status, created_at)
      VALUES (1, NULL, 19000, 19000, 'on_deck', ?)`).run(now)).not.toThrow();
    // and still rejects genuinely invalid statuses
    expect(() => upgraded.prepare(`INSERT INTO kegs (beer_id, tap_id, size_ml, vol_start_ml, status, created_at)
      VALUES (1, NULL, 19000, 19000, 'bogus', ?)`).run(now)).toThrow();

    const idx = upgraded.prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all().map((r: any) => r.name);
    expect(idx).toContain('idx_kegs_tap_active');
    expect(idx).not.toContain('idx_kegs_tap');
    // unique active-keg index still enforced: tap 1 already has an on_tap keg (id 1)
    expect(() => upgraded.prepare(`INSERT INTO kegs (beer_id, tap_id, size_ml, vol_start_ml, status, created_at)
      VALUES (1, 1, 19000, 19000, 'on_tap', ?)`).run(now)).toThrow();

    expect(upgraded.pragma('foreign_keys', { simple: true })).toBe(1);
    upgraded.close();
  });

  it('opens with a 5s busy_timeout pragma set explicitly by openDb', () => {
    // better-sqlite3 happens to default busy_timeout to 5000 already, so a plain
    // readback wouldn't prove openDb sets it. Spy on the pragma calls to confirm
    // openDb issues the statement itself (next to the WAL pragma).
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const spy = vi.spyOn(Database.prototype, 'pragma');
    const db = openDb(dir);
    const calls = spy.mock.calls.map((c) => c[0]);
    expect(calls).toContain('busy_timeout = 5000');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    spy.mockRestore();
    db.close();
  });
});
