import dgram from 'node:dgram';
import { z } from 'zod';
import type { EventBus, MonitorRef } from '../../core/events.js';
import type { SettingsStore } from '../../db/settings.js';
import type { Source } from '../source.js';
import { SourceStatusThrottle, DEFAULT_STATUS_INTERVAL_MS } from '../statusThrottle.js';

// ---------------------------------------------------------------------------
// Kegtron Pro UDP Streaming source (Kegtron's "UDP Streaming" PDF, "UDP Streaming",
// April 2026). Listens for the raw UDP multicast payloads Kegtron Pro devices push
// directly on the LAN, bypassing the 5-30s cloud-reporting latency (page 2). Never
// touches the DB — only emits bus events (StateManager/monitors.ts consume them).
//
// Packet shape (page 3, "Data Definitions"):
//   { num, fwRev, portCount, serialNum, temp, "port<i>": { abv, cleanActive, curServ,
//     drinkSize, ibu, maker, lastServing, state, style, tapLabel, userDesc, userName,
//     volDisp, volSize, volStart } }
// Exactly one port<i> key is present per packet ("one packet is sent per keg monitor
// port", page 4) — but this parser tolerates more than one for robustness.
//
// curServ (page 4, "Notes") is UDP-only — not visible via the REST API/cloud shadow.
// It is the accumulated mL of the CURRENT serving; it clears to 0 the instant a
// serving ends and stays 0 until the next one starts. That is the primary pour-
// start/progress/end signal used below.
//
// Cadence (page 4, "Behavior"): 1 packet/sec round-robin per port while idle; 200ms
// per active-pour port; packets continue at 200ms for ~2s after flow stops (by which
// point curServ has already cleared to 0, so those trailing packets are idempotent
// no-ops against an already-ended pour). The 2s figure is also used here as a
// packet-loss safety net: if a pouring port goes quiet for that long (UDP is "best
// effort" — page 3, "Limitations" — packets can simply be lost), the pour is treated
// as ended using the last known curServ as its final volume.
// ---------------------------------------------------------------------------

const DEFAULT_GROUP = '239.50.50.50';
const DEFAULT_PORT = 50505;
const DEFAULT_BIND_ADDRESS = '0.0.0.0';
// PDF page 4: "UDP packets will continue to be sent every 200ms for an additional 2
// seconds after liquid flow has stopped." Reused here as the no-packet pour-end
// fallback window (see file header comment).
const DEFAULT_POUR_TIMEOUT_MS = 2_000;

/** Multicast membership refresh cadence — well under the ~260s IGMP snooping
 * membership timeout that killed the stream on real hardware (see start()). */
const REJOIN_INTERVAL_MS = 60_000;

/**
 * How long a bound socket may hear NOTHING before the source reports itself unhealthy.
 * A powered Kegtron Pro broadcasts once per second per port even while idle (PDF page 4,
 * "Behavior"), so three minutes of total silence means the packets are not reaching this
 * process — a dropped multicast membership, a container moved off host networking, the
 * device's own UDP streaming turned off. Reporting "listening" forever in that state is
 * what made this failure invisible: the admin UI showed a healthy source and an empty
 * packet timeline, which reads as "nothing wrong here" instead of "the stream is dead".
 */
const STALE_AFTER_MS = 180_000;

export interface KegtronUdpSourceOptions {
  bus: EventBus;
  settings: SettingsStore;
  /** Monitor identity reconciliation (Task 8, HARD REQUIREMENT from the Task 6 review):
   * UDP packets only ever carry the device's `serialNum`, while cloud discovery keys
   * monitors by the mdash device id (see `monitors.ts`'s `reconcileProMonitor` doc
   * comment for the full rationale). When provided, this is called for every packet's
   * `(serialNum, portIndex)` and, if it resolves, its result is used as the emitted
   * MonitorRef — landing UDP events on the SAME monitor row cloud discovery already
   * created, which is what lets `PourDeduper` (Task 5) actually collapse a duplicate
   * cloud/UDP report of the same physical pour. When it returns `null` (no cloud row for
   * that serial+port yet) OR when this option is omitted entirely, falls back to a
   * synthetic `udp:{serialNum}` identifier — see `monitorRef()` below. Left `undefined`
   * (not defaulted to a no-op `() => null`) so omitting it entirely preserves this
   * source's pre-Task-8 behavior of using the bare `serialNum` as the identifier
   * (no `udp:` prefix) — required for backward compatibility with this file's own
   * existing unit tests, which construct the source without a `reconcile` option and
   * assert on the bare-serialNum identifier. Task 8's `bootstrap.ts` always supplies
   * this in the real running app (wired to `reconcileProMonitor(ctx.db, ...)`), so the
   * prefixed fallback is what production actually uses once a `reconcile` function is
   * wired up — see task-8-report.md "Deviations" for the full reasoning. */
  reconcile?: (serialNum: string, portIndex: number) => MonitorRef | null;
  /** Multicast group to join (production default 239.50.50.50 per the PDF). Pass a
   * value the current interface can't actually join (e.g. when bindAddress is a
   * unicast test address) and the join is simply skipped/logged, not fatal — see
   * bindSocket(). */
  group?: string;
  /** UDP port (production default 50505 per the PDF). Tests pass 0 for an
   * OS-assigned ephemeral port and read it back via address() after start(). */
  port?: number;
  /** Local bind address (production default '0.0.0.0', i.e. all interfaces — required
   * for multicast reception). Tests pass '127.0.0.1' and send fixture packets via a
   * plain unicast dgram socket — no real multicast join is required or attempted to
   * matter for delivery in that case (see bindSocket()'s try/catch). */
  bindAddress?: string;
  /** Test-only override of the pour-end-via-no-packet fallback window (production
   * default 2000ms per the PDF, see DEFAULT_POUR_TIMEOUT_MS above). Not part of the
   * brief's literal constructor shape ({bus,settings,group,port,bindAddress}, plus an
   * `isCloudHealthy` hook that was threaded but never read — "reserved for future
   * cross-source health coordination" — and has since been removed as dead wiring;
   * see finishPour()'s comment for the design decision that made it unnecessary)
   * — added so tests can exercise the timeout path in milliseconds rather than
   * waiting out a real 2s window. Optional and additive, same precedent as
   * mdashClient's timeoutMs / cloudSource's reconnectBaseMs (see their doc comments). */
  pourTimeoutMs?: number;
  /** Test-only overrides of the multicast re-join cadence and the silence window after
   *  which the source reports itself unhealthy (production defaults 60s / 3min above) —
   *  same precedent as pourTimeoutMs, so the staleness path is testable in milliseconds. */
  rejoinIntervalMs?: number;
  staleAfterMs?: number;
  /** Test-only override of the routine "last packet from ..." status-repeat cadence
   * (production default 30s — see ../statusThrottle.ts; per-datagram emission spammed
   * every listener/the log/the sources UI at 5 packets/sec during pours). Same additive
   * precedent as pourTimeoutMs. */
  statusIntervalMs?: number;
}

interface PortState {
  pouring: boolean;
  lastCurServMl: number;
  pourStartedAtMs: number | null;
  lastVolStartMl: number | null;
  lastVolDispMl: number | null;
  lastVolSizeMl: number | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

interface ParsedPortPacket {
  portIndex: number;
  curServMl: number;
  volStartMl: number;
  volDispensedMl: number;
  volSizeMl: number | null;
}

interface ParsedPacket {
  serialNum: string;
  temp: number | null;
  ports: ParsedPortPacket[];
}

// Every field below degrades to a safe fallback (.catch()) rather than failing the
// whole packet — mirrors shadow.ts's tolerant-parsing convention. Only a genuinely
// unrecognizable packet (not an object, or missing serialNum) is rejected outright.
const numOrZero = z.number().catch(0);
const numOrNull = z.number().nullable().catch(null);

const portDataSchema = z.object({
  curServ: numOrZero.optional(),
  volStart: numOrZero.optional(),
  volDisp: numOrZero.optional(),
  volSize: numOrNull.optional(),
}).passthrough();

const packetSchema = z.object({
  serialNum: z.string().min(1),
  temp: numOrNull.optional(),
}).passthrough();

const PORT_KEY_RE = /^port(\d+)$/;

/** Kegtron Pro tops out at 4 ports (`port0`..`port3` — the same range shadow.ts's cloud
 * parser enumerates, and what "a 4-port Kegtron is one device" throughout this repo
 * means). A hostile/corrupt LAN datagram with a `port999999` key must not mint a
 * phantom monitor row via `device_discovered`, so out-of-range indexes are dropped
 * (individually, keeping the tolerant-parsing convention) with a warn. */
const MAX_PRO_PORT_INDEX = 3;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Never throws. Returns null for anything that isn't shaped like a Kegtron UDP
 * streaming packet at all (not an object, or no valid serialNum) — the caller logs
 * and drops the packet, staying healthy (UDP is "best effort"; malformed/lost packets
 * are expected, not exceptional). A port<i> key whose value isn't itself a
 * recognizable object is individually skipped rather than failing the whole packet, as
 * is a port<i> key beyond the hardware's real 0..3 range (see MAX_PRO_PORT_INDEX). */
export function parsePacket(raw: unknown): ParsedPacket | null {
  if (!isPlainObject(raw)) return null;
  const top = packetSchema.safeParse(raw);
  if (!top.success) return null;

  const ports: ParsedPortPacket[] = [];
  for (const key of Object.keys(raw)) {
    const m = PORT_KEY_RE.exec(key);
    if (!m) continue;
    const portResult = portDataSchema.safeParse(raw[key]);
    if (!portResult.success) continue;
    const portIndex = Number(m[1]);
    if (!Number.isInteger(portIndex) || portIndex < 0) continue;
    if (portIndex > MAX_PRO_PORT_INDEX) {
      console.warn(
        `[kegtron_udp] ignoring out-of-range port index ${portIndex} `
        + `(hardware maxes out at port${MAX_PRO_PORT_INDEX})`,
      );
      continue;
    }
    ports.push({
      portIndex,
      curServMl: portResult.data.curServ ?? 0,
      volStartMl: portResult.data.volStart ?? 0,
      volDispensedMl: portResult.data.volDisp ?? 0,
      volSizeMl: portResult.data.volSize ?? null,
    });
  }

  return { serialNum: top.data.serialNum, temp: top.data.temp ?? null, ports };
}

export class KegtronUdpSource implements Source {
  readonly name = 'kegtron_udp' as const;

  private readonly bus: EventBus;
  private readonly settings: SettingsStore;
  private readonly reconcile: ((serialNum: string, portIndex: number) => MonitorRef | null) | undefined;
  private readonly group: string;
  private readonly configuredPort: number;
  private readonly bindAddress: string;
  private readonly pourTimeoutMs: number;
  private readonly rejoinIntervalMs: number;
  private readonly staleAfterMs: number;

  private socket: dgram.Socket | null = null;

  /** IGMP-refresh timer — see the re-join comment in start(). */
  private rejoinTimer: ReturnType<typeof setInterval> | null = null;
  private boundAddress: { address: string; port: number } | null = null;
  /** True once the initial `addMembership` succeeded — i.e. this is a real multicast
   * listener rather than the unicast-only bind tests use. Only then is a FAILED
   * periodic re-join worth shouting about. */
  private joinedGroup = false;
  /** When the socket bound, and when the last packet arrived — the two clocks the
   * staleness check compares against (`null` last-packet = nothing since bind). */
  private boundAt = 0;
  private lastPacketAt: number | null = null;
  /** Latched so the stale transition is logged/emitted once, not every minute. */
  private reportedStale = false;
  /** Gates ONLY handlePacket's routine "last packet from ..." repeats — transitions and
   * error emissions bypass it (they go through emitStatus, which note()s). */
  private readonly statusThrottle: SourceStatusThrottle;
  private readonly ports = new Map<string, PortState>();
  private readonly lastTemp = new Map<string, number>();
  private readonly discoveredPorts = new Set<string>();
  private stopped = true;

  constructor(opts: KegtronUdpSourceOptions) {
    this.bus = opts.bus;
    this.settings = opts.settings;
    this.reconcile = opts.reconcile;
    this.group = opts.group ?? DEFAULT_GROUP;
    this.configuredPort = opts.port ?? DEFAULT_PORT;
    this.bindAddress = opts.bindAddress ?? DEFAULT_BIND_ADDRESS;
    this.pourTimeoutMs = opts.pourTimeoutMs ?? DEFAULT_POUR_TIMEOUT_MS;
    this.rejoinIntervalMs = opts.rejoinIntervalMs ?? REJOIN_INTERVAL_MS;
    this.staleAfterMs = opts.staleAfterMs ?? STALE_AFTER_MS;
    this.statusThrottle = new SourceStatusThrottle(opts.statusIntervalMs ?? DEFAULT_STATUS_INTERVAL_MS);
  }

  /** The actual bound {address, port} once start() has succeeded (useful in tests
   * that bind on port 0), or null before start()/after stop(). Additive beyond the
   * brief's literal Source interface — needed for any caller (tests) that must learn
   * an OS-assigned ephemeral port. */
  address(): { address: string; port: number } | null {
    return this.boundAddress;
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (!this.settings.get('udpEnabled')) {
      this.emitStatus(false, 'UDP streaming disabled in settings');
      return;
    }
    await this.bindSocket();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.rejoinTimer) {
      clearInterval(this.rejoinTimer);
      this.rejoinTimer = null;
    }
    for (const state of this.ports.values()) {
      if (state.timeoutTimer) {
        clearTimeout(state.timeoutTimer);
        state.timeoutTimer = null;
      }
    }
    this.ports.clear();
    this.lastTemp.clear();
    this.discoveredPorts.clear();
    const socket = this.socket;
    this.socket = null;
    this.boundAddress = null;
    if (socket) {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    }
  }

  // -- socket lifecycle -------------------------------------------------------------

  private bindSocket(): Promise<void> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = socket;
      // A bind failure emits 'error' and the success callback below never runs — this
      // promise MUST still settle, or start() pends forever and SourceManager.startAll's
      // sequential await never reaches the sources registered after this one (and a
      // settings-save's restartSourcesIfLive hangs the PATCH request with it).
      let settled = false;

      // Never let an unhandled 'error' crash the process (EventEmitter default) — a
      // bind failure (e.g. port already in use) marks the source unhealthy instead.
      socket.on('error', (err) => {
        this.emitStatus(false, `socket error: ${err.message}`);
        if (!settled) {
          settled = true;
          // The socket never bound; drop our reference so stop() doesn't try to close it.
          if (this.socket === socket) this.socket = null;
          try { socket.close(); } catch { /* already closed by the bind failure */ }
          resolve();
        }
      });
      socket.on('message', (msg) => this.handlePacket(msg));

      socket.bind(this.configuredPort, this.bindAddress, () => {
        settled = true;
        // stop() may have run while bind() was still in flight (e.g. start()
        // immediately followed by stop()) — this.socket would already be null/closed
        // in that case, so don't resurrect bound-state on top of it.
        if (this.stopped || this.socket !== socket) {
          resolve();
          return;
        }
        // Periodic multicast RE-JOIN — verified on real hardware (2026-08-01,
        // UniFi network): the stream lived exactly as long as the switch's IGMP
        // snooping table remembered the join (~5 minutes), then died until the
        // next source restart re-joined (udp_activity timeline: 50% coverage,
        // repeated ~6-minute gaps). With IGMP snooping enabled but NO querier on
        // the network, nothing ever refreshes memberships — so we refresh our own:
        // drop + re-add every minute emits a fresh IGMP report, keeping the
        // snooping table alive regardless of the network gear's configuration.
        // Harmless where snooping is off/querier exists (a redundant report).
        this.rejoinTimer = setInterval(() => {
          if (this.stopped || this.socket !== socket) return;
          try {
            socket.dropMembership(this.group);
          } catch { /* wasn't joined (unicast-only bind) — re-add below still tries */ }
          try {
            socket.addMembership(this.group);
            // A successful re-add means we ARE a member again — un-latch the flag, or a
            // single transient failure would keep it false forever and the guard below
            // would silence every FUTURE genuine failure (only the 3-minute stale check
            // would eventually notice, without this diagnostic).
            this.joinedGroup = true;
          } catch (err) {
            // A re-add that fails after a SUCCESSFUL initial join leaves this process
            // permanently outside the group — every subsequent packet goes to a socket
            // that is no longer a member, silently. Swallowing this is what made the
            // failure undiagnosable, so say so loudly. (When the initial join never
            // succeeded we're deliberately unicast-only — already logged once at bind,
            // and not worth repeating every minute.)
            if (this.joinedGroup) {
              const detail = err instanceof Error ? err.message : String(err);
              console.error(
                `[kegtron_udp] multicast re-join of ${this.group} FAILED — this process is no `
                + `longer receiving multicast: ${detail}`,
              );
              this.joinedGroup = false;
              this.emitStatus(false, `multicast re-join failed: ${detail}`);
            }
          }
          this.checkStale();
        }, this.rejoinIntervalMs);
        try {
          // Best-effort: joining fails harmlessly when bound to a specific unicast
          // test address (e.g. 127.0.0.1) rather than the wildcard interface — the
          // socket still receives directly-addressed unicast packets either way,
          // which is exactly what tests send (brief: "do NOT require real multicast
          // in tests"). In production (bindAddress '0.0.0.0'), this is the real join.
          socket.addMembership(this.group);
          this.joinedGroup = true;
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          console.warn(`[kegtron_udp] addMembership(${this.group}) failed, continuing as unicast-only: ${detail}`);
        }
        const addr = socket.address();
        this.boundAddress = { address: addr.address, port: addr.port };
        this.boundAt = Date.now();
        this.lastPacketAt = null;
        this.reportedStale = false;
        // One unambiguous line per start, so `docker logs … | grep kegtron_udp` answers
        // "did it bind, and did it actually join the group?" without any UI access.
        console.info(
          `[kegtron_udp] listening on ${addr.address}:${addr.port}, multicast group `
          + `${this.group} ${this.joinedGroup ? 'joined' : 'NOT joined (unicast-only)'}`,
        );
        this.emitStatus(true, `listening on ${addr.address}:${addr.port}`);
        resolve();
      });
    });
  }

  // -- packet handling ----------------------------------------------------------------

  private handlePacket(msg: Buffer): void {
    if (this.stopped) return;
    this.lastPacketAt = Date.now();
    if (this.reportedStale) {
      // Recovered — say so, so a log/status reader can see the gap close rather than
      // being left with the last "the stream stopped" line forever.
      this.reportedStale = false;
      console.info('[kegtron_udp] packets are arriving again');
    }
    // Raw tap for the connection doctor + the udp_activity timeline — fires for
    // EVERY datagram, malformed ones included, so "what is actually on the wire"
    // is inspectable from the admin UI.
    const rawStr = msg.toString('utf8');
    const emitRaw = (serial?: string) => this.bus.emit('udp_packet_raw', {
      raw: rawStr.slice(0, 2048), ts: new Date().toISOString(),
      ...(serial ? { serial } : {}),
    });
    let raw: unknown;
    try {
      raw = JSON.parse(rawStr);
    } catch {
      emitRaw();
      console.warn('[kegtron_udp] dropped malformed packet: invalid JSON');
      return;
    }

    const parsed = parsePacket(raw);
    if (!parsed) {
      emitRaw();
      console.warn('[kegtron_udp] dropped malformed packet: unrecognized shape');
      return;
    }
    emitRaw(parsed.serialNum);

    const ts = new Date().toISOString();
    this.handleTelemetry(parsed, ts);
    for (const port of parsed.ports) {
      this.handlePort(parsed.serialNum, port, ts);
    }
    // Routine repeat, throttled (first packet + any unhealthy->healthy recovery still
    // emit immediately) — per-datagram emission was 5/sec/port during pours, and every
    // one landed in the log + the sources UI. See ../statusThrottle.ts.
    if (this.statusThrottle.shouldEmit(true)) {
      this.emitStatus(true, `last packet from ${parsed.serialNum} at ${ts}`);
    }
  }

  private handleTelemetry(parsed: ParsedPacket, ts: string): void {
    if (parsed.temp === null) return;
    const prev = this.lastTemp.get(parsed.serialNum);
    if (prev === parsed.temp) return;
    this.lastTemp.set(parsed.serialNum, parsed.temp);
    this.bus.emit('telemetry', {
      monitor: this.monitorRef(parsed.serialNum, 0),
      temp: parsed.temp,
      humidity: null, // not present in the UDP payload (page 3) — Phase 1 storage samples it
      ts,
    });
  }

  private handlePort(serialNum: string, port: ParsedPortPacket, ts: string): void {
    const key = `${serialNum}:${port.portIndex}`;
    let state = this.ports.get(key);
    if (!state) {
      state = {
        pouring: false, lastCurServMl: 0, pourStartedAtMs: null,
        lastVolStartMl: null, lastVolDispMl: null, lastVolSizeMl: null,
        timeoutTimer: null,
      };
      this.ports.set(key, state);
    }

    const monitor = this.monitorRef(serialNum, port.portIndex);

    if (!this.discoveredPorts.has(key)) {
      this.discoveredPorts.add(key);
      // Reconciled-or-fallback `monitor` (see monitorRef()) is what gets persisted —
      // when unmatched, this is what actually creates the `udp:{serialNum}` monitor
      // row so a cloudless UDP-only setup still has something to bind in the admin UI
      // (brief: "so it still surfaces in admin for binding"). When matched, this just
      // touches the existing cloud-discovered row (harmless no-op upsert).
      this.bus.emit('device_discovered', { monitor, serial: serialNum });
    }

    if (
      state.lastVolStartMl !== port.volStartMl
      || state.lastVolDispMl !== port.volDispensedMl
      || state.lastVolSizeMl !== port.volSizeMl
    ) {
      state.lastVolStartMl = port.volStartMl;
      state.lastVolDispMl = port.volDispensedMl;
      state.lastVolSizeMl = port.volSizeMl;
      this.bus.emit('volume_update', {
        monitor, volStartMl: port.volStartMl, volDispensedMl: port.volDispensedMl,
        sizeMl: port.volSizeMl, ts,
      });
    }

    if (port.curServMl > 0) {
      if (!state.pouring) {
        state.pouring = true;
        state.pourStartedAtMs = Date.now();
        state.lastCurServMl = port.curServMl;
        this.bus.emit('pour_started', { monitor, ts });
        this.bus.emit('pour_progress', { monitor, curServMl: port.curServMl, ts });
      } else if (port.curServMl > state.lastCurServMl) {
        state.lastCurServMl = port.curServMl;
        this.bus.emit('pour_progress', { monitor, curServMl: port.curServMl, ts });
      }
      this.armPourTimeout(key, monitor, state);
    } else if (state.pouring) {
      // curServ cleared (0/absent) while a pour was active -> the serving just ended
      // (page 4, "Notes": curServ "automatically clears after a serving has ended").
      this.finishPour(state, monitor, ts);
    }
  }

  /** (Re)arms the packet-loss safety-net timer for a pouring port: if no further
   * packet arrives for this port within pourTimeoutMs, the pour is treated as ended
   * using the last known curServ. Cancelled/replaced on every packet for this port
   * while it's pouring, and cancelled outright in stop(). */
  private armPourTimeout(key: string, monitor: MonitorRef, state: PortState): void {
    if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
    state.timeoutTimer = setTimeout(() => {
      state.timeoutTimer = null;
      this.finishPour(state, monitor, new Date().toISOString());
    }, this.pourTimeoutMs);
  }

  /** Always emits pour_completed with source:'udp' and the final curServ — the
   * binding design decision from the task brief: dedupe happens at record level
   * (StateManager's PourDeduper, Task 5) rather than by suppressing this emit when
   * cloud is healthy, which also covers "cloud is currently down" for free. (This is
   * why the constructor's original `isCloudHealthy` option was never read — it was
   * kept "reserved" for a while and has since been removed as dead wiring.) */
  private finishPour(state: PortState, monitor: MonitorRef, ts: string): void {
    if (state.timeoutTimer) {
      clearTimeout(state.timeoutTimer);
      state.timeoutTimer = null;
    }
    const durationMs = state.pourStartedAtMs !== null
      ? Math.max(0, Date.now() - state.pourStartedAtMs)
      : null;
    this.bus.emit('pour_completed', {
      monitor, volumeMl: state.lastCurServMl, durationMs, source: 'udp', ts,
    });
    state.pouring = false;
    state.lastCurServMl = 0;
    state.pourStartedAtMs = null;
  }

  /** Resolves a packet's `(serialNum, portIndex)` to the MonitorRef every event for it
   * gets emitted under. No `reconcile` option at all -> bare `serialNum` as identifier
   * (pre-Task-8 behavior, preserved for backward compatibility — see the constructor
   * option's doc comment). With `reconcile` wired: its result when matched (lands on
   * the SAME monitor row cloud discovery created), else a synthetic `udp:{serialNum}`
   * fallback (cloudless UDP-only setups still get a bindable monitor). */
  private monitorRef(serialNum: string, portIndex: number): MonitorRef {
    if (!this.reconcile) return { type: 'kegtron_pro', identifier: serialNum, portIndex };
    const reconciled = this.reconcile(serialNum, portIndex);
    return reconciled ?? { type: 'kegtron_pro', identifier: `udp:${serialNum}`, portIndex };
  }

  /**
   * Called on every re-join tick: a socket that has heard nothing for STALE_AFTER_MS is
   * reported unhealthy rather than left claiming "listening". Silence measured from the
   * last packet, or from bind when none has ever arrived — the latter is the "wrong
   * Docker network / device not broadcasting" case, which otherwise looks identical to a
   * healthy idle wall.
   */
  private checkStale(): void {
    const since = this.lastPacketAt ?? this.boundAt;
    if (Date.now() - since < this.staleAfterMs) return;
    if (this.reportedStale) return;
    this.reportedStale = true;
    const minutes = Math.round((Date.now() - since) / 60_000);
    const detail = this.lastPacketAt == null
      ? `bound to ${this.bindAddress}:${this.configuredPort} but no packet has EVER arrived `
        + `(${minutes}m) — check multicast reaches this host (Docker needs host networking) `
        + 'and that the device has UDP streaming enabled'
      : `no packets for ${minutes}m — the stream stopped`;
    console.error(`[kegtron_udp] ${detail}`);
    this.emitStatus(false, detail);
  }

  private emitStatus(healthy: boolean, detail: string): void {
    this.statusThrottle.note(healthy);
    this.bus.emit('source_status', {
      source: 'kegtron_udp', healthy, detail, ts: new Date().toISOString(),
    });
  }
}
