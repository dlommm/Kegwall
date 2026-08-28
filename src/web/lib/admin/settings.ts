// --- Task 8: settings + backup/restore ---
// From db/settings.ts, a plain db module with no Fastify-specific imports of its own (its
// only value import, core/errors.ts, is dependency-free) — safe to type-import here the
// same way db/beers.ts, db/taps.ts, etc. already are (see core/lookupTypes.ts's doc
// comment — referenced in ./beers.ts — for the routes-file case this is NOT: that one
// drags in Fastify request/reply augmentations that don't typecheck in tsconfig.web.json's
// program).
import type { Settings } from '../../../server/db/settings.js';
import { request, type ApiResult } from '../adminHttp';

/** GET /api/settings — secrets (kegtronApiKey, mqtt.password, alertChannels' per-channel
 * secrets) come back masked (see db/settings.ts's `masked()`); SettingsPage never PATCHes
 * one of these mask strings back — see `patchSettings` below. */
export function getSettings(): Promise<ApiResult<Settings>> {
  return request('/api/settings');
}

/** PATCH /api/settings — callers pass ONLY the keys that actually changed (the server
 * scopes writes to the literal top-level keys present on the request body — see
 * routes/crud.ts's `requestedKeys` — so an omitted key is left untouched, not reset to
 * its schema default). Returns the fresh masked settings on success. */
export function patchSettings(patch: Partial<Settings>): Promise<ApiResult<Settings>> {
  return request('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
}

/** POST /api/admin/restore — multipart upload of a full `app.db` snapshot (e.g. one
 * downloaded from this same install's own `GET /api/admin/backup`, or another install's)
 * to stage as `DATA_DIR/pending-restore.db`. Only takes effect on the NEXT server
 * restart — see db/db.ts's `applyPendingRestore` — this call alone changes nothing live. */
export function uploadRestore(file: File): Promise<ApiResult<{ ok: boolean; message: string }>> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/admin/restore', { method: 'POST', body: form });
}
