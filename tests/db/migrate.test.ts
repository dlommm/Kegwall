import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { runMigrations } from '../../src/server/db/migrate.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)), '../../src/server/db/migrations',
);

// 30 s timeout (vs the 5 s default): the upgrade-path tests replay the full SQL
// migration chain against a fresh on-disk SQLite file, which comfortably beats
// 5 s on a dev machine but not on a slow shared CI runner under load.
describe('migrations', { timeout: 30_000 }, () => {
  it('creates all tables and is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const db = openDb(dir);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r: any) => r.name);
    for (const t of ['beers', 'taps', 'kegs', 'monitors', 'pours', 'telemetry',
      'walls', 'automations', 'notifications', 'settings', 'users', 'sessions',
      'suppliers', 'games', 'game_sessions', 'game_participants', 'game_results',
      'schema_migrations']) {
      expect(tables).toContain(t);
    }
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
    // reopen: migrations must not re-run/fail
    const db2 = openDb(dir);
    expect(db2.prepare('SELECT COUNT(*) c FROM schema_migrations').get()).toEqual({ c: 22 });
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
    expect(applied).toEqual([
      '001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql',
      '004_tap_default_drinker.sql', '005_keg_type.sql', '006_pour_quality.sql', '007_logs.sql', '008_locations_displays.sql', '009_feature_pack.sql', '010_remove_locations.sql', '011_wall_devices.sql', '012_govee_monitors.sql', '013_tap_hidden.sql', '014_host_stats.sql', '015_udp_activity.sql', '016_face_embeddings.sql', '017_faces_log_source.sql', '018_display_token.sql', '019_cost_suppliers.sql', '020_games.sql', '021_pours_drinker_index.sql',
      '022_pair_code_expiry.sql',
    ]);
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
    expect(applied).toEqual([
      '001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql',
      '004_tap_default_drinker.sql', '005_keg_type.sql', '006_pour_quality.sql', '007_logs.sql', '008_locations_displays.sql', '009_feature_pack.sql', '010_remove_locations.sql', '011_wall_devices.sql', '012_govee_monitors.sql', '013_tap_hidden.sql', '014_host_stats.sql', '015_udp_activity.sql', '016_face_embeddings.sql', '017_faces_log_source.sql', '018_display_token.sql', '019_cost_suppliers.sql', '020_games.sql', '021_pours_drinker_index.sql',
      '022_pair_code_expiry.sql',
    ]);

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

  it('adds taps.default_drinker_id (nullable), preserving existing taps and enforcing '
    + 'the users FK for a non-null value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const db = openDb(dir);
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO taps (number, name) VALUES (1, 'Left')`).run();
    const tap = db.prepare(`SELECT * FROM taps WHERE number = 1`).get() as any;
    expect(tap.default_drinker_id).toBeNull();

    db.prepare(`INSERT INTO users (display_name, is_drinker, created_at) VALUES ('Bob', 1, ?)`).run(now);
    const drinkerId = (db.prepare(`SELECT id FROM users WHERE display_name = 'Bob'`).get() as any).id;
    expect(() => db.prepare(`UPDATE taps SET default_drinker_id = ? WHERE id = ?`)
      .run(drinkerId, tap.id)).not.toThrow();

    expect(() => db.prepare(`UPDATE taps SET default_drinker_id = ? WHERE id = ?`)
      .run(999999, tap.id)).toThrow();

    db.close();
  });

  it('adds kegs.keg_type (nullable, CHECKed against the 7 keg-asset ids), preserving '
    + 'existing kegs and rejecting an unrecognized value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const db = openDb(dir);
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO beers (name, created_at) VALUES ('Test Ale', ?)`).run(now);
    const beerId = (db.prepare(`SELECT id FROM beers WHERE name = 'Test Ale'`).get() as any).id;
    db.prepare(`INSERT INTO taps (number) VALUES (1)`).run();
    db.prepare(`INSERT INTO kegs (beer_id, tap_id, size_ml, vol_start_ml, status, created_at)
      VALUES (?, 1, 19000, 19000, 'on_tap', ?)`).run(beerId, now);

    // pre-existing keg gets NULL (auto-match, not a stored override)
    const keg = db.prepare('SELECT * FROM kegs WHERE id = 1').get() as any;
    expect(keg.keg_type).toBeNull();

    for (const id of [
      'half-barrel', 'quarter-barrel', 'sixth-barrel', 'fifty-liter', 'cornelius', 'slim-quarter', 'mini-keg',
    ]) {
      expect(() => db.prepare('UPDATE kegs SET keg_type = ? WHERE id = 1').run(id)).not.toThrow();
    }
    expect((db.prepare('SELECT keg_type FROM kegs WHERE id = 1').get() as any).keg_type).toBe('mini-keg');

    // clearing back to NULL (back to auto-match) is allowed
    expect(() => db.prepare('UPDATE kegs SET keg_type = NULL WHERE id = 1').run()).not.toThrow();

    // an unrecognized id is rejected by the CHECK constraint
    expect(() => db.prepare(`UPDATE kegs SET keg_type = 'not-a-real-asset' WHERE id = 1`).run()).toThrow();

    db.close();
  });

  it('applies every migration through 005, in order, on a fresh database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const db = openDb(dir);
    const applied = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all()
      .map((r: any) => r.name);
    expect(applied).toEqual([
      '001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql',
      '004_tap_default_drinker.sql', '005_keg_type.sql', '006_pour_quality.sql', '007_logs.sql', '008_locations_displays.sql', '009_feature_pack.sql', '010_remove_locations.sql', '011_wall_devices.sql', '012_govee_monitors.sql', '013_tap_hidden.sql', '014_host_stats.sql', '015_udp_activity.sql', '016_face_embeddings.sql', '017_faces_log_source.sql', '018_display_token.sql', '019_cost_suppliers.sql', '020_games.sql', '021_pours_drinker_index.sql',
      '022_pair_code_expiry.sql',
    ]);
    db.close();
  });

  it('applies 005 on top of a database migrated only through 004 (upgrade path), '
    + 'preserving existing keg rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const raw = new Database(join(dir, 'app.db'));
    raw.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    for (const name of [
      '001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql', '004_tap_default_drinker.sql',
    ]) {
      raw.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
      raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(name, new Date().toISOString());
    }
    const now = new Date().toISOString();
    raw.prepare(`INSERT INTO beers (name, created_at) VALUES ('Pre-005 Ale', ?)`).run(now);
    raw.prepare(`INSERT INTO taps (number) VALUES (1)`).run();
    raw.prepare(`INSERT INTO kegs (beer_id, tap_id, size_ml, vol_start_ml, status, created_at)
      VALUES (1, 1, 19000, 19000, 'on_tap', ?)`).run(now);
    raw.close();

    const upgraded = openDb(dir);
    const applied = upgraded.prepare('SELECT name FROM schema_migrations ORDER BY name').all()
      .map((r: any) => r.name);
    expect(applied).toEqual([
      '001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql',
      '004_tap_default_drinker.sql', '005_keg_type.sql', '006_pour_quality.sql', '007_logs.sql', '008_locations_displays.sql', '009_feature_pack.sql', '010_remove_locations.sql', '011_wall_devices.sql', '012_govee_monitors.sql', '013_tap_hidden.sql', '014_host_stats.sql', '015_udp_activity.sql', '016_face_embeddings.sql', '017_faces_log_source.sql', '018_display_token.sql', '019_cost_suppliers.sql', '020_games.sql', '021_pours_drinker_index.sql',
      '022_pair_code_expiry.sql',
    ]);

    const keg = upgraded.prepare('SELECT * FROM kegs WHERE id = 1').get() as any;
    expect(keg.keg_type).toBeNull();
    expect(keg.vol_start_ml).toBe(19000);
    expect(() => upgraded.prepare(`UPDATE kegs SET keg_type = 'cornelius' WHERE id = 1`).run()).not.toThrow();

    upgraded.close();
  });

  it('fails closed on a corrupting migration: rolls back, does NOT mark it applied, and '
    + 'leaves pre-existing data untouched (regression: foreign_key_check must run INSIDE '
    + "the migration's transaction, before it commits -- checking after db.transaction() "
    + 'has already returned would be too late, since better-sqlite3 commits as soon as the '
    + 'callback returns normally)', () => {
    // An isolated fixture migrations dir (runMigrations' injectable second param) so this
    // deliberately-corrupting file never touches the real shipped migration set: 001+002
    // copied verbatim to get a normal, valid schema. The corrupting "003" (a pour pointing
    // at a keg that doesn't exist) is added to the SAME directory only after the first
    // runMigrations call and after seeding real data below — writing it up front would let
    // the very first call apply 001, 002, AND 003 together in one pass (nothing is marked
    // applied yet at that point), corrupting the DB before there's any real data to prove
    // survives untouched.
    const fixturesDir = mkdtempSync(join(tmpdir(), 'ktdash-migrations-'));
    writeFileSync(join(fixturesDir, '001_initial.sql'),
      readFileSync(join(MIGRATIONS_DIR, '001_initial.sql'), 'utf8'));
    writeFileSync(join(fixturesDir, '002_unique_active_keg.sql'),
      readFileSync(join(MIGRATIONS_DIR, '002_unique_active_keg.sql'), 'utf8'));

    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const db = new Database(join(dir, 'app.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db, fixturesDir); // applies 001 + 002 cleanly, 003_corrupt.sql doesn't exist yet

    // Seed real, pre-existing data that must survive the corrupting migration attempt
    // completely untouched.
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO beers (name, created_at) VALUES ('Original Ale', ?)`).run(now);
    const beerId = (db.prepare(`SELECT id FROM beers WHERE name = 'Original Ale'`).get() as any).id;
    db.prepare(`INSERT INTO taps (number) VALUES (1)`).run();
    db.prepare(`INSERT INTO kegs (beer_id, tap_id, size_ml, vol_start_ml, status, created_at)
      VALUES (?, 1, 19000, 19000, 'on_tap', ?)`).run(beerId, now);
    db.prepare(`INSERT INTO pours (keg_id, ts, volume_ml, source) VALUES (1, ?, 400, 'cloud')`).run(now);

    writeFileSync(join(fixturesDir, '003_corrupt.sql'), `
      INSERT INTO beers (name, created_at) VALUES ('Corrupt Test Beer', '2026-01-01T00:00:00.000Z');
      INSERT INTO pours (keg_id, ts, volume_ml, source) VALUES (999999, '2026-01-01T00:00:00.000Z', 100, 'cloud');
    `);

    expect(() => runMigrations(db, fixturesDir)).toThrow(/dangling foreign keys/i);

    // (b) the corrupting migration must NOT be recorded as applied
    const applied = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all()
      .map((r: any) => r.name);
    expect(applied).toEqual(['001_initial.sql', '002_unique_active_keg.sql']);

    // (a) no corrupt rows committed
    expect((db.prepare(`SELECT COUNT(*) c FROM beers WHERE name = 'Corrupt Test Beer'`)
      .get() as any).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) c FROM pours WHERE keg_id = 999999`).get() as any).c).toBe(0);

    // (c) original data intact
    expect((db.prepare(`SELECT COUNT(*) c FROM beers WHERE name = 'Original Ale'`)
      .get() as any).c).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) c FROM pours WHERE keg_id = 1`).get() as any).c).toBe(1);

    // a retry (e.g. after a restart) attempts the same not-yet-applied migration again,
    // rather than silently skipping a corrupt-but-marked-applied one
    expect(() => runMigrations(db, fixturesDir)).toThrow(/dangling foreign keys/i);

    db.close();
  });

  it('010 drops locations + every location_id column on a DB that used them, '
    + 'keeping the monitor friendly name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const raw = new Database(join(dir, 'app.db'));
    const now = new Date().toISOString();
    raw.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    for (const f of ['001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql',
      '004_tap_default_drinker.sql', '005_keg_type.sql', '006_pour_quality.sql', '007_logs.sql',
      '008_locations_displays.sql', '009_feature_pack.sql']) {
      raw.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
      raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, now);
    }
    // Location-scoped data, exactly as a Phase 5 install would have it.
    raw.prepare(`INSERT INTO locations (name, created_at) VALUES ('Garage', ?)`).run(now);
    raw.prepare(`INSERT INTO taps (number, location_id) VALUES (1, 1)`).run();
    raw.prepare(`INSERT INTO monitors (type, identifier, port_index, name, location_id, meta)
      VALUES ('kegtron_pro', 'dev1', 0, 'Main kegerator', 1, '{}')`).run();
    raw.prepare(`INSERT INTO walls (slug, name, config, location_id) VALUES ('main', 'Main', '{}', 1)`).run();
    raw.close();

    const upgraded = openDb(dir);
    const tables = upgraded.prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all().map((r: any) => r.name);
    expect(tables).not.toContain('locations');
    for (const table of ['monitors', 'taps', 'walls']) {
      const cols = (upgraded.pragma(`table_info(${table})`) as any[]).map((c) => c.name);
      expect(cols).not.toContain('location_id');
    }
    const monitor = upgraded.prepare(`SELECT * FROM monitors WHERE identifier = 'dev1'`).get() as any;
    expect(monitor.name).toBe('Main kegerator');
    // The three tables still accept writes (no dangling REFERENCES from the drop order).
    expect(() => upgraded.prepare(`INSERT INTO taps (number) VALUES (2)`).run()).not.toThrow();
    upgraded.close();
  });

  it('012 rebuilds monitors (type CHECK + enabled) preserving ids, bindings and telemetry joins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const raw = new Database(join(dir, 'app.db'));
    const now = new Date().toISOString();
    raw.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    for (const f of ['001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql',
      '004_tap_default_drinker.sql', '005_keg_type.sql', '006_pour_quality.sql', '007_logs.sql',
      '008_locations_displays.sql', '009_feature_pack.sql', '010_remove_locations.sql',
      '011_wall_devices.sql']) {
      raw.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
      raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, now);
    }
    raw.prepare(`INSERT INTO taps (number) VALUES (1)`).run();
    raw.prepare(`INSERT INTO monitors (id, type, identifier, port_index, tap_id, name, meta)
      VALUES (7, 'kegtron_pro', 'dev1', 0, 1, 'Garage', '{}')`).run();
    raw.prepare(`INSERT INTO telemetry (monitor_id, ts, temp, humidity) VALUES (7, ?, 4.2, 50)`).run(now);
    raw.close();

    const upgraded = openDb(dir);
    const mon = upgraded.prepare(`SELECT * FROM monitors WHERE id = 7`).get() as any;
    expect(mon).toMatchObject({ type: 'kegtron_pro', identifier: 'dev1', tap_id: 1, name: 'Garage', enabled: 1 });
    const joined = upgraded.prepare(
      `SELECT t.temp FROM telemetry t JOIN monitors m ON m.id = t.monitor_id WHERE m.identifier = 'dev1'`,
    ).get() as any;
    expect(joined.temp).toBe(4.2);
    // The widened CHECK accepts govee_sensor and still rejects junk.
    expect(() => upgraded.prepare(`INSERT INTO monitors (type, identifier, port_index, meta)
      VALUES ('govee_sensor', 'AA:BB', 0, '{}')`).run()).not.toThrow();
    expect(() => upgraded.prepare(`INSERT INTO monitors (type, identifier, port_index, meta)
      VALUES ('bogus', 'x', 0, '{}')`).run()).toThrow();
    // UNIQUE(type, identifier, port_index) still enforced.
    expect(() => upgraded.prepare(`INSERT INTO monitors (type, identifier, port_index, meta)
      VALUES ('kegtron_pro', 'dev1', 0, '{}')`).run()).toThrow();
    expect(upgraded.pragma('foreign_key_check')).toEqual([]);
    upgraded.close();
  });

  it('021 adds idx_pours_drinker_ts, and per-drinker pour queries use it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const db = openDb(dir);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all().map((r: any) => r.name);
    expect(idx).toContain('idx_pours_drinker_ts');
    // The exact hot shape from routes/featurePack.ts: equality on drinker_id plus a ts
    // ordering — the composite index must serve both (no full pours scan, no temp b-tree).
    const plan = db.prepare(
      'EXPLAIN QUERY PLAN SELECT * FROM pours WHERE drinker_id = ? ORDER BY ts DESC LIMIT 8',
    ).all(1).map((r: any) => r.detail).join(' | ');
    expect(plan).toContain('idx_pours_drinker_ts');
    expect(plan).not.toContain('SCAN pours');
    db.close();
  });

  it('applies 021 on top of a database migrated through 020 (upgrade path), preserving pour rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const raw = new Database(join(dir, 'app.db'));
    const now = new Date().toISOString();
    raw.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    for (const f of ['001_initial.sql', '002_unique_active_keg.sql', '003_on_deck_status.sql',
      '004_tap_default_drinker.sql', '005_keg_type.sql', '006_pour_quality.sql', '007_logs.sql',
      '008_locations_displays.sql', '009_feature_pack.sql', '010_remove_locations.sql',
      '011_wall_devices.sql', '012_govee_monitors.sql', '013_tap_hidden.sql', '014_host_stats.sql',
      '015_udp_activity.sql', '016_face_embeddings.sql', '017_faces_log_source.sql',
      '018_display_token.sql', '019_cost_suppliers.sql', '020_games.sql']) {
      raw.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
      raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, now);
    }
    raw.prepare(`INSERT INTO beers (name, created_at) VALUES ('Pre-021 Ale', ?)`).run(now);
    raw.prepare(`INSERT INTO taps (number) VALUES (1)`).run();
    raw.prepare(`INSERT INTO kegs (beer_id, tap_id, size_ml, vol_start_ml, status, created_at)
      VALUES (1, 1, 19000, 19000, 'on_tap', ?)`).run(now);
    raw.prepare(`INSERT INTO users (display_name, is_drinker, created_at) VALUES ('Bob', 1, ?)`).run(now);
    raw.prepare(`INSERT INTO pours (keg_id, ts, volume_ml, source, drinker_id) VALUES (1, ?, 400, 'cloud', 1)`).run(now);
    raw.close();

    const upgraded = openDb(dir);
    const idx = upgraded.prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all().map((r: any) => r.name);
    expect(idx).toContain('idx_pours_drinker_ts');
    const pour = upgraded.prepare('SELECT * FROM pours WHERE drinker_id = 1').get() as any;
    expect(pour).toMatchObject({ keg_id: 1, volume_ml: 400, drinker_id: 1 });
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
