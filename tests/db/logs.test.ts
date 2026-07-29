import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/server/db/db.js';
import {
  insertLog, queryLogs, countLogsByLevel, countLogs, pruneLogs,
} from '../../src/server/db/logs.js';

let db: Database.Database;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
});

describe('logs repo (design 5d)', () => {
  it('inserts and queries newest-first', () => {
    insertLog(db, { level: 'info', source: 'app', message: 'first', ts: '2026-07-29T10:00:00.000Z' });
    insertLog(db, { level: 'warn', source: 'kegtron', message: 'second', ts: '2026-07-29T11:00:00.000Z' });
    const rows = queryLogs(db);
    expect(rows.map((r) => r.message)).toEqual(['second', 'first']);
    expect(rows[0]!.level).toBe('warn');
    expect(rows[0]!.source).toBe('kegtron');
  });

  it('filters by source, level, search text and since', () => {
    insertLog(db, { level: 'info', source: 'pours', message: 'Pour complete tap 2', ts: '2026-07-29T10:00:00.000Z' });
    insertLog(db, { level: 'error', source: 'kegtron', message: 'Cloud API timeout', ts: '2026-07-29T11:00:00.000Z' });
    insertLog(db, { level: 'warn', source: 'sensors', message: 'Spread approaching threshold', ts: '2026-07-29T12:00:00.000Z' });

    expect(queryLogs(db, { sources: ['kegtron'] })).toHaveLength(1);
    expect(queryLogs(db, { levels: ['error', 'warn'] })).toHaveLength(2);
    expect(queryLogs(db, { q: 'timeout' })[0]!.message).toContain('timeout');
    expect(queryLogs(db, { q: 'TIMEOUT' })).toHaveLength(1); // case-insensitive
    expect(queryLogs(db, { since: '2026-07-29T11:30:00.000Z' })).toHaveLength(1);
  });

  it('supports the live tail afterId cursor', () => {
    const a = insertLog(db, { level: 'info', source: 'app', message: 'a' });
    insertLog(db, { level: 'info', source: 'app', message: 'b' });
    const fresh = queryLogs(db, { afterId: a.id });
    expect(fresh.map((r) => r.message)).toEqual(['b']);
  });

  it('counts by level within a window', () => {
    insertLog(db, { level: 'info', source: 'app', message: 'x' });
    insertLog(db, { level: 'warn', source: 'app', message: 'y' });
    insertLog(db, { level: 'error', source: 'app', message: 'z' });
    insertLog(db, { level: 'error', source: 'app', message: 'old', ts: '2020-01-01T00:00:00.000Z' });
    const counts = countLogsByLevel(db, '2026-01-01T00:00:00.000Z');
    expect(counts).toEqual({ info: 1, warn: 1, error: 1 });
    expect(countLogs(db)).toBe(4);
  });

  it('prunes rows older than the retention window', () => {
    insertLog(db, { level: 'info', source: 'app', message: 'old', ts: '2020-01-01T00:00:00.000Z' });
    insertLog(db, { level: 'info', source: 'app', message: 'new' });
    expect(pruneLogs(db, 30)).toBe(1);
    expect(queryLogs(db)).toHaveLength(1);
  });

  it('rejects unknown levels/sources at the schema layer', () => {
    expect(() => db.prepare(
      "INSERT INTO logs (ts, level, source, message) VALUES ('x', 'debug', 'app', 'm')",
    ).run()).toThrow();
    expect(() => db.prepare(
      "INSERT INTO logs (ts, level, source, message) VALUES ('x', 'info', 'mystery', 'm')",
    ).run()).toThrow();
  });
});
