import WebSocket, { type RawData } from 'ws';
import type { EventBus } from '../../core/events.js';
import type { SettingsStore } from '../../db/settings.js';
import type { Source } from '../source.js';
import { MdashClient } from './mdashClient.js';
import { parseDeviceShadow, diffToEvents, type ParsedDevice, type ShadowEmission } from './shadow.js';

// ---------------------------------------------------------------------------
// Kegtron Pro cloud source: discovers devices via mdash.net's /customer + device-shadow
// GET, then keeps them live via the per-device WebSocket notify channel documented in
// docs/kegtron/Notify.md (wss://{base}/api/v2/m/device/notify?access_token=<DEVICE_PUBLIC_KEY>),
// falling back to periodic polling while a socket is down. Never touches the DB — only
// emits bus events (Tasks 5/8's StateManager/monitors.ts consume them).
// ---------------------------------------------------------------------------

const DEFAULT_WS_BASE_URL = 'wss://mdash.net';
const NOTIFY_PATH = '/api/v2/m/device/notify';

// Reconnect backoff: 1s -> 60s cap (brief), equal-jitter (delay in [raw/2, raw]) to avoid
// a thundering herd of reconnects across many devices while still guaranteeing a sane
// floor at every attempt (never near-instant retries against a struggling server).
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_CAP_MS = 60_000;

// While a device's WS is down, re-resync its shadow at this cadence (brief: "every 5 min").
const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;

export interface KegtronCloudSourceOptions {
  bus: EventBus;
  settings: SettingsStore;
  /** mdash.net REST base URL override, forwarded to MdashClient. Test-only in practice. */
  baseUrl?: string;
  /** mdash.net WS base URL override (default 'wss://mdash.net'). Test-only in practice —
   * lets tests point at a local `ws` WebSocketServer instead of the real mdash.net. */
  wsBaseUrl?: string;
  /** Test-only overrides for reconnect backoff / poll cadence (see mdashClient.ts's
   * `timeoutMs` precedent, task-3-report.md "Deviations") — omitting these keeps the
   * brief's exact production defaults (1s->60s cap, 5 min poll). */
  reconnectBaseMs?: number;
  reconnectCapMs?: number;
  pollIntervalMs?: number;
}

interface DeviceState {
  readonly deviceKey: string;
  deviceId: string | null;
  rawShadow: unknown;
  parsed: ParsedDevice | null;
  /** Monotonic freshness counter for rawShadow/parsed — bumped on every applied state
   * change (shadow GET, WS 'updated' merge, poll apply) AND on WS open. Exists to kill
   * the stale-poll race: `pollShadowOnce` awaits its shadow GET, and if a WS `updated`
   * (or a reconnect's fresh GET) is processed DURING that await, the poll's response is
   * older than what's cached — applying it would rewind rawShadow/parsed, and the next
   * real update would then re-diff (and re-emit) a pour_completed that was already
   * reported. The poll captures this before its await and discards its result if the
   * counter moved. (Clearing the poll timer on WS open cancels future ticks only — it
   * can't cancel a GET already in flight.) */
  stateGeneration: number;
  ws: WebSocket | null;
  wsOpen: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  backfillDone: boolean;
  backfillInFlight: boolean;
  stopped: boolean;
}

/** '••••'+last4, matching SettingsStore.masked()'s convention — never log a key in full. */
function redactKey(key: string): string {
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursively applies `patch`'s keys onto `base` (plain objects only; arrays/scalars in
 * `patch` replace the corresponding `base` value wholesale). Used to fold a WS `updated`
 * notification's partial shadow (see docs/kegtron/Notify.md) into the cached full shadow
 * body before re-parsing — the notify payload only carries the keys that changed. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : patch;
  }
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    result[key] = deepMerge(base[key], patch[key]);
  }
  return result;
}

/** Formats `d` as an absolute "YYYY-MM-DD HH:MM:SS" UTC string — one of SQLite's
 * accepted time-string forms (docs/kegtron/kegtron-pro.v2.yaml ~lines 1795-1798:
 * "'datetime' can be any valid SQLite time string";
 * https://www.sqlite.org/lang_datefunc.html). Every caller in this file uses this same
 * shape for both the 7-day window boundary AND the persisted backfillCursors value
 * (see `runBackfill`), so the two are always directly, safely comparable with plain
 * lexicographic string comparison — no risk of the mixed-format local-time-parsing trap
 * that bit `Date.parse()` of a bare space-separated string elsewhere in this codebase
 * (see the final review's Minor 9 note on `pours.ts`). */
function toSqlUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** A bare relative modifier like "-7 days" is NOT itself a valid SQLite time-string,
 * only something applicable on top of one — so "7 days ago" is computed client-side. */
function sevenDaysAgo(now: Date): string {
  return toSqlUtc(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
}

export class KegtronCloudSource implements Source {
  readonly name = 'kegtron_cloud' as const;

  private readonly bus: EventBus;
  private readonly settings: SettingsStore;
  private readonly baseUrl: string | undefined;
  private readonly wsBaseUrl: string;
  private readonly reconnectBaseMs: number;
  private readonly reconnectCapMs: number;
  private readonly pollIntervalMs: number;

  private client: MdashClient | null = null;
  private readonly devices = new Map<string, DeviceState>();
  private stopped = true;
  private customerRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private customerAttempt = 0;

  constructor(opts: KegtronCloudSourceOptions) {
    this.bus = opts.bus;
    this.settings = opts.settings;
    this.baseUrl = opts.baseUrl;
    this.wsBaseUrl = opts.wsBaseUrl ?? DEFAULT_WS_BASE_URL;
    this.reconnectBaseMs = opts.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.reconnectCapMs = opts.reconnectCapMs ?? DEFAULT_RECONNECT_CAP_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const apiKey = this.settings.get('kegtronApiKey');
    if (!apiKey) {
      this.emitStatus(false, 'no API key configured', { unconfigured: true });
      return;
    }
    this.client = new MdashClient({ apiKey, baseUrl: this.baseUrl });
    await this.connectCustomer();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.customerRetryTimer) {
      clearTimeout(this.customerRetryTimer);
      this.customerRetryTimer = null;
    }
    for (const state of this.devices.values()) {
      state.stopped = true;
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
      if (state.ws) {
        const ws = state.ws;
        state.ws = null;
        ws.removeAllListeners();
        ws.terminate();
      }
    }
    this.devices.clear();
    this.client = null;
  }

  // -- customer / device discovery -----------------------------------------------------

  private async connectCustomer(): Promise<void> {
    if (!this.client) return;
    try {
      const { devicePubkeys } = await this.client.getCustomer();
      if (this.stopped) return;
      this.customerAttempt = 0;

      if (devicePubkeys.length === 0) {
        this.evaluateHealth();
        return;
      }
      for (const key of devicePubkeys) {
        if (!this.devices.has(key)) this.devices.set(key, this.createDeviceState(key));
      }
      await Promise.all([...this.devices.values()].map((s) => this.establishDevice(s)));
    } catch (err) {
      if (this.stopped) return;
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[kegtron_cloud] customer fetch failed', detail);
      this.emitStatus(false, `customer fetch failed: ${detail}`);
      this.customerRetryTimer = setTimeout(() => {
        this.customerRetryTimer = null;
        void this.connectCustomer();
      }, this.backoffDelay(this.customerAttempt++));
    }
  }

  private createDeviceState(deviceKey: string): DeviceState {
    return {
      deviceKey, deviceId: null, rawShadow: null, parsed: null, stateGeneration: 0,
      ws: null, wsOpen: false, reconnectAttempt: 0, reconnectTimer: null,
      pollTimer: null, backfillDone: false, backfillInFlight: false, stopped: false,
    };
  }

  // -- per-device shadow GET + diff + WS lifecycle -------------------------------------

  /** GET the device shadow, diff against the cached parse (null on first sight ->
   * discovery events), then open (or re-open) the notify WebSocket. Never throws/rejects
   * — a failure here is isolated to this device and drives a backoff retry, per the
   * source-isolation requirement (one bad device must not affect others or the source's
   * overall start()). */
  private async establishDevice(state: DeviceState): Promise<void> {
    if (state.stopped || !this.client) return;
    try {
      const raw = await this.client.getDeviceShadow(state.deviceKey);
      if (state.stopped) return;
      const next = parseDeviceShadow(raw);
      if (!next) throw new Error('unrecognized device shadow shape');

      const diffEvents = diffToEvents(next.deviceId, state.parsed, next);
      this.emitShadowEvents(diffEvents, state.deviceKey);
      state.rawShadow = raw;
      state.parsed = next;
      state.stateGeneration++; // invalidates any poll GET still in flight (see DeviceState)
      state.deviceId = next.deviceId;
      // Deliberately NOT resetting reconnectAttempt here: each reconnect cycle runs
      // shadow GET -> openWs, so a reset on GET success meant "REST up, WS persistently
      // failing" (the real-world persistent-403 mode documented at openWs) collapsed the
      // 1s->60s exponential backoff into a ~1 Hz GET+handshake storm per device, forever.
      // The reset on actual WS 'open' (below) is the one that counts.
      this.evaluateHealth();

      await this.openWs(state);
    } catch (err) {
      if (state.stopped) return;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[kegtron_cloud] shadow fetch failed for device ${redactKey(state.deviceKey)}`, detail);
      this.evaluateHealth();
      this.scheduleReconnect(state);
    }
  }

  /** Opens the notify WebSocket for `state`. Resolves once the connection either opens or
   * fails to (close/error before open) — it never rejects and never hangs, so callers
   * (start()'s initial Promise.all, and scheduleReconnect's retries) stay bounded even
   * against an unreachable server; the retry loop lives entirely in the 'close' handler. */
  private openWs(state: DeviceState): Promise<void> {
    return new Promise((resolve) => {
      const url = `${this.wsBaseUrl}${NOTIFY_PATH}?access_token=${encodeURIComponent(state.deviceKey)}`;
      // mdash.net 403s the notify WS handshake outright when no `Origin` header is
      // present (live-diagnosed against the real server; a bare `new WebSocket(url)`
      // sends none). Kegtron's own Node.js example works around this by passing `{
      // origin: url }` — the whole notify URL itself, not just a scheme+host — to the
      // `ws` client (docs/kegtron/Notify.md's Examples section); matching that exactly
      // here is what makes every device connection actually succeed instead of 403ing
      // and permanently degrading this source to 5-min polling. See
      // tests/ingest/cloudSource.test.ts's dedicated regression test.
      const ws = new WebSocket(url, { origin: url });
      state.ws = ws;
      let settled = false;
      const settleOnce = () => {
        if (!settled) { settled = true; resolve(); }
      };

      ws.on('open', () => {
        state.wsOpen = true;
        state.reconnectAttempt = 0;
        // The WS is now the freshness authority — bump so a poll GET still awaiting its
        // response can't apply an answer from the polling era over WS-delivered state
        // (clearPollTimer below only cancels FUTURE ticks, not an in-flight await).
        state.stateGeneration++;
        this.clearPollTimer(state);
        this.evaluateHealth();
        // Guarded by backfillInFlight (not just backfillDone) so a fast reconnect can't
        // start a second overlapping backfill while the first is still in flight;
        // backfillDone is only set true once runBackfill() actually succeeds (see
        // runBackfill's doc comment) so a transient failure retries on the next open.
        if (!state.backfillDone && !state.backfillInFlight) {
          state.backfillInFlight = true;
          void this.runBackfill(state);
        }
        settleOnce();
      });

      ws.on('message', (data) => this.handleMessage(state, data));

      ws.on('close', () => {
        state.wsOpen = false;
        if (state.ws === ws) state.ws = null;
        this.evaluateHealth();
        if (!state.stopped) {
          this.startPollTimer(state);
          this.scheduleReconnect(state);
        }
        settleOnce();
      });

      // 'close' always follows 'error' for the ws client — this handler exists solely to
      // prevent an unhandled 'error' event from crashing the process (EventEmitter default).
      ws.on('error', () => {});
    });
  }

  private scheduleReconnect(state: DeviceState): void {
    if (state.stopped || state.reconnectTimer) return;
    const delay = this.backoffDelay(state.reconnectAttempt++);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      void this.establishDevice(state);
    }, delay);
  }

  private startPollTimer(state: DeviceState): void {
    if (state.stopped || state.pollTimer) return;
    state.pollTimer = setInterval(() => { void this.pollShadowOnce(state); }, this.pollIntervalMs);
  }

  private clearPollTimer(state: DeviceState): void {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  /** Best-effort resync while the WS is down; independent of the reconnect backoff loop
   * (which keeps trying the socket itself). Swallows errors — it'll simply try again on
   * the next tick or once the socket reconnects. */
  private async pollShadowOnce(state: DeviceState): Promise<void> {
    if (state.stopped || !this.client) return;
    try {
      const generationAtRequest = state.stateGeneration;
      const raw = await this.client.getDeviceShadow(state.deviceKey);
      if (state.stopped) return;
      // Stale-write guard (see DeviceState.stateGeneration): if the WS opened or applied
      // newer state while this GET was in flight, our response predates the cache —
      // applying it would rewind rawShadow/parsed, and the next real WS `updated` would
      // re-diff (and re-emit) an already-reported pour_completed. Discard it instead;
      // the WS path (or the next poll, if the socket dropped again) already carries
      // everything this poll was for.
      if (state.stateGeneration !== generationAtRequest) return;
      const next = parseDeviceShadow(raw);
      if (!next) return;
      const diffEvents = diffToEvents(next.deviceId, state.parsed, next);
      this.emitShadowEvents(diffEvents, state.deviceKey);
      state.rawShadow = raw;
      state.parsed = next;
      state.stateGeneration++;
      this.evaluateHealth();
    } catch {
      // swallowed — see doc comment above
    }
  }

  /** Servings backfill (brief: on first successful connect per device only). Historical
   * pours are emitted with their original `ts`; Task 5's PourDeduper is what prevents
   * doubles against anything already reported live via the WS 'updated' path WITHIN a
   * single process's lifetime.
   *
   * Final review C1 fix: that in-process protection is not enough — `state.backfillDone`
   * is itself per-process/in-memory, so every restart (or source-relevant settings
   * PATCH, which tears down and rebuilds every source, see bootstrap.ts) used to re-run
   * `getServings(-7 days, 'now')` from scratch and re-emit (and, since the in-memory
   * PourDeduper is reset too) re-RECORD up to 7 days of already-imported pours every
   * time. `settings.backfillCursors[deviceId]` is a persisted high-water mark — the
   * "end" boundary this call itself represents — so a later run (this process or a
   * fresh one) only ever asks mdash for servings from wherever the LAST successful
   * backfill left off, never re-requesting an already-imported range. It's the max of
   * that cursor and the 7-day window (so a device that hasn't backfilled in >7 days
   * still gets the full 7-day catch-up, and a fresh cursor with no prior run falls back
   * to exactly the old 7-day-window behavior).
   *
   * `state.backfillDone` is only set `true` once the `getServings` call actually
   * succeeds (Fix round 1: previously it was latched `true` by the caller *before*
   * this ran, so a transient failure on first connect permanently skipped backfill for
   * that device's whole process lifetime). On failure it's left `false` (and the cursor
   * is NOT advanced), so the next WS `open` (i.e. the next reconnect) naturally retries
   * it — from the same unadvanced start boundary, so a failed attempt never loses
   * coverage. `state.backfillInFlight` (cleared in `finally`, covering every return
   * path including the early guards) is what actually prevents a fast reconnect from
   * starting a second overlapping call while one is still pending — see the `open`
   * handler in `openWs()`. */
  private async runBackfill(state: DeviceState): Promise<void> {
    const deviceId = state.deviceId;
    try {
      // deviceId is always set by the time a WS 'open' (this method's only caller)
      // fires — establishDevice() sets it right after a successful shadow parse, before
      // ever calling openWs() — so this guard is defensive, not expected to trigger; it
      // also keeps backfillCursors keyed exclusively by the mdash device id, never by
      // the raw device key (see Minor 2's credential-shaped-identifier note elsewhere
      // in this file for why that distinction matters).
      if (state.stopped || !this.client || !deviceId) return;
      const now = new Date();
      const windowStart = sevenDaysAgo(now);
      const cursor = this.settings.get('backfillCursors')[deviceId];
      const start = cursor && cursor > windowStart ? cursor : windowStart;
      const nowStr = toSqlUtc(now);

      const rows = await this.client.getServings(state.deviceKey, start, 'now');
      if (state.stopped) return;
      for (const row of rows) {
        this.bus.emit('pour_completed', {
          monitor: { type: 'kegtron_pro', identifier: deviceId, portIndex: row.portIndex },
          volumeMl: row.volumeMl,
          durationMs: row.durationMs,
          source: 'cloud',
          ts: row.ts,
        });
      }
      // Persist the advanced cursor only on success — see doc comment above for why a
      // failed attempt must leave it untouched. Re-reads the current value instead of
      // reusing the `cursor` captured above (rather than assuming nothing else could
      // have written backfillCursors meanwhile) — cheap, and avoids ever clobbering a
      // concurrent device's own entry with a stale in-memory copy.
      const cursors = this.settings.get('backfillCursors');
      this.settings.set('backfillCursors', { ...cursors, [deviceId]: nowStr });
      state.backfillDone = true;
      this.evaluateHealth();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[kegtron_cloud] servings backfill failed for device ${redactKey(state.deviceKey)}`, detail);
    } finally {
      state.backfillInFlight = false;
    }
  }

  // -- WS message handling ---------------------------------------------------------------

  private handleMessage(state: DeviceState, raw: RawData): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!isPlainObject(msg)) return;
    const name = msg.name;

    if (name === 'updated') {
      const merged = deepMerge(state.rawShadow, msg.data ?? {});
      const next = parseDeviceShadow(merged);
      if (!next) return;
      const diffEvents = diffToEvents(next.deviceId, state.parsed, next);
      this.emitShadowEvents(diffEvents, state.deviceKey);
      state.rawShadow = merged;
      state.parsed = next;
      state.stateGeneration++; // invalidates any poll GET still in flight (see DeviceState)
      this.evaluateHealth();
    } else if (name === 'online') {
      this.emitPortStatus(state, 'device_online');
    } else if (name === 'offline') {
      this.emitPortStatus(state, 'device_offline');
    }
    // rpc.in.<method> / rpc.out.<method>: out of scope for this source (see Task 9).
  }

  private emitPortStatus(state: DeviceState, event: 'device_online' | 'device_offline'): void {
    const ts = new Date().toISOString();
    const identifier = state.deviceId ?? state.deviceKey;
    const portCount = state.parsed?.portCount ?? 0;
    for (let i = 0; i < portCount; i++) {
      this.bus.emit(event, { monitor: { type: 'kegtron_pro', identifier, portIndex: i }, ts });
    }
  }

  /** Emits diffToEvents()'s output on the bus, injecting the device's mdash
   * DEVICE_PUBLIC_KEY into `device_discovered.meta.deviceKey` (binding cross-task
   * requirement: Task 9's RPC endpoints resolve the key back out of monitor meta). */
  private emitShadowEvents(diffEvents: ShadowEmission[], deviceKey: string): void {
    for (const ev of diffEvents) {
      switch (ev.event) {
        case 'device_discovered':
          this.bus.emit('device_discovered', {
            ...ev.payload,
            meta: { ...(ev.payload.meta ?? {}), deviceKey },
          });
          break;
        case 'volume_update':
          this.bus.emit('volume_update', ev.payload);
          break;
        case 'pour_completed':
          this.bus.emit('pour_completed', ev.payload);
          break;
        case 'telemetry':
          this.bus.emit('telemetry', ev.payload);
          break;
        default:
          break; // diffToEvents() never produces other event kinds today
      }
    }
  }

  // -- health / backoff -------------------------------------------------------------------

  /** healthy:true once every known device's socket is open (or there are none to open —
   * an empty account isn't a failure); healthy:false only once ALL device sockets are
   * down ("total failure"); otherwise (partial connectivity) still healthy:true with a
   * detail noting the degraded count. Called after every emitted batch (discovery,
   * WS 'updated' diffs, backfill, poll) so `source_status.ts` — and therefore
   * SourceManager's `lastEventAt` — stays fresh, not just on health transitions. */
  private evaluateHealth(): void {
    const total = this.devices.size;
    if (total === 0) {
      this.emitStatus(true, 'no devices registered for this account');
      return;
    }
    const open = [...this.devices.values()].filter((d) => d.wsOpen).length;
    if (open === total) this.emitStatus(true, `${open}/${total} device connections open`);
    else if (open === 0) this.emitStatus(false, `all ${total} device connections down`);
    else this.emitStatus(true, `${open}/${total} device connections open (degraded)`);
  }

  private emitStatus(healthy: boolean, detail: string, extra: { unconfigured?: boolean } = {}): void {
    this.bus.emit('source_status', {
      source: 'kegtron_cloud', healthy, detail, ts: new Date().toISOString(), ...extra,
    });
  }

  private backoffDelay(attempt: number): number {
    const raw = Math.min(this.reconnectCapMs, this.reconnectBaseMs * 2 ** attempt);
    // Equal jitter: uniformly in [raw/2, raw] — a sane floor at every attempt while still
    // spreading reconnects out to avoid a thundering herd against a recovering server.
    return Math.round(raw / 2 + Math.random() * (raw / 2));
  }
}
