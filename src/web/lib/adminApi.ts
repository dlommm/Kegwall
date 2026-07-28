import type { User } from '../../server/db/users.js';
import type { Pour } from '../../server/db/kegs.js';
import type { ActivityEvent } from '../../server/db/activity.js';
import type { SourceStatus } from '../../server/ingest/manager.js';

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
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
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
