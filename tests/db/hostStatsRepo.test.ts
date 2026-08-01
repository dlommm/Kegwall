import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import {
  listHostStats, listHostStatsBucketed, pruneHostStats, recordHostStats,
  type HostStatsPoint,
} from '../../src/server/db/hostStatsRepo.js';

let db: Database.Database;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
});

function point(minutesAgo: number, overrides: Partial<HostStatsPoint> = {}): HostStatsPoint {
  return {
    ts: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    cpuPct: 10, memPct: 30, diskPct: 50, tempC: 45, watts: 6,
    ...overrides,
  };
}

describe('hostStatsRepo', () => {
  it('records and lists points since a cutoff, oldest first', () => {
    recordHostStats(db, point(120));
    recordHostStats(db, point(10, { cpuPct: 99 }));
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const rows = listHostStats(db, since);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cpuPct).toBe(99);
    expect(rows[0]!.diskPct).toBe(50);
  });

  it('preserves nulls for hosts without disk/temp/watts figures', () => {
    recordHostStats(db, point(1, { diskPct: null, tempC: null, watts: null }));
    const rows = listHostStats(db, new Date(0).toISOString());
    expect(rows[0]).toMatchObject({ diskPct: null, tempC: null, watts: null });
  });

  it('buckets down to maxPoints with per-bucket averages, keeping all-null columns null', () => {
    for (let i = 0; i < 10; i++) {
      recordHostStats(db, point(10 - i, { cpuPct: i * 10, watts: null }));
    }
    const rows = listHostStatsBucketed(db, new Date(0).toISOString(), 5);
    expect(rows).toHaveLength(5);
    // First bucket = samples 0%,10% → 5%.
    expect(rows[0]!.cpuPct).toBe(5);
    expect(rows[0]!.watts).toBeNull();
    // Under the cap: passthrough, no bucketing.
    expect(listHostStatsBucketed(db, new Date(0).toISOString(), 100)).toHaveLength(10);
  });

  it('prunes rows older than the retention window', () => {
    recordHostStats(db, point(40 * 24 * 60)); // 40 days old
    recordHostStats(db, point(1));
    expect(pruneHostStats(db, 30)).toBe(1);
    expect(listHostStats(db, new Date(0).toISOString())).toHaveLength(1);
  });
});
