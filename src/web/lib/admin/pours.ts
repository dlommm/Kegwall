// --- Phase 5 Task 0: admin pours management (reassign/unclaim + per-tap default drinker) ---
import type { Pour } from '../../../server/db/kegs.js';
import { request, type ApiResult } from '../adminHttp';

/** GET /api/pours?limit=100 — the pours admin page's "recent 100" table (viewer role for
 * the read; reassign/unclaim below is what's editor-gated). Newest first (see
 * `listPours`, db/pours.ts). */
export function listRecentPours(): Promise<ApiResult<Pour[]>> {
  return request('/api/pours?limit=100');
}

/** PATCH /api/pours/:id/drinker — editor-role admin reassign/unclaim (`drinkerId: null`
 * unclaims). Unlike the public claim flow, this always overrides any existing claim —
 * see routes/crud.ts's doc comment on the route. */
export function setPourDrinker(pourId: number, drinkerId: number | null): Promise<ApiResult<Pour>> {
  return request(`/api/pours/${pourId}/drinker`, { method: 'PATCH', body: JSON.stringify({ drinkerId }) });
}
