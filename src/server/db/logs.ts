import type Database from 'better-sqlite3';

/**
 * The unified log stream's repo (design 5d) — see core/logService.ts for who
 * writes and migrations/007_logs.sql for the table.
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'app' | 'kegtron' | 'wall' | 'tablet' | 'sensors' | 'automations' | 'pours' | 'faces';

export const LOG_SOURCES: readonly LogSource[] = [
  'app', 'kegtron', 'wall', 'tablet', 'sensors', 'automations', 'pours', 'faces',
];
export const LOG_LEVELS: readonly LogLevel[] = ['info', 'warn', 'error'];

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  detail: string | null;
}

function rowToEntry(r: any): LogEntry {
  return {
    id: r.id, ts: r.ts, level: r.level, source: r.source, message: r.message, detail: r.detail,
  };
}

export function insertLog(db: Database.Database, input: {
  ts?: string; level: LogLevel; source: LogSource; message: string; detail?: string | null;
}): LogEntry {
  const res = db.prepare(
    'INSERT INTO logs (ts, level, source, message, detail) VALUES (?, ?, ?, ?, ?)',
  ).run(input.ts ?? new Date().toISOString(), input.level, input.source, input.message, input.detail ?? null);
  return rowToEntry(db.prepare('SELECT * FROM logs WHERE id = ?').get(Number(res.lastInsertRowid)));
}

export interface LogQuery {
  sources?: LogSource[];
  levels?: LogLevel[];
  /** Case-insensitive substring match on the message. */
  q?: string;
  since?: string;
  /** Only rows with id > afterId — the live tail's incremental fetch. */
  afterId?: number;
  limit?: number;
}

export function queryLogs(db: Database.Database, query: LogQuery = {}): LogEntry[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.sources && query.sources.length > 0) {
    clauses.push(`source IN (${query.sources.map(() => '?').join(',')})`);
    params.push(...query.sources);
  }
  if (query.levels && query.levels.length > 0) {
    clauses.push(`level IN (${query.levels.map(() => '?').join(',')})`);
    params.push(...query.levels);
  }
  if (query.q) {
    clauses.push('message LIKE ? COLLATE NOCASE');
    params.push(`%${query.q}%`);
  }
  if (query.since) {
    clauses.push('ts >= ?');
    params.push(query.since);
  }
  if (query.afterId !== undefined) {
    clauses.push('id > ?');
    params.push(query.afterId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(query.limit ?? 500, 2000);
  return db.prepare(`SELECT * FROM logs ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit).map(rowToEntry);
}

/** Warn/error counts inside the window — the filter chips' badge numbers. */
export function countLogsByLevel(db: Database.Database, since?: string): Record<LogLevel, number> {
  const where = since ? 'WHERE ts >= ?' : '';
  const rows = db.prepare(`SELECT level, COUNT(*) c FROM logs ${where} GROUP BY level`)
    .all(...(since ? [since] : [])) as { level: LogLevel; c: number }[];
  const counts: Record<LogLevel, number> = { info: 0, warn: 0, error: 0 };
  for (const r of rows) counts[r.level] = r.c;
  return counts;
}

export function countLogs(db: Database.Database, since?: string): number {
  const where = since ? 'WHERE ts >= ?' : '';
  return (db.prepare(`SELECT COUNT(*) c FROM logs ${where}`).get(...(since ? [since] : [])) as any).c;
}

/** Deletes rows older than `retentionDays` (design footer: "Retention: 30 days,
 * configurable"). Called at boot alongside the other prunes (see context.ts). */
export function pruneLogs(db: Database.Database, retentionDays = 30): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();
  return db.prepare('DELETE FROM logs WHERE ts < ?').run(cutoff).changes;
}
