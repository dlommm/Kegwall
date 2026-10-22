// --- Phase 5 Task 0: admin pours management (reassign/unclaim + per-tap default drinker) ---
import type { Pour } from '../../../server/db/kegs.js';
import { request, type ApiResult } from '../adminHttp';

export interface PourQuery {
  unclaimed?: boolean;
  drinkerId?: number;
  /** Inclusive ISO bounds on the pour timestamp. */
  since?: string;
  until?: string;
  /** Keyset cursor: only pours older than this pour (the previous page's last row). */
  beforeId?: number;
  limit?: number;
}

/** GET /api/pours — the admin Pours page's table (viewer role for the read;
 * reassign/unclaim below is what's editor-gated). Newest first (see `listPours`,
 * db/pours.ts); filters apply on the server before `limit`. */
export function listRecentPours(query: PourQuery = {}): Promise<ApiResult<Pour[]>> {
  const params = new URLSearchParams({ limit: String(query.limit ?? 100) });
  if (query.unclaimed) params.set('unclaimed', 'true');
  if (query.drinkerId !== undefined) params.set('drinkerId', String(query.drinkerId));
  if (query.since) params.set('since', query.since);
  if (query.until) params.set('until', query.until);
  if (query.beforeId !== undefined) params.set('beforeId', String(query.beforeId));
  return request(`/api/pours?${params.toString()}`);
}

/** PATCH /api/pours/drinker — editor-role bulk assign/unclaim, all-or-nothing. */
export function setPoursDrinker(pourIds: number[], drinkerId: number | null): Promise<ApiResult<Pour[]>> {
  return request('/api/pours/drinker', { method: 'PATCH', body: JSON.stringify({ pourIds, drinkerId }) });
}

/** PATCH /api/pours/:id/drinker — editor-role admin reassign/unclaim (`drinkerId: null`
 * unclaims). Unlike the public claim flow, this always overrides any existing claim —
 * see routes/crud.ts's doc comment on the route. */
export function setPourDrinker(pourId: number, drinkerId: number | null): Promise<ApiResult<Pour>> {
  return request(`/api/pours/${pourId}/drinker`, { method: 'PATCH', body: JSON.stringify({ drinkerId }) });
}
