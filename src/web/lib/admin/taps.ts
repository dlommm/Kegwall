// --- Task 5: taps & kegs (tap CRUD, swap wizard, on-deck queue) + line cleanings ---
import type { Keg, KegStatus, KegType } from '../../../server/db/kegs.js';
import type { Tap } from '../../../server/db/taps.js';
import { request, type ApiResult } from '../adminHttp';

export type { CleaningStatus, LineCleaning } from '../../../server/db/cleanings.js';

export function listTaps(): Promise<ApiResult<Tap[]>> {
  return request('/api/taps');
}

export function createTap(
  input: { number: number; name?: string | null; defaultDrinkerId?: number | null; hidden?: boolean },
): Promise<ApiResult<Tap>> {
  return request('/api/taps', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTap(
  id: number, input: { number?: number; name?: string | null; defaultDrinkerId?: number | null; hidden?: boolean },
): Promise<ApiResult<Tap>> {
  return request(`/api/taps/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/taps/:id — 204 on success; 409 (`ApiFailure`) when the tap still has kegs
 * on record or a bound monitor (see db/taps.ts's `deleteTap`). */
export function deleteTap(id: number): Promise<ApiResult<null>> {
  return request(`/api/taps/${id}`, { method: 'DELETE' });
}

/** GET /api/kegs, optionally filtered by status. Used both for the swap wizard's
 * "defaults from the beer's last keg" lookup (no filter — any status) and the taps
 * page's kicked-history panel (`status: 'kicked'`, filtered down to one tap client-side
 * — see TapsPage/KickedHistory's doc comment for why that reuses this endpoint rather
 * than a new per-tap one). */
export function listKegs(params: { status?: KegStatus } = {}): Promise<ApiResult<Keg[]>> {
  const qs = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return request(`/api/kegs${qs}`);
}

/** POST /api/kegs — a bare create (`status` omitted) makes an `on_tap` keg directly on a
 * free tap; `status: 'on_deck'` (with `tapId` required) queues it behind the tap's
 * current keg instead — the on-deck queue's "add to queue" action. */
export function createKeg(input: {
  beerId: number; sizeMl: number; volStartMl: number;
  tapId?: number | null; status?: 'on_deck'; kegType?: KegType;
}): Promise<ApiResult<Keg>> {
  return request('/api/kegs', { method: 'POST', body: JSON.stringify(input) });
}

/** DELETE /api/kegs/:id — removes a queued on-deck keg from its tap's queue; 400 for any
 * keg that isn't currently on_deck (see db/kegs.ts's `removeOnDeckKeg`). */
export function removeOnDeckKeg(id: number): Promise<ApiResult<null>> {
  return request(`/api/kegs/${id}`, { method: 'DELETE' });
}

/** GET /api/taps/:id/on-deck — the swap wizard's on-deck queue for one tap, in queue order. */
export function listOnDeck(tapId: number): Promise<ApiResult<Keg[]>> {
  return request(`/api/taps/${tapId}/on-deck`);
}

/** POST /api/taps/:id/swap — either taps a brand-new keg (`beerId`/`sizeMl`/`volStartMl`,
 * optionally `kegType`) or promotes an already-queued on-deck keg (`fromKegId`, which
 * ignores `kegType` — the promoted keg keeps whatever it was created with); either way,
 * any currently on_tap keg for this tap is kicked first (see db/kegs.ts's `swapKeg`). */
/** OWNER COST fields (redesign 4k) — the swap wizard's optional cost step. */
export interface KegCostInput {
  costCents?: number | null;
  depositCents?: number | null;
  supplierId?: number | null;
  purchasedAt?: string | null;
}

export function swapTap(
  tapId: number,
  input:
    | ({ beerId: number; sizeMl: number; volStartMl: number; kegType?: KegType } & KegCostInput)
    | { fromKegId: number },
): Promise<ApiResult<Keg>> {
  return request(`/api/taps/${tapId}/swap`, { method: 'POST', body: JSON.stringify(input) });
}

/** One row of the Kegs page's history — every keg (on tap + past), enriched with beer/tap/supplier
 * names and owner cost/sourcing (admin-only, from GET /api/kegs/history). */
export interface KegHistoryRow {
  id: number;
  status: KegStatus;
  beerId: number;
  beerName: string | null;
  tapId: number | null;
  tapNumber: number | null;
  tapName: string | null;
  sizeMl: number;
  volStartMl: number;
  volDispensedMl: number;
  dateTapped: string | null;
  kegType: KegType | null;
  costCents: number | null;
  depositCents: number | null;
  supplierId: number | null;
  supplierName: string | null;
  purchasedAt: string | null;
  createdAt: string;
}

/** GET /api/kegs/history — every keg with beer/tap/supplier + owner cost (admin). Backs the Kegs page. */
export function listKegHistory(): Promise<ApiResult<KegHistoryRow[]>> {
  return request('/api/kegs/history');
}

/** PATCH /api/kegs/:id — edit an existing keg's cost/supplier/deposit/purchase date (and/or status)
 * after the fact, e.g. adding a supplier to a keg that was tapped without one. */
export function updateKeg(id: number, patch: KegCostInput & { status?: KegStatus }): Promise<ApiResult<Keg>> {
  return request(`/api/kegs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function getCleaningStatuses(): Promise<ApiResult<import('../../../server/db/cleanings.js').CleaningStatus[]>> {
  return request('/api/cleanings/status');
}

/** Log a line cleaning. `cleanedAt` (redesign 4a) backdates it — a past ISO timestamp
 *  recomputes the counters; omit for "just now". */
export function logTapCleaning(
  tapId: number, opts: { note?: string; cleanedAt?: string } = {},
): Promise<ApiResult<import('../../../server/db/cleanings.js').LineCleaning>> {
  const body: Record<string, string> = {};
  if (opts.note) body.note = opts.note;
  if (opts.cleanedAt) body.cleanedAt = opts.cleanedAt;
  return request(`/api/taps/${tapId}/cleanings`, { method: 'POST', body: JSON.stringify(body) });
}
