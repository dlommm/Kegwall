import type Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** `migrationsDir` defaults to the real `db/migrations` folder — the optional param exists
 * so tests can point `runMigrations` at an isolated fixture directory (e.g. a deliberately
 * corrupting migration file) without touching the shipped migration set. */
export function runMigrations(db: Database.Database, migrationsDir: string = MIGRATIONS_DIR): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r: any) => r.name),
  );
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // Table-recreate migrations (e.g. 003_on_deck_status.sql, widening a CHECK constraint
    // SQLite has no ALTER for) need foreign key enforcement off for the duration of the
    // rebuild -- disabling it must happen OUTSIDE the transaction below: PRAGMA
    // foreign_keys is a documented no-op while a transaction is already open, so toggling
    // it from inside the .sql file itself (inside db.exec(sql), which runs inside
    // db.transaction() here) would silently do nothing. Applied uniformly to every
    // migration file rather than special-cased, since it's a harmless no-op for ones that
    // don't touch table schema.
    const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
    if (fkWasOn) db.pragma('foreign_keys = OFF');
    try {
      const apply = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
          .run(file, new Date().toISOString());
        // MUST run INSIDE this transaction, before it commits — not after apply() returns.
        // db.transaction() commits as soon as the callback returns normally, so checking
        // (and throwing on) violations after apply() would already be too late: the
        // corrupting migration would be committed AND recorded in schema_migrations before
        // the error ever surfaced, and a restart would then skip it as already-applied,
        // leaving the corruption permanent. Throwing from inside here instead makes
        // better-sqlite3 roll back the whole transaction — schema_migrations insert
        // included — so a corrupting migration fails closed: not applied, not recorded,
        // pre-existing data untouched.
        if (fkWasOn) {
          const violations = db.pragma('foreign_key_check');
          if (Array.isArray(violations) && violations.length > 0) {
            throw new Error(`migration ${file} left dangling foreign keys: ${JSON.stringify(violations)}`);
          }
        }
      });
      apply();
    } finally {
      if (fkWasOn) db.pragma('foreign_keys = ON');
    }
  }
}
