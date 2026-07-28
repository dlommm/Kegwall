import type Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r: any) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
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
      });
      apply();
      if (fkWasOn) {
        const violations = db.pragma('foreign_key_check');
        if (Array.isArray(violations) && violations.length > 0) {
          throw new Error(`migration ${file} left dangling foreign keys: ${JSON.stringify(violations)}`);
        }
      }
    } finally {
      if (fkWasOn) db.pragma('foreign_keys = ON');
    }
  }
}
