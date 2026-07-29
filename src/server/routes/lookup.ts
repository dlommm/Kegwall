import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { MAX_BYTES, writeLabelFile } from './uploads.js';
import type { BreweryLookupResult } from '../core/lookupTypes.js';
import { assertPublicHost, ForbiddenHostError, type HostResolver } from '../core/ssrfGuard.js';

// ---------------------------------------------------------------------------
// Task 4: a read-only lookup proxy (Open Brewery DB) that lets the beers form
// autocomplete a brewery name, plus `downloadAndStoreLabel` — a generic remote label
// download helper, SSRF-guarded, that fetches a caller-supplied image URL server-side and
// stores it locally so nothing in the admin UI ever hotlinks a third-party CDN directly.
//
// The Untappd search/import integration that originally lived here (beer-metadata +
// label-art lookup against Untappd's v4 API) was removed entirely — Untappd stopped
// granting new developer API credentials, making the feature unusable for any new
// install. `downloadAndStoreLabel` survives that removal unchanged: `routes/kegtron.ts`'s
// Kegtron Pro import handler is its only caller now, downloading a Pro device's own
// configured label art (see that file, and `ingest/kegtron/shadow.ts`'s
// `decodeUntappdLabelUrl` — a Kegtron Pro device-spec detail, not part of the removed
// Untappd search integration).
//
// Every upstream call gets a short (default 5s, injectable — see `lookupRoutes`'
// `opts.timeoutMs`, same pattern as MdashClient's `timeoutMs` / app.ts's
// `wsPingIntervalMs`) timeout and degrades to a clean 502 on any failure — a flaky
// third-party API should never surface as a raw 500 or hang the beers form.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Open Brewery DB v1's `/breweries/search` response is a bare array. The API has, over
 * its lifetime, used both `state` and `state_province` for the same field — `state_province`
 * is preferred when present, with `state` as a fallback so this keeps working against
 * either shape. Rows with no name are dropped (nothing useful to autocomplete with). */
function mapBreweries(body: unknown): BreweryLookupResult[] {
  if (!Array.isArray(body)) return [];
  const out: BreweryLookupResult[] = [];
  for (const row of body) {
    if (!isRecord(row)) continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const state = typeof row.state_province === 'string'
      ? row.state_province
      : typeof row.state === 'string' ? row.state : null;
    out.push({ name, city: typeof row.city === 'string' ? row.city : null, state });
  }
  return out;
}

/** Thrown by `readCapped` when the streamed body exceeds `maxBytes` — kept as its own
 * class (rather than a magic string/sentinel) so the route handler can `instanceof`
 * check it without confusing a genuine oversize download with any other failure. */
class PayloadTooLargeError extends Error {}

/** Reads `res`'s body into a `Buffer`, aborting the moment more than `maxBytes` have
 * arrived — deliberately NOT trusting a `Content-Length` header (an upstream could omit
 * or lie about it) the way `uploads.ts`'s multipart handler doesn't trust a declared
 * mimetype. Cancels the underlying stream on overflow so the download doesn't keep
 * running in the background after the request is rejected. */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new PayloadTooLargeError();
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Sentinel distinguishing "upstream call failed" (network error, timeout, non-2xx
 * status, or a malformed/non-JSON body) from "upstream returned a legitimately empty or
 * null JSON body" — a plain `null` return can't disambiguate those two cases. */
const FETCH_FAILED = Symbol('fetch_failed');

/** Fetches `url` and parses its JSON body, collapsing EVERY failure mode above to
 * `FETCH_FAILED` — the GET lookup handler below treats that as "degrade gracefully to a
 * 502", never surfacing `err.message` (some fetch failures embed the full request URL) or
 * a raw upstream response body. */
async function fetchJsonOrFail(url: string, timeoutMs: number): Promise<unknown | typeof FETCH_FAILED> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return FETCH_FAILED;
    return await res.json();
  } catch {
    return FETCH_FAILED;
  }
}

export interface LabelDownloadOptions {
  timeoutMs: number;
  /** Overrides the SSRF guard's DNS resolver — tests only; see `core/ssrfGuard.ts`. */
  resolveHost?: HostResolver;
  /** Test-only escape hatch for the SSRF guard — never set outside a test build; see
   * `LookupRoutesOptions.allowInsecureHosts` below, which is where production/tests
   * actually source this. */
  allowInsecureHosts?: boolean;
}

export type LabelDownloadResult =
  | { ok: true; path: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Downloads `rawUrl` through the SSRF-guarded path (http(s)-scheme allowlist ->
 * `assertPublicHost` -> `redirect: 'error'` -> size-capped streamed read -> magic-byte
 * validation) and, on success, writes it into `labelsDir` via `writeLabelFile`. A generic
 * remote label download helper — `routes/kegtron.ts`'s Pro import handler (Phase 5 Task 0:
 * decode a port's `labelUrl` into label art) is its only caller, treating any failure as
 * "just skip the label, still create the beer" (see that file). Every failure mode here is
 * returned as a typed result rather than thrown/replied-to directly, so a caller can decide
 * its own response shape instead of this helper assuming one.
 */
export async function downloadAndStoreLabel(
  labelsDir: string,
  rawUrl: string,
  opts: LabelDownloadOptions,
): Promise<LabelDownloadResult> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, error: 'validation', message: 'labelUrl must be a valid URL' };
  }
  // http(s) only — blocks file://, data:, and other schemes a raw fetch() would
  // otherwise happily follow. The HOST-based SSRF guard (loopback/private/link-local/
  // etc.) is the next check below, in core/ssrfGuard.ts.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, status: 400, error: 'validation', message: 'labelUrl must be an http(s) URL' };
  }

  // SSRF guard: reject a literal loopback/private/link-local/unspecified/unique-local
  // host outright, and reject a hostname that resolves to ANY such address — this is
  // the only place in the app where a user-supplied host reaches a server-side fetch.
  // See core/ssrfGuard.ts for the full range list and the documented DNS-rebinding
  // caveat this check does NOT close (the fetch call below closes off the OTHER
  // bypass this check alone doesn't — a validated public host 302ing to a private
  // one — via `redirect: 'error'`, not by re-validating each hop).
  if (!opts.allowInsecureHosts) {
    try {
      await assertPublicHost(target, { resolve: opts.resolveHost });
    } catch (err) {
      if (err instanceof ForbiddenHostError) {
        return { ok: false, status: 400, error: 'validation', message: err.message };
      }
      throw err;
    }
  }

  let res: Response;
  try {
    // redirect: 'error' — a validated PUBLIC host could still 302 to a private/
    // loopback address (or to cloud metadata), and following it would silently bypass
    // the assertPublicHost() check above entirely (that check never re-runs against
    // the redirect target). Refusing every redirect outright closes this off
    // completely, rather than trying to re-validate each hop.
    res = await fetch(target, { signal: AbortSignal.timeout(opts.timeoutMs), redirect: 'error' });
  } catch (err) {
    if (isRedirectRejection(err)) {
      return {
        ok: false, status: 400, error: 'validation',
        message: 'That image URL redirects somewhere else. Use the direct image URL.',
      };
    }
    return { ok: false, status: 502, error: 'upstream_error', message: 'Could not download the label image' };
  }
  if (!res.ok) {
    return { ok: false, status: 502, error: 'upstream_error', message: 'Could not download the label image' };
  }

  let buf: Buffer;
  try {
    buf = await readCapped(res, MAX_BYTES);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return { ok: false, status: 413, error: 'payload_too_large', message: 'Label image exceeds the 5MB limit' };
    }
    throw err;
  }

  const path = writeLabelFile(labelsDir, buf);
  if (!path) {
    return {
      ok: false, status: 400, error: 'validation',
      message: 'Downloaded file is not a supported image type — labels must be PNG, JPEG, or WebP',
    };
  }
  return { ok: true, path };
}

/** True when `err` is the `TypeError` Node's fetch (undici) throws for `redirect:
 * 'error'` hitting a 3xx response — its `cause` is an `Error` whose message is exactly
 * "unexpected redirect" (verified directly against this Node/undici version; matched
 * loosely via a substring check rather than an exact-equality one so a future undici
 * wording tweak degrades to "generic 502" instead of silently stopping being detected).
 * Distinguishing this from every OTHER fetch failure is what lets the import route give
 * a specific, actionable message instead of the generic "could not download" one. */
function isRedirectRejection(err: unknown): boolean {
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
  return cause instanceof Error && /redirect/i.test(cause.message);
}

export interface LookupRoutesOptions {
  /** Overrides the brewery lookup's upstream fetch timeout (default 5s) — tests only. No
   * SSRF-guard options here: `GET /api/lookup/breweries` always targets a fixed,
   * settings-configured base URL, never a caller-supplied host, so `downloadAndStoreLabel`
   * (which DOES need the guard) is only ever invoked through `routes/kegtron.ts`'s Pro
   * import now — see that route's own options for where `resolveHost`/`allowInsecureHosts`
   * actually apply. */
  timeoutMs?: number;
}

export async function lookupRoutes(
  app: FastifyInstance,
  opts: LookupRoutesOptions = {},
) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const editor = { preHandler: requireRole('editor') };

  app.get('/api/lookup/breweries', editor, async (req, reply) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const query = (q ?? '').trim();
    if (!query) return [];

    const baseUrl = app.ctx.settings.get('openBreweryBaseUrl');
    const body = await fetchJsonOrFail(
      `${baseUrl}/v1/breweries/search?query=${encodeURIComponent(query)}`,
      timeoutMs,
    );
    if (body === FETCH_FAILED) {
      return reply.code(502).send({
        error: 'upstream_error',
        message: 'Could not reach the brewery lookup service — try again, or type the brewery in by hand',
      });
    }
    return mapBreweries(body);
  });
}
