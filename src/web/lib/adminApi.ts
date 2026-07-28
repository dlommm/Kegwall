import type { User } from '../../server/db/users.js';
import type { Pour } from '../../server/db/kegs.js';
import type { ActivityEvent } from '../../server/db/activity.js';
import type { SourceStatus } from '../../server/ingest/manager.js';
import type { Beer, BeerInput } from '../../server/db/beers.js';
// From core/lookupTypes.ts, NOT routes/lookup.ts — see that core module's doc comment:
// a type-only import of a ROUTES file would drag its Fastify-request-augmenting value
// imports into this (web) tsconfig's program, where they don't typecheck.
import type { BreweryLookupResult, UntappdLookupResult } from '../../server/core/lookupTypes.js';

/**
 * The authed variant of `./api.ts`'s typed-result fetch pattern (see that file's doc
 * comments — same shape, same "never throw, always return a typed result" contract).
 * The one behavioral difference: any 401 response redirects the browser to
 * `/admin/login`, UNLESS the current page IS `/admin/login` or `/admin/setup` — those
 * two pages call authed endpoints themselves (a bad login attempt 401s; the setup
 * probe on both pages calls `getMe`-adjacent endpoints before a session exists) and
 * need to render their own in-place error state instead of bouncing away from
 * themselves. This is the ONE place in the admin SPA that owns "session died/missing
 * -> back to login"; every later admin page (Tasks 3-9) is expected to build its own
 * authed API calls on top of `request` below rather than reimplementing this.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  /** HTTP status code, or 0 when the request never reached the server (network error). */
  status: number;
  message: string;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const LOGIN_PATH = '/admin/login';
const SETUP_PATH = '/admin/setup';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function onAuthPage(): boolean {
  const { pathname } = window.location;
  return pathname === LOGIN_PATH || pathname === SETUP_PATH;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      // Explicit even though same-origin is fetch's spec default — this call always
      // needs the session cookie, so the intent shouldn't rely on an implicit default.
      credentials: 'same-origin',
      // A FormData body (Task 4's uploadLabel) must NOT get a 'Content-Type:
      // application/json' header — the browser sets its own 'multipart/form-data;
      // boundary=...' for FormData, and stamping application/json over it would break
      // the upload server-side. Every other caller keeps today's exact behavior.
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message = isRecord(body) && typeof body.message === 'string'
      ? body.message
      : res.statusText || `Request failed with status ${res.status}`;
    if (res.status === 401 && !onAuthPage()) {
      window.location.assign(LOGIN_PATH);
    }
    return { ok: false, status: res.status, message };
  }

  return { ok: true, data: body as T };
}

export function needsSetup(): Promise<ApiResult<{ needsSetup: boolean }>> {
  return request('/api/auth/needs-setup');
}

export function getMe(): Promise<ApiResult<User>> {
  return request('/api/auth/me');
}

export function login(username: string, password: string): Promise<ApiResult<User>> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<ApiResult<{ ok: boolean }>> {
  return request('/api/auth/logout', { method: 'POST' });
}

export function setup(input: {
  username: string; displayName: string; password: string;
}): Promise<ApiResult<User>> {
  return request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Task 3: dashboard home ---

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

// --- Task 4: beers + lookup services ---

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

/** GET /api/lookup/untappd?q= — 501 `{error:'not_configured'}` (surfaced as
 * `ApiFailure` with `status: 501`) when Untappd creds aren't set; the Untappd search
 * sheet uses an empty `q` call as its own "is this even configured?" probe, since that
 * still 501s without needing a real search term. */
export function lookupUntappd(q: string): Promise<ApiResult<UntappdLookupResult[]>> {
  return request(`/api/lookup/untappd?q=${encodeURIComponent(q)}`);
}

/** POST /api/lookup/untappd/import — downloads `labelUrl` server-side into DATA_DIR/labels
 * and returns its stored `/labels/...` path; the beers form never renders the raw Untappd
 * CDN URL directly (see UntappdSearchSheet). */
export function importUntappdLabel(labelUrl: string): Promise<ApiResult<{ path: string }>> {
  return request('/api/lookup/untappd/import', {
    method: 'POST',
    body: JSON.stringify({ labelUrl }),
  });
}

/** POST /api/uploads/label — multipart file upload (Task 1); returns the stored
 * `/labels/...` path. Sends a real `FormData` body — see `request()`'s Content-Type
 * handling above for why that must NOT get a `application/json` header. */
export function uploadLabel(file: File): Promise<ApiResult<{ path: string }>> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/uploads/label', { method: 'POST', body: form });
}
