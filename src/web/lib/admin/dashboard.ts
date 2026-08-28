// --- Task 3: dashboard home ---
import type { Pour } from '../../../server/db/kegs.js';
import type { ActivityEvent } from '../../../server/db/activity.js';
import type { SourceStatus } from '../../../server/ingest/manager.js';
import { request, type ApiResult } from '../adminHttp';

/** GET /api/admin/activity — the dashboard's activity feed (viewer role). */
export function getActivity(): Promise<ApiResult<ActivityEvent[]>> {
  return request('/api/admin/activity');
}

/** GET /api/sources — per-source health, feeding the dashboard's source health card. */
export function getSources(): Promise<ApiResult<SourceStatus[]>> {
  return request('/api/sources');
}

/** GET /api/pours?since=... — used by the dashboard to total up today's pours (count +
 * volume). `2000` is the endpoint's own max `limit`, high enough that a single busy day
 * of pours is never silently truncated. */
export function getPoursSince(sinceIso: string): Promise<ApiResult<Pour[]>> {
  return request(`/api/pours?since=${encodeURIComponent(sinceIso)}&limit=2000`);
}
