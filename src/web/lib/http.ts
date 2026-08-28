/**
 * The ONE shared fetch transport behind both typed API clients — `./api.ts` (public
 * endpoints) and `./adminApi.ts` (authed admin endpoints). Both used to carry a
 * near-verbatim copy of this function, which meant every transport-level fix had to be
 * applied twice (the FST_ERR_CTP_EMPTY_JSON_BODY Content-Type fix below literally was —
 * commit 90d6871 in adminApi.ts, then mirrored into api.ts in the Phase 5 final-review
 * fix wave). This module exists so that class of drift can't recur: the genuine
 * per-client differences (credentials, extra headers, 401 handling) are parameters via
 * `HttpRequestOptions`; everything else lives here exactly once.
 *
 * The contract (shared by every caller): NEVER throw — always resolve to a typed
 * `ApiResult`, with `status: 0` for a request that never reached the server.
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

/** The genuine differences between the two clients, parameterized. */
export interface HttpRequestOptions {
  /** `adminApi` passes `'same-origin'` explicitly (its calls always need the session
   * cookie, so the intent shouldn't rely on fetch's implicit spec default); the public
   * client passes nothing and keeps the default. */
  credentials?: RequestCredentials;
  /** Client-level headers computed per request (the public client's display-token
   * header). Evaluated at call time, not module load, because the token can be paired
   * mid-session. Explicit per-call `init.headers` still win (spread last below). */
  extraHeaders?: () => Record<string, string>;
  /** Invoked on any 401 response, before the typed failure is returned — `adminApi`'s
   * "session died/missing -> back to login" redirect hook. The public client has no
   * session to lose and passes nothing. */
  onUnauthorized?: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function httpRequest<T>(
  path: string,
  init?: RequestInit,
  options: HttpRequestOptions = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      ...(options.credentials !== undefined ? { credentials: options.credentials } : {}),
      // A FormData body (label upload, restore upload) must NOT get a 'Content-Type:
      // application/json' header — the browser sets its own 'multipart/form-data;
      // boundary=...' for FormData, and stamping application/json over it would break
      // the upload server-side.
      //
      // Phase 5 Task 7 fix (and its api.ts mirror, Phase 5 final-review fix wave I1):
      // a BODYLESS request (every caller that passes no `body` at all — logout, ack,
      // run-now, every DELETE, etc.) must ALSO not get the JSON content-type header.
      // Fastify's default JSON body parser rejects an empty body when `Content-Type:
      // application/json` is set at all (`FST_ERR_CTP_EMPTY_JSON_BODY`, statusCode 400)
      // — this app's generic error handler doesn't recognize that Fastify-native error
      // class and was mapping it to an opaque 500, so EVERY bodyless POST/DELETE call in
      // the admin UI was silently broken against a real server (caught by a real
      // Playwright/Chromium round trip — see the Task 7 e2e notification-ack test and
      // adminApi.test.ts's own regression test; every other client test mocks `fetch`
      // itself, so none of them ever exercised real server body-parsing behavior). A
      // request with no body has no content to declare a type for in the first place,
      // so this is also just correct HTTP.
      headers: {
        ...(init?.body !== undefined && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.extraHeaders?.() ?? {}),
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
    if (res.status === 401) {
      options.onUnauthorized?.();
    }
    return { ok: false, status: res.status, message };
  }

  return { ok: true, data: body as T };
}
