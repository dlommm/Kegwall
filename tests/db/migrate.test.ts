import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/server/db/db.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    expect(db2.prepare('SELECT COUNT(*) c FROM schema_migrations').get()).toEqual({ c: 1 });
    db2.close();
  });
});
