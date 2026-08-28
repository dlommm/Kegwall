// --- Displays & Presence hub Tasks 4/5: /admin/presence ----------------------
// From db/settings.ts, a plain db module — safe to type-import (see ./settings.ts's doc
// comment on that file).
import type { MotionSource } from '../../../server/db/settings.js';
// From core/motionSources.ts, NOT routes/presence.ts — same "type-only import of a
// ROUTES file drags its Fastify-request-augmenting value imports into this (web)
// tsconfig's program" issue documented for core/lookupTypes.ts (see ./beers.ts).
// motionSources.ts is a plain core module (its own imports are all `import type` except
// a value import of db/settings.ts's `parseMotionSources`, itself dependency-free beyond
// zod) — safe to type-import here the same way core/wallConfig.ts's `WallConfig` is in
// ./walls.ts.
import type { MotionSourceStatus } from '../../../server/core/motionSources.js';
import { request, type ApiResult } from '../adminHttp';

// --- Task 4: Zones + Display power panels ------------------------------------

/** `GET /api/presence/sources`'s full response shape (routes/presence.ts): configured
 * motion sources (registry snapshot — config + runtime status), derived camera rows (one
 * per wall with `displayPower.cameraMotion` on, status read from the `camera:<slug>`
 * sentinel), and live agent (open `/api/presence/stream` SSE connection) counts per wall
 * slug. This task's Zones panel only reads `agents`; Task 5's motion-sources table and
 * webhook panel read `sources`/`camera` — defined fully now so that task builds on this
 * type rather than widening it later. */
export interface PresenceSourcesResponse {
  sources: { source: MotionSource; status: MotionSourceStatus }[];
  camera: { wallSlug: string; enabled: boolean; lastTriggeredAt: string | null }[];
  agents: { wall: string; connections: number }[];
}

export function getPresenceSources(): Promise<ApiResult<PresenceSourcesResponse>> {
  return request('/api/presence/sources');
}

/** POST /api/presence/state — admin role. Backs the Zones panel's per-wall Wake/Sleep
 * buttons and its "Wake all" action: `wall` omitted targets every wall at once (see
 * routes/presence.ts, `presence.setState(wall ?? null, state)`). `wall` is the wall's
 * SLUG — matching every other presence route (`POST /api/presence/wake`, the SSE
 * stream's `?wall=`), never its numeric id. */
export function setPresenceState(
  wall: string | undefined,
  state: import('../displayPower').PowerStage,
): Promise<ApiResult<{ ok: true }>> {
  return request('/api/presence/state', {
    method: 'POST',
    body: JSON.stringify(wall !== undefined ? { wall, state } : { state }),
  });
}

// --- Task 5: motion-sources table + webhook panel ----------------------------

/** POST /api/presence/sources — admin role. `body` is a `MotionSource` sans `id` (the
 * server stamps one via `crypto.randomUUID()` and re-validates the whole shape through
 * `motionSourceSchema`, including the per-type `config` requirement — see routes/
 * presence.ts); 201 on success. Backs the Sources panel's add-source modal. */
export function createPresenceSource(
  body: Omit<MotionSource, 'id'>,
): Promise<ApiResult<MotionSource>> {
  return request('/api/presence/sources', { method: 'POST', body: JSON.stringify(body) });
}

/** PATCH /api/presence/sources/:id — admin role. A shallow top-level merge server-side (a
 * patched `config` REPLACES the whole field rather than deep-merging into it — same
 * "client sends back a full sub-object" idiom as `settings.sanitizePatch`), re-parsed
 * through the same `motionSourceSchema` as create so a patch can't leave a source in an
 * invalid per-type shape. Backs the Sources panel's edit modal. */
export function updatePresenceSource(
  id: string, patch: Partial<Omit<MotionSource, 'id'>>,
): Promise<ApiResult<MotionSource>> {
  return request(`/api/presence/sources/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/** DELETE /api/presence/sources/:id — admin role; idempotent 204 (an unknown id is a
 * no-op, not a 404 — see routes/presence.ts, same idiom as `deleteBeer`/`deleteTap`). */
export function deletePresenceSource(id: string): Promise<ApiResult<null>> {
  return request(`/api/presence/sources/${id}`, { method: 'DELETE' });
}
