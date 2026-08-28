// --- Task 4: beers + lookup services ---
import type { Beer, BeerInput } from '../../../server/db/beers.js';
// From core/lookupTypes.ts, NOT routes/lookup.ts — see that core module's doc comment:
// a type-only import of a ROUTES file would drag its Fastify-request-augmenting value
// imports into this (web) tsconfig's program, where they don't typecheck.
import type { BreweryLookupResult, BeerLookupResult } from '../../../server/core/lookupTypes.js';
import { request, type ApiResult } from '../adminHttp';

export function listBeers(): Promise<ApiResult<Beer[]>> {
  return request('/api/beers');
}

export function createBeer(input: BeerInput): Promise<ApiResult<Beer>> {
  return request('/api/beers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateBeer(id: number, input: Partial<BeerInput>): Promise<ApiResult<Beer>> {
  return request(`/api/beers/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/beers/:id — 204 no-content on success; 409 (`ApiFailure`, `status: 409`)
 * when the beer is still referenced by a keg (see db/beers.ts's `deleteBeer`). */
export function deleteBeer(id: number): Promise<ApiResult<null>> {
  return request(`/api/beers/${id}`, { method: 'DELETE' });
}

/** GET /api/lookup/breweries?q= — the beers form's brewery autocomplete. An empty `q`
 * still round-trips cleanly (server returns `[]` without calling the upstream service). */
export function lookupBreweries(q: string): Promise<ApiResult<BreweryLookupResult[]>> {
  return request(`/api/lookup/breweries?q=${encodeURIComponent(q)}`);
}

/** GET /api/lookup/beers?q= — the beers form's "Search catalog.beer" sheet (replaces the
 * removed Untappd search). Deliberately search-ON-SUBMIT only from every caller
 * (BeerSearchSheet), never per-keystroke — catalog.beer's free tier is 1,000 requests/
 * month. An empty `q` 501s `{error:'not_configured'}` when no API key is set (see
 * routes/lookup.ts) — BeerSearchSheet's own mount-time probe relies on exactly that, same
 * pattern the removed UntappdSearchSheet used against `lookupUntappd('')`. */
export function lookupBeers(q: string): Promise<ApiResult<BeerLookupResult[]>> {
  return request(`/api/lookup/beers?q=${encodeURIComponent(q)}`);
}

/** Non-secret lookup availability flags for the Beers page's LOOKUP chip row. */
export interface LookupConfig {
  catalogBeerConfigured: boolean;
  autoImportBeers: boolean;
}

/** GET /api/lookup/config — is catalog.beer keyed, and is Kegtron beer auto-import on. */
export function getLookupConfig(): Promise<ApiResult<LookupConfig>> {
  return request('/api/lookup/config');
}

/** POST /api/uploads/label — multipart file upload (Task 1); returns the stored
 * `/labels/...` path. Sends a real `FormData` body — see `httpRequest()`'s Content-Type
 * handling (lib/http.ts) for why that must NOT get a `application/json` header. */
export function uploadLabel(file: File): Promise<ApiResult<{ path: string }>> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/uploads/label', { method: 'POST', body: form });
}
