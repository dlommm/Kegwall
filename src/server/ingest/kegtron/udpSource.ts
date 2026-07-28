import dgram from 'node:dgram';
import { z } from 'zod';
import type { EventBus, MonitorRef } from '../../core/events.js';
import type { SettingsStore } from '../../db/settings.js';
import type { Source } from '../source.js';

// ---------------------------------------------------------------------------
// Kegtron Pro UDP Streaming source (docs/kegtron/UDPStreaming.pdf, "UDP Streaming",
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

export interface KegtronUdpSourceOptions {
  bus: EventBus;
  settings: SettingsStore;
  /** Cloud source health, wired in by Task 8's SourceManager. Deliberately NOT used to
   * gate/suppress pour_completed here — pour_completed is ALWAYS emitted with
   * source:'udp' (binding design decision, task-6 brief); StateManager's PourDeduper
   * (Task 5) is what suppresses the duplicate record when cloud also reports the same
   * pour, which also covers "cloud is down" automatically without this source needing
   * to know about it. Reserved for future cross-source health-status coordination. */
  isCloudHealthy: () => boolean;
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
   * brief's literal {bus,settings,isCloudHealthy,group,port,bindAddress} constructor
   * shape — added so tests can exercise the timeout path in milliseconds rather than
   * waiting out a real 2s window. Optional and additive, same precedent as
   * mdashClient's timeoutMs / cloudSource's reconnectBaseMs (see their doc comments). */
  pourTimeoutMs?: number;
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Never throws. Returns null for anything that isn't shaped like a Kegtron UDP
 * streaming packet at all (not an object, or no valid serialNum) — the caller logs
 * and drops the packet, staying healthy (UDP is "best effort"; malformed/lost packets
 * are expected, not exceptional). A port<i> key whose value isn't itself a
 * recognizable object is individually skipped rather than failing the whole packet. */
function parsePacket(raw: unknown): ParsedPacket | null {
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
  private readonly isCloudHealthy: () => boolean;
  private readonly group: string;
  private readonly configuredPort: number;
  private readonly bindAddress: string;
  private readonly pourTimeoutMs: number;

  private socket: dgram.Socket | null = null;
  private boundAddress: { address: string; port: number } | null = null;
  private readonly ports = new Map<string, PortState>();
  private readonly lastTemp = new Map<string, number>();
  private stopped = true;

  constructor(opts: KegtronUdpSourceOptions) {
    this.bus = opts.bus;
    this.settings = opts.settings;
    this.isCloudHealthy = opts.isCloudHealthy;
    this.group = opts.group ?? DEFAULT_GROUP;
    this.configuredPort = opts.port ?? DEFAULT_PORT;
    this.bindAddress = opts.bindAddress ?? DEFAULT_BIND_ADDRESS;
    this.pourTimeoutMs = opts.pourTimeoutMs ?? DEFAULT_POUR_TIMEOUT_MS;
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
    for (const state of this.ports.values()) {
      if (state.timeoutTimer) {
        clearTimeout(state.timeoutTimer);
        state.timeoutTimer = null;
      }
    }
    this.ports.clear();
    this.lastTemp.clear();
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

      // Never let an unhandled 'error' crash the process (EventEmitter default) — a
      // bind failure (e.g. port already in use) marks the source unhealthy instead.
      socket.on('error', (err) => {
        this.emitStatus(false, `socket error: ${err.message}`);
      });
      socket.on('message', (msg) => this.handlePacket(msg));

      socket.bind(this.configuredPort, this.bindAddress, () => {
        // stop() may have run while bind() was still in flight (e.g. start()
        // immediately followed by stop()) — this.socket would already be null/closed
        // in that case, so don't resurrect bound-state on top of it.
        if (this.stopped || this.socket !== socket) {
          resolve();
          return;
        }
        try {
          // Best-effort: joining fails harmlessly when bound to a specific unicast
          // test address (e.g. 127.0.0.1) rather than the wildcard interface — the
          // socket still receives directly-addressed unicast packets either way,
          // which is exactly what tests send (brief: "do NOT require real multicast
          // in tests"). In production (bindAddress '0.0.0.0'), this is the real join.
          socket.addMembership(this.group);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          console.warn(`[kegtron_udp] addMembership(${this.group}) failed, continuing as unicast-only: ${detail}`);
        }
        const addr = socket.address();
        this.boundAddress = { address: addr.address, port: addr.port };
        this.emitStatus(true, `listening on ${addr.address}:${addr.port}`);
        resolve();
      });
    });
  }

  // -- packet handling ----------------------------------------------------------------

  private handlePacket(msg: Buffer): void {
    if (this.stopped) return;
    let raw: unknown;
    try {
      raw = JSON.parse(msg.toString('utf8'));
    } catch {
      console.warn('[kegtron_udp] dropped malformed packet: invalid JSON');
      return;
    }

    const parsed = parsePacket(raw);
    if (!parsed) {
      console.warn('[kegtron_udp] dropped malformed packet: unrecognized shape');
      return;
    }

    const ts = new Date().toISOString();
    this.handleTelemetry(parsed, ts);
    for (const port of parsed.ports) {
      this.handlePort(parsed.serialNum, port, ts);
    }
    this.emitStatus(true, `last packet from ${parsed.serialNum} at ${ts}`);
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
   * isCloudHealthy() is true, which also covers "cloud is currently down" for free. */
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

  private monitorRef(serialNum: string, portIndex: number): MonitorRef {
    return { type: 'kegtron_pro', identifier: serialNum, portIndex };
  }

  private emitStatus(healthy: boolean, detail: string): void {
    this.bus.emit('source_status', {
      source: 'kegtron_udp', healthy, detail, ts: new Date().toISOString(),
    });
  }
}
