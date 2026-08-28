// --- Task 7: walls (list, editor, live preview) ---
// From core/wallConfig.ts, NOT routes/crud.ts — a type-only import of a routes file
// would drag in its Fastify-augmenting value imports (see core/lookupTypes.ts's doc
// comment for the general case). wallConfig.ts has no imports beyond zod, so it's a safe
// dependency-free type source for the `Wall` interface below (`routes/crud.ts` types its
// own `config` field as `unknown`; the client-side type is stricter since every wall
// PATCH already validates against this exact schema — see `web/lib/wallEditorConfig.ts`).
import type { WallConfig } from '../../../server/core/wallConfig.js';
import { request, type ApiResult } from '../adminHttp';

export interface Wall { id: number; slug: string; name: string; config: WallConfig }

export function listWalls(): Promise<ApiResult<Wall[]>> {
  return request('/api/walls');
}

/** GET /api/walls/:id — one wall, config freshly parsed server-side. Exists for callers
 * that PATCH a single field group of the config (PresencePage's display-power /
 * camera-motion writes): the whole-config PATCH body must be rebuilt from the server's
 * CURRENT config fetched immediately before the write, never from a wall list cached at
 * mount — rebasing on an hour-stale snapshot would silently revert every unrelated
 * config edit (look, theme, pages, ...) a colleague made in WallEditor since. */
export function getWall(id: number): Promise<ApiResult<Wall>> {
  return request(`/api/walls/${id}`);
}

/** `config` is left `unknown` on the way IN (the caller — `WallEditor`'s save flow —
 * always runs it through `wallConfigSchema`/`parseWallConfigForm` first, see
 * `wallEditorConfig.ts`; re-typing it here would just duplicate that check with a
 * weaker one). Omitting `config` entirely lets the walls list's "Add wall" form create a
 * bare wall (server fills schema defaults — see `routes/crud.ts`'s `createWall`). */
export function createWall(input: { slug: string; name: string; config?: unknown }): Promise<ApiResult<Wall>> {
  return request('/api/walls', { method: 'POST', body: JSON.stringify(input) });
}

export function updateWall(
  id: number,
  input: { slug?: string; name?: string; config?: unknown },
): Promise<ApiResult<Wall>> {
  return request(`/api/walls/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export type { WallDeviceRef } from '../../../server/db/wallDevices.js';

/** GET /api/walls/:id/devices — the Kegtron devices assigned to a wall (the wall shows
 * only taps bound to their ports; none assigned = the wall shows nothing). */
export function getWallDevices(
  wallId: number,
): Promise<ApiResult<import('../../../server/db/wallDevices.js').WallDeviceRef[]>> {
  return request(`/api/walls/${wallId}/devices`);
}

/** PUT /api/walls/:id/devices — replace-set the wall's device assignment. */
export function setWallDevices(
  wallId: number,
  devices: import('../../../server/db/wallDevices.js').WallDeviceRef[],
): Promise<ApiResult<import('../../../server/db/wallDevices.js').WallDeviceRef[]>> {
  return request(`/api/walls/${wallId}/devices`, { method: 'PUT', body: JSON.stringify({ devices }) });
}

/** DELETE /api/walls/:id — 204 on success; the wall's `/wall/:slug` URL stops resolving
 * immediately (no FK/conflict case today — nothing else references a wall row). */
export function deleteWall(id: number): Promise<ApiResult<null>> {
  return request(`/api/walls/${id}`, { method: 'DELETE' });
}
