import { httpRequest, type ApiResult } from './http';

/**
 * The authed variant of `./api.ts`'s typed-result fetch pattern (see `./http.ts`'s doc
 * comments — same shape, same "never throw, always return a typed result" contract).
 * The one behavioral difference: any 401 response redirects the browser to
 * `/admin/login?next=<current path>` (LoginPage sends the admin back to `next` after a
 * successful re-login — validated through `sanitizeNextPath` below so the param can
 * never become an open redirect), UNLESS the current page IS `/admin/login` or `/admin/setup` — those
 * two pages call authed endpoints themselves (a bad login attempt 401s; the setup
 * probe on both pages calls `getMe`-adjacent endpoints before a session exists) and
 * need to render their own in-place error state instead of bouncing away from
 * themselves. This is the ONE place in the admin SPA that owns "session died/missing
 * -> back to login"; every admin page's API module (see `./admin/`) is expected to build
 * its own authed API calls on top of `request` below rather than reimplementing this.
 */

// Re-exported so the `./adminApi.ts` barrel (and every existing
// `import { ApiResult } from '../../lib/adminApi'` site behind it) keeps working.
export type { ApiSuccess, ApiFailure, ApiResult } from './http';

const LOGIN_PATH = '/admin/login';
const SETUP_PATH = '/admin/setup';

function onAuthPage(): boolean {
  const { pathname } = window.location;
  return pathname === LOGIN_PATH || pathname === SETUP_PATH;
}

/**
 * Open-redirect guard for the login page's `?next=` return-to param (see the 401 redirect
 * below, which writes it, and LoginPage, which follows it after a successful login).
 * Accepts ONLY a same-origin RELATIVE path: it must start with a single `/` — `//host`
 * (protocol-relative) and `/\host` (backslash-normalized by browsers into `//host`) are
 * rejected, as is anything absolute (`https://…`) or empty. Returns null for anything
 * unsafe so the caller falls back to its own default landing page.
 */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

/**
 * One-shot latch around the 401 login redirect. When a session dies, every in-flight
 * admin call 401s together (the dashboard alone fires a handful of parallel reads), and
 * `window.location.assign` only STARTS a navigation — JS keeps running until the page
 * actually unloads, so without the latch each concurrent 401 would call assign again.
 * A real browser clears this module state by unloading on navigation; jsdom never
 * navigates, hence the test-only reset below.
 */
let redirectingToLogin = false;

/** Test-only: jsdom never unloads the page, so suites that exercise the 401 redirect
 * reset the latch between tests. Production code must never call this. */
export function resetLoginRedirectForTests(): void {
  redirectingToLogin = false;
}

export function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  return httpRequest<T>(path, init, {
    // Explicit even though same-origin is fetch's spec default — this call always
    // needs the session cookie, so the intent shouldn't rely on an implicit default.
    credentials: 'same-origin',
    onUnauthorized: () => {
      if (onAuthPage() || redirectingToLogin) return;
      redirectingToLogin = true;
      // Preserve WHERE the admin was (path + query + hash) so LoginPage can send them
      // back after re-login instead of dumping them on the dashboard. `?? ''` because
      // tests stub `window.location` with a bare object that may omit search/hash.
      const { pathname, search, hash } = window.location;
      const next = `${pathname}${search ?? ''}${hash ?? ''}`;
      window.location.assign(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
    },
  });
}
