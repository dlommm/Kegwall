import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireRole } from './auth.js';
import { MAX_BYTES, writeLabelFile } from './uploads.js';
import type { BreweryLookupResult, UntappdLookupResult } from '../core/lookupTypes.js';

// Re-exported so anything importing FROM this route module (rather than the shared
// core/lookupTypes.ts directly) keeps working — but see that file's doc comment for why
// the web client specifically must import from core/lookupTypes.ts, not from here.
export type { BreweryLookupResult, UntappdLookupResult };

// ---------------------------------------------------------------------------
// Task 4: two read-only lookup proxies (Open Brewery DB, Untappd) that let the beers
// form autocomplete a brewery name and pull in beer metadata + label art, plus one
// write endpoint that downloads a chosen Untappd label server-side so the client never
// hotlinks Untappd's CDN from the admin UI.
//
// Every upstream call gets a short (default 5s, injectable — see `lookupRoutes`'
// `opts.timeoutMs`, same pattern as MdashClient's `timeoutMs` / app.ts's
// `wsPingIntervalMs`) timeout and degrades to a clean 502 on any failure — a flaky
// third-party API should never surface as a raw 500 or hang the beers form. Untappd's
// client_id/client_secret are sent the way its v4 API requires them: query params on the
// upstream request only. They are NEVER included in a response body or an error message
// (see `fetchOrNull` below, whose fixed error messages never echo the request URL or any
// underlying fetch error text) — the same discipline MdashClient uses for mdash.net
// device keys (see ingest/kegtron/mdashClient.ts).
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

/** Untappd v4's `/search/beer` response nests results at `response.beers.items[]`, each
 * with a `beer` object and a `brewery` object. Items with no beer name are dropped. */
function mapUntappd(body: unknown): UntappdLookupResult[] {
  const items = isRecord(body) && isRecord(body.response) && isRecord(body.response.beers)
    ? body.response.beers.items
    : undefined;
  if (!Array.isArray(items)) return [];
  const out: UntappdLookupResult[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const beer = isRecord(item.beer) ? item.beer : {};
    const brewery = isRecord(item.brewery) ? item.brewery : {};
    const name = typeof beer.beer_name === 'string' ? beer.beer_name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      brewery: typeof brewery.brewery_name === 'string' ? brewery.brewery_name : null,
      style: typeof beer.beer_style === 'string' ? beer.beer_style : null,
      abv: typeof beer.beer_abv === 'number' ? beer.beer_abv : null,
      ibu: typeof beer.beer_ibu === 'number' ? beer.beer_ibu : null,
      labelUrl: typeof beer.beer_label === 'string' && beer.beer_label ? beer.beer_label : null,
    });
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
 * `FETCH_FAILED` — the two GET lookup handlers below treat that as "degrade gracefully
 * to a 502", never surfacing `err.message` (some fetch failures embed the full request
 * URL, which for the Untappd call carries client_id/client_secret in its query string)
 * or a raw upstream response body. */
async function fetchJsonOrFail(url: string, timeoutMs: number): Promise<unknown | typeof FETCH_FAILED> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return FETCH_FAILED;
    return await res.json();
  } catch {
    return FETCH_FAILED;
  }
}

const importSchema = z.object({ labelUrl: z.string() });

export async function lookupRoutes(
  app: FastifyInstance,
  dataDir: string,
  opts: { timeoutMs?: number } = {},
) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const editor = { preHandler: requireRole('editor') };
  const labelsDir = join(dataDir, 'labels');
  // Belt-and-suspenders, same rationale as uploads.ts: app.ts always registers
  // labelsStaticRoutes (which also mkdir's this) first, but a caller wiring
  // lookupRoutes independently shouldn't 500 on a missing directory.
  mkdirSync(labelsDir, { recursive: true });

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

  app.get('/api/lookup/untappd', editor, async (req, reply) => {
    const untappd = app.ctx.settings.get('untappd');
    if (!untappd) {
      return reply.code(501).send({ error: 'not_configured', message: 'Untappd is not configured' });
    }

    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const query = (q ?? '').trim();
    if (!query) return [];

    const baseUrl = app.ctx.settings.get('untappdBaseUrl');
    const url = `${baseUrl}/v4/search/beer`
      + `?q=${encodeURIComponent(query)}`
      + `&client_id=${encodeURIComponent(untappd.clientId)}`
      + `&client_secret=${encodeURIComponent(untappd.clientSecret)}`;
    const body = await fetchJsonOrFail(url, timeoutMs);
    if (body === FETCH_FAILED) {
      return reply.code(502).send({
        error: 'upstream_error',
        message: 'Could not reach Untappd — try again, or fill in the beer by hand',
      });
    }
    return mapUntappd(body);
  });

  app.post('/api/lookup/untappd/import', editor, async (req, reply) => {
    // Gated on Untappd being configured even though this handler never itself calls the
    // Untappd API (it just downloads a caller-supplied URL) — the beers form only ever
    // reaches this endpoint from the Untappd search sheet, which is hidden entirely when
    // Untappd isn't configured (see BeersPage/UntappdSearchSheet). Keeping the same gate
    // server-side stops this from doubling as a generic "fetch any URL for me"
    // authenticated proxy once Untappd is turned off.
    const untappd = app.ctx.settings.get('untappd');
    if (!untappd) {
      return reply.code(501).send({ error: 'not_configured', message: 'Untappd is not configured' });
    }

    const body = importSchema.parse(req.body ?? {});
    let target: URL;
    try {
      target = new URL(body.labelUrl);
    } catch {
      return reply.code(400).send({ error: 'validation', message: 'labelUrl must be a valid URL' });
    }
    // http(s) only — blocks file://, data:, and other schemes a raw fetch() would
    // otherwise happily follow. Editor role already carries significant trust in this
    // app (e.g. the Kegtron import route lets it pull arbitrary mdash device data), so
    // this is a minimum scheme guard rather than a full SSRF-hardened fetch.
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return reply.code(400).send({ error: 'validation', message: 'labelUrl must be an http(s) URL' });
    }

    let res: Response;
    try {
      res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return reply.code(502).send({ error: 'upstream_error', message: 'Could not download the label image' });
    }
    if (!res.ok) {
      return reply.code(502).send({ error: 'upstream_error', message: 'Could not download the label image' });
    }

    let buf: Buffer;
    try {
      buf = await readCapped(res, MAX_BYTES);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        return reply.code(413).send({ error: 'payload_too_large', message: 'Label image exceeds the 5MB limit' });
      }
      throw err;
    }

    const path = writeLabelFile(labelsDir, buf);
    if (!path) {
      return reply.code(400).send({
        error: 'validation',
        message: 'Downloaded file is not a supported image type — labels must be PNG, JPEG, or WebP',
      });
    }
    return reply.code(201).send({ path });
  });
}
