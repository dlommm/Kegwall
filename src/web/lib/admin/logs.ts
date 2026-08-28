// --- Pour Wall overhaul Phase 4: the unified log stream (design 5d) ---------
import { request, type ApiResult } from '../adminHttp';

export type { LogEntry, LogLevel, LogSource } from '../../../server/db/logs.js';

export interface LogsResponse {
  entries: import('../../../server/db/logs.js').LogEntry[];
  counts: Record<import('../../../server/db/logs.js').LogLevel, number>;
  total: number;
  retentionDays: number;
}

export interface LogsQuery {
  sources?: string[];
  levels?: string[];
  q?: string;
  hours?: number;
  afterId?: number;
  limit?: number;
}

export function logsQueryString(query: LogsQuery): string {
  const params = new URLSearchParams();
  if (query.sources && query.sources.length > 0) params.set('sources', query.sources.join(','));
  if (query.levels && query.levels.length > 0) params.set('levels', query.levels.join(','));
  if (query.q) params.set('q', query.q);
  if (query.hours) params.set('hours', String(query.hours));
  if (query.afterId !== undefined) params.set('afterId', String(query.afterId));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return params.toString();
}

/** GET /api/logs — viewer role. */
export function getLogs(query: LogsQuery = {}): Promise<ApiResult<LogsResponse>> {
  const qs = logsQueryString(query);
  return request(`/api/logs${qs ? `?${qs}` : ''}`);
}
