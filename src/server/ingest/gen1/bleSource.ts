import type { EventBus, MonitorRef } from '../../core/events.js';
import type { SettingsStore } from '../../db/settings.js';
import type { Source } from '../source.js';
import { PourSynthesizer } from './pourSynth.js';
import { BleScanner, type NobleLike, type NoblePeripheral } from '../ble/scanner.js';
// noble.d.ts (co-located in this directory) supplies an ambient ```declare module
// '@abandonware/noble'``` fallback for the scanner's dynamic import -- it needs no
// explicit import here; TypeScript picks up ambient .d.ts files automatically from
// tsconfig's "include" globs (see that file's header comment for why it exists).

// ---------------------------------------------------------------------------
// Gen 1 (KT-100/KT-200) DIRECT BLE source -- scans for Kegtron manufacturer-data
// adverts itself via `@abandonware/noble` rather than depending on an external
// BLE-to-MQTT bridge (see mqttSource.ts for that alternative path, and BLE/MQTT DEDUPE
// below for how the two coexist).
//
// *** decodeKegtronAdvert(): byte layout citation (mandatory external verification,
// 2026-07-28) ***
// Ported EXACTLY from the real kegtron-ble reference decoder:
// https://raw.githubusercontent.com/Bluetooth-Devices/kegtron-ble/main/src/kegtron_ble/parser.py
// (that file's own header: "shamelessly copied from"
// https://github.com/Ernst79/bleparser/blob/ac8757ad64f1fc17674dcd22111e547cdf2f205b/package/bleparser/kegtron.py,
// the original Home Assistant "Passive BLE Monitor" decoder). Relevant excerpt:
//
//   MFR_ID = 0xFFFF
//   (port,) = unpack(">B", data[6:7])
//   (keg_size, vol_start, vol_disp, port, port_name) = unpack(">HHHB20s", data)
//   port & (1<<6) == 0   -> model KT-100 (single port)
//   port & (1<<6) == 64  -> model KT-200 (dual port)
//   KT-200 only: port & (1<<4) == 0  -> "port 1" (this file's portIndex 0)
//                port & (1<<4) == 16 -> "port 2" (this file's portIndex 1)
//   port & (1<<0) == 0/1 -> unconfigured (new device) / configured
//
// So the 27-byte Kegtron payload is: bytes 0-1 keg_size (u16 BE, raw mL -- e.g. 18927 =
// KEGTRON_SIZE_DICT's "Corny (5.0 gal)"), bytes 2-3 vol_start (u16 BE, raw mL), bytes
// 4-5 vol_disp (u16 BE, raw mL), byte 6 the port/model/configured flag byte above,
// bytes 7-26 a 20-byte NUL-padded ASCII port_name.
//
// bleak's (Python) `service_info.manufacturer_data` is already a `{company_id: bytes}`
// dict with the 2-byte company id stripped off. Node's `noble` instead hands us
// `peripheral.advertisement.manufacturerData` as a single raw Buffer whose first 2
// bytes ARE that company id, little-endian, per the Bluetooth Core Spec AD structure
// for type 0xFF (verified against noble's own index.d.ts: `manufacturerData: Buffer`,
// no separate company-id field) -- so decodeKegtronAdvert() below expects noble's raw
// 29-byte form (2-byte LE company id + the 27-byte payload above) and validates the
// company id itself before parsing.
// ---------------------------------------------------------------------------

const MFR_ID = 0xffff;
const PORT_BIT_KT200 = 1 << 6; // 0x40
const PORT_BIT_PORT2 = 1 << 4; // 0x10
const PORT_BIT_CONFIGURED = 1 << 0; // 0x01
const RAW_LENGTH = 2 + 27; // 2-byte LE company id + kegtron-ble's 27-byte payload

export interface DecodedKegtronAdvert {
  model: 'KT-100' | 'KT-200';
  portIndex: 0 | 1;
  configured: boolean;
  sizeMl: number;
  volStartMl: number;
  volDispensedMl: number;
  portName: string;
}

/** Decodes a Kegtron BLE manufacturer-data Buffer (as delivered by noble, company-id
 * prefix included) per the byte layout cited above. Returns null for anything that
 * isn't recognizably a Kegtron Gen 1 advert -- wrong length, wrong company id, or (for
 * structural parity with the Python original's defensive `else: return None` branches,
 * which are actually unreachable given single-bit masks) an unrecognized port-byte
 * combination. Never throws. */
export function decodeKegtronAdvert(manufacturerData: Buffer): DecodedKegtronAdvert | null {
  if (manufacturerData.length !== RAW_LENGTH) return null;
  if (manufacturerData.readUInt16LE(0) !== MFR_ID) return null;

  const payload = manufacturerData.subarray(2);
  const kegSize = payload.readUInt16BE(0);
  const volStart = payload.readUInt16BE(2);
  const volDisp = payload.readUInt16BE(4);
  const portByte = payload.readUInt8(6);
  const portName = payload.subarray(7, 27).toString('utf8').replace(/\0+$/, '');

  let model: 'KT-100' | 'KT-200';
  let portIndex: 0 | 1;
  if ((portByte & PORT_BIT_KT200) === 0) {
    model = 'KT-100';
    portIndex = 0;
  } else if ((portByte & PORT_BIT_KT200) === PORT_BIT_KT200) {
    model = 'KT-200';
    if ((portByte & PORT_BIT_PORT2) === 0) portIndex = 0;
    else if ((portByte & PORT_BIT_PORT2) === PORT_BIT_PORT2) portIndex = 1;
    else return null; // unreachable (single-bit mask) -- kept for parity with the source
  } else {
    return null; // unreachable (single-bit mask) -- kept for parity with the source
  }

  return {
    model, portIndex, configured: (portByte & PORT_BIT_CONFIGURED) === PORT_BIT_CONFIGURED,
    sizeMl: kegSize, volStartMl: volStart, volDispensedMl: volDisp, portName,
  };
}

export interface Gen1BleSourceOptions {
  bus: EventBus;
  settings: SettingsStore;
  /** Shared BLE-active MAC map (mac -> last-BLE-seen ms; see mqttSource.ts's header
   * comment for the full dedupe design) -- every MAC this source successfully decodes
   * an advert from gets (re-)stamped with the current time here on EVERY reading, so
   * Gen1MqttSource can drop messages for it only while the stamp is still fresh (within
   * its TTL -- see mqttSource.ts's bleActiveTtlMs). Final review I1 fix: this used to be
   * a Set that, once a MAC was added, never expired -- a single BLE advert (or a BLE
   * adapter that later drops out) would permanently silence the MQTT fallback for that
   * device. Defaults to a private Map. */
  bleActiveMacs?: Map<string, number>;
  /** Shared PourSynthesizer instance -- pass the SAME instance given to
   * Gen1MqttSource so a MAC's pour baseline survives a handoff between the two
   * transports (Task 8). Defaults to a private instance owned (and disposed on
   * stop()) by this source. */
  synth?: PourSynthesizer;
  /** Test-only replacement for the real dynamic `@abandonware/noble` import -- lets
   * tests exercise start()/stop()'s wiring deterministically without real Bluetooth
   * hardware/permissions (brief: "no real BLE in CI"). Also how the "adapter/native
   * dep unavailable" and "import hangs" failure paths are tested without depending on
   * this exact sandbox's install state. Production default: a real
   * `await import('@abandonware/noble')`. Ignored when `scanner` is supplied. */
  nobleFactory?: () => Promise<NobleLike>;
  /** Bounds how long start() will wait for the noble module to load before giving up
   * and marking the source unhealthy. Production default 8000ms. Empirically, a bare
   * `import('@abandonware/noble')` can HANG INDEFINITELY (not just throw) in a
   * sandboxed/headless environment with no Bluetooth adapter -- observed directly
   * during this task's development -- so this is not merely defensive, it is required
   * for the "never crash [or hang]" isolation guarantee (source.ts / manager.ts:
   * SourceManager.startAll() awaits each source's start() in turn, so a hung start()
   * here would also block every source registered after it from ever starting).
   * Test-only override, same additive-optional-constructor-knob precedent used
   * throughout this codebase. Ignored when `scanner` is supplied. */
  importTimeoutMs?: number;
  /** The shared BLE scanner (ble/scanner.ts) — bootstrap passes ONE instance to every
   * BLE source so noble is imported/scanned once and one source's stop() can't kill
   * the other's discover subscription. Omitted (tests, single-source setups): the
   * source constructs a private scanner from nobleFactory/importTimeoutMs above. */
  scanner?: BleScanner;
}

/** Lowercase colon-separated MAC when `address` looks like one. macOS's CoreBluetooth
 * backend withholds real MAC addresses from noble (`address` comes back literally
 * `'unknown'`) and instead only exposes a stable per-pairing `id`/`uuid` -- in that
 * case this falls back to `id`, lowercased, used as-is (not a MAC, but a stable enough
 * identifier for MonitorRef.identifier). Null only if neither is present. */
function normalizeBleAddress(address: string | undefined, id: string | undefined): string | null {
  const candidate = address && address !== 'unknown' ? address : id;
  if (!candidate) return null;
  const compact = candidate.replace(/:/g, '').toLowerCase();
  if (/^[0-9a-f]{12}$/.test(compact)) return compact.match(/.{2}/g)!.join(':');
  return candidate.toLowerCase();
}

export class Gen1BleSource implements Source {
  readonly name = 'gen1_ble' as const;

  private readonly bus: EventBus;
  private readonly settings: SettingsStore;
  private readonly bleActiveMacs: Map<string, number>;
  private readonly synth: PourSynthesizer;
  private readonly ownsSynth: boolean;
  private readonly scanner: BleScanner;

  private releaseScanner: (() => Promise<void>) | null = null;
  private readonly discovered = new Set<string>();
  private stopped = true;

  constructor(opts: Gen1BleSourceOptions) {
    this.bus = opts.bus;
    this.settings = opts.settings;
    this.bleActiveMacs = opts.bleActiveMacs ?? new Map();
    this.ownsSynth = opts.synth === undefined;
    this.synth = opts.synth ?? new PourSynthesizer(opts.bus);
    this.scanner = opts.scanner ?? new BleScanner({
      nobleFactory: opts.nobleFactory, importTimeoutMs: opts.importTimeoutMs,
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (!this.settings.get('bleDirectEnabled')) {
      this.emitStatus(false, 'BLE direct disabled in settings');
      return;
    }

    try {
      this.releaseScanner = await this.scanner.acquire({
        onPeripheral: (peripheral) => this.handleDiscover(peripheral),
        onAdapter: (healthy, detail) => { if (!this.stopped) this.emitStatus(healthy, detail); },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.emitStatus(false, detail);
      return;
    }
    if (this.stopped) {
      // stop() ran while the import/timeout race was in flight
      const release = this.releaseScanner;
      this.releaseScanner = null;
      await release();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.discovered.clear();
    if (this.ownsSynth) this.synth.dispose();
    const release = this.releaseScanner;
    this.releaseScanner = null;
    if (release) await release();
  }

  // -- advert handling ------------------------------------------------------------------

  private handleDiscover(peripheral: NoblePeripheral): void {
    if (this.stopped) return;
    const manufacturerData = peripheral.advertisement?.manufacturerData;
    if (!manufacturerData || manufacturerData.length === 0) return;
    const decoded = decodeKegtronAdvert(manufacturerData);
    if (!decoded) return;
    const mac = normalizeBleAddress(peripheral.address, peripheral.id);
    if (!mac) return;

    // Stamp/refresh the last-BLE-seen time on EVERY reading (not just first sight) --
    // see mqttSource.ts's header comment (BLE/MQTT dedupe) and this option's doc
    // comment above for why a timestamp replaces the old never-expiring Set.
    this.bleActiveMacs.set(mac, Date.now());
    const monitor: MonitorRef = { type: 'kegtron_gen1', identifier: mac, portIndex: decoded.portIndex };
    const key = `${mac}:${decoded.portIndex}`;
    if (!this.discovered.has(key)) {
      this.discovered.add(key);
      this.bus.emit('device_discovered', {
        monitor,
        portName: decoded.portName || undefined,
        meta: { model: decoded.model, configured: decoded.configured },
      });
    }

    const ts = new Date().toISOString();
    this.synth.onReading(monitor, decoded.volStartMl, decoded.volDispensedMl, decoded.sizeMl, ts);
    this.emitStatus(true, `last advert from ${mac} at ${ts}`);
  }

  private emitStatus(healthy: boolean, detail: string): void {
    this.bus.emit('source_status', { source: 'gen1_ble', healthy, detail, ts: new Date().toISOString() });
  }
}
