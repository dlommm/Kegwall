import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { mkdtempSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('openDb: pending-restore application (Task 8)', () => {
  it('applies a staged pending-restore.db over app.db on boot, keeping a one-shot .bak of the replaced file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const original = openDb(dir);
    original.prepare(`INSERT INTO beers (name, created_at) VALUES ('Original Beer', ?)`)
      .run(new Date().toISOString());
    original.close();

    // A separate, fully-migrated "pending" database elsewhere with different data --
    // stands in for a backup downloaded from (possibly) a different install and staged
    // for restore via POST /api/admin/restore.
    const pendingSourceDir = mkdtempSync(join(tmpdir(), 'ktdash-pending-'));
    const pendingDb = openDb(pendingSourceDir);
    pendingDb.prepare(`INSERT INTO beers (name, created_at) VALUES ('Restored Beer', ?)`)
      .run(new Date().toISOString());
    pendingDb.close();
    copyFileSync(join(pendingSourceDir, 'app.db'), join(dir, 'pending-restore.db'));

    const reopened = openDb(dir);
    const beers = reopened.prepare('SELECT name FROM beers').all().map((r: any) => r.name);
    expect(beers).toEqual(['Restored Beer']);
    reopened.close();

    expect(existsSync(join(dir, 'app.db.bak'))).toBe(true);
    expect(existsSync(join(dir, 'pending-restore.db'))).toBe(false);

    const bak = new Database(join(dir, 'app.db.bak'), { readonly: true });
    const bakBeers = bak.prepare('SELECT name FROM beers').all().map((r: any) => r.name);
    expect(bakBeers).toEqual(['Original Beer']);
    bak.close();
  });

  it('a fresh restore overwrites a previous .bak (one-shot, not a history)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const first = openDb(dir);
    first.prepare(`INSERT INTO beers (name, created_at) VALUES ('Gen 1', ?)`).run(new Date().toISOString());
    first.close();

    function stagePending(name: string) {
      const srcDir = mkdtempSync(join(tmpdir(), 'ktdash-pending-'));
      const srcDb = openDb(srcDir);
      srcDb.prepare(`INSERT INTO beers (name, created_at) VALUES (?, ?)`).run(name, new Date().toISOString());
      srcDb.close();
      copyFileSync(join(srcDir, 'app.db'), join(dir, 'pending-restore.db'));
    }

    stagePending('Gen 2');
    const second = openDb(dir);
    second.close();

    stagePending('Gen 3');
    const third = openDb(dir);
    const beers = third.prepare('SELECT name FROM beers').all().map((r: any) => r.name);
    expect(beers).toEqual(['Gen 3']);
    third.close();

    // .bak holds only the most recently replaced generation (Gen 2), not Gen 1.
    const bak = new Database(join(dir, 'app.db.bak'), { readonly: true });
    const bakBeers = bak.prepare('SELECT name FROM beers').all().map((r: any) => r.name);
    expect(bakBeers).toEqual(['Gen 2']);
    bak.close();
  });

  it('is a no-op when no pending-restore.db exists: no .bak created, existing data untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ktdash-'));
    const db1 = openDb(dir);
    db1.prepare(`INSERT INTO beers (name, created_at) VALUES ('Steady Beer', ?)`).run(new Date().toISOString());
    db1.close();

    const db2 = openDb(dir);
    expect(db2.prepare('SELECT name FROM beers').all()).toEqual([{ name: 'Steady Beer' }]);
    db2.close();

    expect(existsSync(join(dir, 'app.db.bak'))).toBe(false);
  });
});
