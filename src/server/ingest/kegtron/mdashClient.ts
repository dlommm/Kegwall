// ---------------------------------------------------------------------------
// mdash.net REST client for Kegtron Pro devices.
//
// Auth model (docs/kegtron/kegtron-pro.v2.yaml): every endpoint authenticates via an
// `access_token` QUERY PARAM — never a header, never in the request body.
//   - GET /customer                          -> access_token = CUSTOMER_KEY (this.apiKey)
//   - everything under /api/v2/m/device/...  -> access_token = a DEVICE_PUBLIC_KEY
//     (passed per-call as `deviceKey`, NOT this.apiKey — see getDeviceShadow/getServings/
//     callRpc below; the customer key and device keys are different credentials in the
//     mdash.net model, see the "Customer" tag's GET /customer description ~line 1366).
//
// Servings row -> ServingRow.portIndex mapping (VERIFIED, not ambiguous):
//   kegtron-pro.v2.yaml documents column [4] of every "Data" tag row (servings-device,
//   servings-port, servings-site, alerts-port, alerts-device) with the EXACT wording
//   "port_number (integer) - Port number (0-indexed)" (see e.g. ~line 2064, the
//   servings-device response schema). So port_number is already a 0-based logical port
//   index — the same 0-based indexing parseDeviceShadow()/ParsedPort.portIndex use
//   (shadow.ts, port0..port3). portIndex = port_number directly; NO "-1" offset is
//   applied. (The task brief's fallback instruction — "if ambiguous, treat as 1-based" —
//   does not apply here: the spec is explicit and unambiguous on this point.)
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://mdash.net';
const DEFAULT_TIMEOUT_MS = 10_000;

/** Thrown for any failed mdash.net call. `status` is the HTTP status for non-2xx
 * responses, or 0 for network-level failures (timeout, DNS, connection refused, etc.)
 * where no HTTP response was ever received. The message NEVER includes the API key or
 * a device key — only the request method/path (which never carries a token; tokens are
 * always in the query string and are deliberately left out of every error message). */
export class MdashError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MdashError';
    this.status = status;
  }
}

export interface ServingRow {
  ts: string;
  portIndex: number;
  volumeMl: number;
  durationMs: number | null;
}

export interface MdashClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Test-only override of the per-request abort timeout (ms). Not part of the task
   * brief's literal `{apiKey, baseUrl}` constructor shape — added so tests can exercise
   * the timeout/abort path in milliseconds instead of the real 10s production default.
   * Optional and additive: omitting it preserves the brief's exact default behavior.
   * See task-3-report.md "Deviations". */
  timeoutMs?: number;
}

function toNumber(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

function toNullableNumber(v: unknown): number | null {
  return v === null || v === undefined ? null : toNumber(v);
}

export class MdashClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: MdashClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** GET /customer — devicePubkeys is the list of keys of the response's `pubkeys` map
   * (each key is itself the DEVICE_PUBLIC_KEY to use as access_token for that device's
   * /api/v2/m/device/... calls; the map's values may be empty objects and are ignored). */
  async getCustomer(): Promise<{ devicePubkeys: string[] }> {
    const body = await this.request('GET', '/customer', this.apiKey);
    const pubkeys = (body as { pubkeys?: Record<string, unknown> } | null)?.pubkeys;
    return { devicePubkeys: pubkeys ? Object.keys(pubkeys) : [] };
  }

  /** GET /api/v2/m/device — returns the raw device-shadow body (id + shadow.state.reported...);
   * parsing is parseDeviceShadow()'s job (src/server/ingest/kegtron/shadow.ts), not this client's. */
  async getDeviceShadow(deviceKey: string): Promise<unknown> {
    return this.request('GET', '/api/v2/m/device', deviceKey);
  }

  /** POST /api/v2/m/device/data/servings-device with body {"params": [start, end]} (the
   * "Data" tag's two-key form — start/end are any valid SQLite time string per the spec,
   * e.g. "2020-05-01" or "now"). Maps each positional row to a ServingRow. */
  async getServings(deviceKey: string, start: string, end: string): Promise<ServingRow[]> {
    const body = await this.request(
      'POST',
      '/api/v2/m/device/data/servings-device',
      deviceKey,
      { params: [start, end] },
    );
    const rows = (body as { rows?: unknown[][] } | null)?.rows ?? [];
    return rows.map((row): ServingRow => ({
      ts: String(row[0]),
      // row[4] = port_number, documented 0-indexed — see block comment above.
      portIndex: toNumber(row[4]),
      volumeMl: toNumber(row[5]),
      durationMs: toNullableNumber(row[9]),
    }));
  }

  /** POST /api/v2/m/device/rpc/{method}. Per the RPC-tagged endpoints in the spec (e.g.
   * Kegtron.CleanMode, Kegtron.ResetVolume), the request body IS the params object
   * itself — unlike the "Data" tag endpoints, RPC params are NOT wrapped in a {"params":
   * [...]} envelope. No body is sent when `params` is omitted (matches RPCs that take no
   * arguments, e.g. Kegtron.GetVoltage/GetWiFiRssi/GetTempHumidity). */
  async callRpc(deviceKey: string, method: string, params?: unknown): Promise<unknown> {
    return this.request('POST', `/api/v2/m/device/rpc/${method}`, deviceKey, params);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    token: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}?access_token=${encodeURIComponent(token)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        // kegtron-pro.v2.yaml declares a required content-type header on every endpoint,
        // but several RPCs (e.g. Kegtron.GetVoltage) declare no requestBody at all — the
        // header is only meaningful when a body is actually sent, so it's set exactly
        // when `body` is present (sending it on a genuinely bodyless request is both
        // semantically empty and trips some JSON-body-parser implementations' "empty
        // body with content-type: application/json" validation).
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Network-level failure (timeout/abort, DNS, connection refused, ...) — never
      // received an HTTP response, so there's no status. Deliberately do NOT surface
      // `err.message`/`err.cause` here: some underlying fetch errors (e.g. URL-parse
      // failures) can embed the full request URL — which carries `token` in its query
      // string — so the message is built only from a fixed classification plus
      // `method`/`path` (path never carries the token; it's always in the query string).
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'network error';
      throw new MdashError(`mdash ${method} ${path} failed: ${reason}`, 0);
    }
    if (!res.ok) {
      throw new MdashError(`mdash ${method} ${path} returned status ${res.status}`, res.status);
    }
    return res.json();
  }
}
