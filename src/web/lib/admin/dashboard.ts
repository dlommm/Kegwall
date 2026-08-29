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

/** The endpoint's own max `limit` (see routes/crud.ts's `GET /api/pours` schema). */
const POURS_PAGE_LIMIT = 2000;
/** Pagination hard cap: 25 pages × 2000 = 50k pours in one day — far past any real
 * taproom, but a bound so a pathological dataset can't loop forever. */
const POURS_MAX_PAGES = 25;

/** GET /api/pours?since=... — used by the dashboard to total up today's pours (count +
 * volume). The endpoint caps `limit` at 2000 and offers no offset/cursor param, so a
 * day busier than one page would silently truncate with a single fetch; instead this
 * walks backwards through time using the `until` filter (rows come back `ORDER BY ts
 * DESC` — see db/pours.ts's `listPours`), passing each page's oldest `ts` as the next
 * page's inclusive `until` and de-duplicating on pour id (the boundary row, plus any
 * rows sharing its timestamp, appears on both pages). Stops at the first short page. */
export async function getPoursSince(sinceIso: string): Promise<ApiResult<Pour[]>> {
  const byId = new Map<number, Pour>();
  let until: string | undefined;
  for (let page = 0; page < POURS_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ since: sinceIso, limit: String(POURS_PAGE_LIMIT) });
    if (until !== undefined) params.set('until', until);
    // eslint-disable-next-line no-await-in-loop -- pages are inherently sequential: each needs the previous page's oldest ts
    const result = await request<Pour[]>(`/api/pours?${params.toString()}`);
    // Any page failing fails the whole read (the caller keeps its previous totals and
    // re-polls in 60s) — partial data would understate the day just like the old
    // single-fetch truncation did.
    if (!result.ok) return result;
    for (const pour of result.data) byId.set(pour.id, pour);
    if (result.data.length < POURS_PAGE_LIMIT) break;
    const oldestTs = result.data[result.data.length - 1]!.ts;
    // A full page sharing one timestamp can't advance the cursor — bail rather than spin.
    if (oldestTs === until) break;
    until = oldestTs;
  }
  return { ok: true, data: [...byId.values()] };
}
