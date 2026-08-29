// --- Pour Wall overhaul Phase 5: displays -----------------------------------
import { request, type ApiResult } from '../adminHttp';

export type { Display, DisplayOverrides } from '../../../server/db/displays.js';

export function listDisplays(): Promise<ApiResult<import('../../../server/db/displays.js').Display[]>> {
  return request('/api/displays');
}

export function createDisplay(input: { name: string; wallId?: number | null }): Promise<ApiResult<import('../../../server/db/displays.js').Display>> {
  return request('/api/displays', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDisplay(id: number, input: {
  name?: string; wallId?: number | null;
  overrides?: import('../../../server/db/displays.js').DisplayOverrides;
}): Promise<ApiResult<import('../../../server/db/displays.js').Display>> {
  return request(`/api/displays/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteDisplay(id: number): Promise<ApiResult<null>> {
  return request(`/api/displays/${id}`, { method: 'DELETE' });
}

/** Mints a fresh pairing code (codes expire 15 minutes after issue — see db/displays.ts).
 *  A screen that is already paired keeps its token and stays connected. */
export function regenerateDisplayCode(id: number): Promise<ApiResult<import('../../../server/db/displays.js').Display>> {
  return request(`/api/displays/${id}/regenerate-code`, { method: 'POST' });
}
