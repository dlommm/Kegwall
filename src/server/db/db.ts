import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from './migrate.js';

/**
 * Applies a staged restore (Task 8's `POST /api/admin/restore`, which writes
 * `DATA_DIR/pending-restore.db` after validating the upload) BEFORE `app.db` is opened
 * this boot. This is the ONLY place the swap happens — restoring the live file out from
 * under an already-open `Database` handle and its prepared statements mid-process would
 * corrupt state, so restore is always "stage now, apply on next boot", never live.
 *
 * The replaced `app.db` (plus any `-wal`/`-shm` sidecars still sitting next to it) is
 * renamed aside as a one-shot `app.db.bak` — moving the sidecars together with the main
 * file matters: leaving a stale `-wal`/`-shm` at the `app.db` path would have SQLite try
 * to replay journal frames from the OLD database against the newly-restored file the
 * instant it's reopened in WAL mode below, corrupting it. `pending-restore.db` itself is
 * written as a single plain buffer (`routes/backup.ts`'s `writeFileSync`, no live
 * connection involved), so it never has sidecars of its own to worry about. The replaced
 * database is kept under a TIMESTAMPED name (`app.db.<iso>.bak`) rather than a single
 * `app.db.bak` — a second restore no longer erases the previous good copy, so a bad
 * restore is always recoverable by renaming the most recent `.bak` back.
 *
 * No-op (the common case) when no `pending-restore.db` exists.
 */
function applyPendingRestore(dataDir: string): void {
  const pendingPath = join(dataDir, 'pending-restore.db');
  if (!existsSync(pendingPath)) return;

  const dbPath = join(dataDir, 'app.db');
  // Stamped so successive restores don't clobber each other's backups. Timestamp is only
  // used to name a file, never parsed — safe to compute at boot (openDb is not a workflow).
  // A numeric uniquifier guards the (production-implausible, but test-reachable) case of two
  // restores within the same millisecond so no `.bak` is ever silently overwritten.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let bakBase = join(dataDir, `app.db.${stamp}.bak`);
  for (let n = 2; existsSync(bakBase); n += 1) {
    bakBase = join(dataDir, `app.db.${stamp}.${n}.bak`);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const src = dbPath + suffix;
    if (existsSync(src)) renameSync(src, bakBase + suffix);
  }
  renameSync(pendingPath, dbPath);
}

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  applyPendingRestore(dataDir);
  const db = new Database(join(dataDir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
