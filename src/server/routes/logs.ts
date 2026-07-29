import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  queryLogs, countLogsByLevel, countLogs, LOG_SOURCES, LOG_LEVELS,
  type LogEntry, type LogLevel, type LogSource,
} from '../db/logs.js';

/**
 * `GET /api/logs` — the unified log stream (design 5d): source/level filters,
 * substring search, time range, incremental live tail (`afterId`), and export
 * (`format=json|csv` downloads the filtered window). Viewer role, same as the
 * other read-only admin surfaces.
 */

const RANGE_HOURS = ['1', '24', '168', '720'] as const;

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(entries: LogEntry[]): string {
  const header = 'ts,level,source,message,detail';
  const rows = entries.map((e) => [e.ts, e.level, e.source, e.message, e.detail ?? '']
    .map((v) => csvEscape(String(v))).join(','));
  return [header, ...rows].join('\n');
}

export async function logsRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };

  const querySchema = z.object({
    // Comma-separated lists; absent/empty means "all".
    sources: z.string().optional(),
    levels: z.string().optional(),
    q: z.string().max(200).optional(),
    hours: z.enum(RANGE_HOURS).default('24').transform(Number),
    afterId: z.coerce.number().int().optional(),
    limit: z.coerce.number().int().min(1).max(2000).default(300),
    format: z.enum(['json', 'csv']).optional(),
  });

  function parseList<T extends string>(raw: string | undefined, valid: readonly T[]): T[] | undefined {
    if (!raw) return undefined;
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const filtered = parts.filter((p): p is T => (valid as readonly string[]).includes(p));
    return filtered.length > 0 ? filtered : undefined;
  }

  app.get('/api/logs', viewer, async (req, reply) => {
    const query = querySchema.parse(req.query ?? {});
    const since = new Date(Date.now() - query.hours * 3600 * 1000).toISOString();
    const entries = queryLogs(db, {
      sources: parseList<LogSource>(query.sources, LOG_SOURCES),
      levels: parseList<LogLevel>(query.levels, LOG_LEVELS),
      q: query.q,
      since,
      afterId: query.afterId,
      limit: query.limit,
    });

    if (query.format === 'csv') {
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="kegtron-logs.csv"');
      return toCsv(entries);
    }
    if (query.format === 'json') {
      reply.header('Content-Disposition', 'attachment; filename="kegtron-logs.json"');
      return entries;
    }

    return {
      entries,
      counts: countLogsByLevel(db, since),
      total: countLogs(db, since),
      retentionDays: app.ctx.settings.get('logRetentionDays'),
    };
  });
}
