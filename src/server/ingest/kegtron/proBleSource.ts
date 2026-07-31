import type { EventBus, MonitorRef } from '../../core/events.js';
import type { SettingsStore } from '../../db/settings.js';
import type { Source } from '../source.js';
import { PourSynthesizer } from '../gen1/pourSynth.js';
import { BleScanner, type NobleLike, type NoblePeripheral } from '../ble/scanner.js';

// ---------------------------------------------------------------------------
// Kegtron PRO BLE advertisement source — the pour FALLBACK path for Pros when UDP
// can't reach the server (different VLAN) and cloud polling is too slow.
//
// The format is OUR OWN reverse-engineering (docs/kegtron/pro-ble-format.md — captured
// live from a KT-420 via esp32/kegtron-pro-capture.yaml, validated with a real pour;
// Kegtron publishes a BLE spec for Gen 1 only). Byte layout, 27-byte manufacturer-data
// payload under company id 0x0000, volumes u16 BE mL:
//
//   [0-1]  keg size          [3-4]  volume start        [6-7]  volume dispensed
//   [2]    0x00 (observed)   [5]    0x00 (observed)     [8]    port byte
//   [9-26] port name — ASCII, zero-padded, TRUNCATED at 18 chars
//
//   port byte: high nibble = 0xC + portIndex (C1/D1/E1/F1 → ports 0-3); low nibble
//   observed 0x1 on enabled ports (disabled-port encoding unknown — not validated).
//
// Company id 0x0000 is too generic to trust alone, so the decoder ALSO requires the
// advert's local name to start with "Kegtron-" (Pro naming; Gen 1 uses "Kegtron "
// with a space and manufacturer id 0xffff — no overlap).
//
// CRITICAL semantics (pour-validated, see the format doc): `volume dispensed` is an
// ODOMETER (it can exceed `volume start` — never auto-reset on keg swaps) that updates
// ONCE, at pour END (~1-3s after flow stops), with no intermediate values. That is a
// transmitter-side limitation — no receiver can make BLE live. So this source feeds
// the Gen 1 PourSynthesizer model (cumulative-jump → pour_completed) and the live
// 200 ms pour takeover remains UDP-only.
//
// Identity: the advert carries NO serial. The local name's XXXXXX suffix is matched
// against known cloud/UDP serials (reconcileProMonitorByBleName — unambiguous suffix
// match only) so BLE lands on the SAME monitor row other sources use and PourDeduper
// can collapse cross-source duplicates; otherwise a `ble:{mac}` fallback identifier
// (the `udp:{serial}` precedent) keeps a cloudless setup fully functional.
// ---------------------------------------------------------------------------

const PRO_MFR_ID = 0x0000;
const PRO_RAW_LENGTH = 2 + 27; // 2-byte LE company id + the 27-byte payload above
const PRO_NAME_PREFIX = 'Kegtron-';
const PORT_NIBBLE_BASE = 0xc;

export interface DecodedProAdvert {
  portIndex: number; // 0-3 (KT-420 has four)
  sizeMl: number;
  volStartMl: number;
  volDispensedMl: number;
  portName: string;
}

/** Decodes a Kegtron Pro BLE manufacturer-data Buffer (noble's raw form, company-id
 * prefix included). `localName` must look like a Pro ("Kegtron-XXXXXX") — the 0x0000
 * company id alone would false-positive on unrelated devices. Returns null for
 * anything unrecognizable; never throws. */
export function decodeProAdvert(
  manufacturerData: Buffer, localName: string | undefined,
): DecodedProAdvert | null {
  if (!localName || !localName.startsWith(PRO_NAME_PREFIX)) return null;
  if (manufacturerData.length !== PRO_RAW_LENGTH) return null;
  if (manufacturerData.readUInt16LE(0) !== PRO_MFR_ID) return null;

  const payload = manufacturerData.subarray(2);
  const portIndex = (payload.readUInt8(8) >> 4) - PORT_NIBBLE_BASE;
  if (portIndex < 0 || portIndex > 3) return null;

  return {
    portIndex,
    sizeMl: payload.readUInt16BE(0),
    volStartMl: payload.readUInt16BE(3),
    volDispensedMl: payload.readUInt16BE(6),
    portName: payload.subarray(9, 27).toString('utf8').replace(/\0+$/, ''),
  };
}

/** The device-level handle a Pro advert DOES carry: the local name's serial-tail
 * suffix ("Kegtron-010016" → "010016"). Empty string when absent. */
export function proNameSuffix(localName: string): string {
  return localName.slice(PRO_NAME_PREFIX.length);
}

export interface KegtronProBleSourceOptions {
  bus: EventBus;
  settings: SettingsStore;
  /** Maps (name suffix, portIndex) onto the monitor ref cloud/UDP already use —
   * bootstrap wires db/monitors.ts's reconcileProMonitorByBleName. Null → the source
   * falls back to a `ble:{mac}` identifier. */
  reconcile?: (nameSuffix: string, portIndex: number) => MonitorRef | null;
  /** Shared scanner — see Gen1BleSourceOptions.scanner. */
  scanner?: BleScanner;
  /** Test seams, identical contract to Gen1BleSourceOptions. Ignored when `scanner`
   * is supplied. */
  nobleFactory?: () => Promise<NobleLike>;
  importTimeoutMs?: number;
}

export class KegtronProBleSource implements Source {
  readonly name = 'pro_ble' as const;

  private readonly bus: EventBus;
  private readonly settings: SettingsStore;
  private readonly reconcile: ((nameSuffix: string, portIndex: number) => MonitorRef | null) | undefined;
  private readonly scanner: BleScanner;
  private readonly synth: PourSynthesizer;

  private releaseScanner: (() => Promise<void>) | null = null;
  private readonly discovered = new Set<string>();
  /** (mac:port) → reconciled ref, so the (cheap, but per-advert ~1/s) DB lookup runs
   * once per port, not on every advert. A source restart (settings PATCH) clears it. */
  private readonly refCache = new Map<string, MonitorRef>();
  private stopped = true;

  constructor(opts: KegtronProBleSourceOptions) {
    this.bus = opts.bus;
    this.settings = opts.settings;
    this.reconcile = opts.reconcile;
    this.synth = new PourSynthesizer(opts.bus);
    this.scanner = opts.scanner ?? new BleScanner({
      nobleFactory: opts.nobleFactory, importTimeoutMs: opts.importTimeoutMs,
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (!this.settings.get('proBleEnabled')) {
      this.emitStatus(false, 'Pro BLE disabled in settings');
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
      const release = this.releaseScanner;
      this.releaseScanner = null;
      await release();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.discovered.clear();
    this.refCache.clear();
    this.synth.dispose();
    const release = this.releaseScanner;
    this.releaseScanner = null;
    if (release) await release();
  }

  private handleDiscover(peripheral: NoblePeripheral): void {
    if (this.stopped) return;
    const manufacturerData = peripheral.advertisement?.manufacturerData;
    const localName = peripheral.advertisement?.localName;
    if (!manufacturerData || manufacturerData.length === 0) return;
    const decoded = decodeProAdvert(manufacturerData, localName);
    if (!decoded) return;
    const mac = (peripheral.address && peripheral.address !== 'unknown'
      ? peripheral.address : peripheral.id)?.toLowerCase();
    if (!mac) return;

    const cacheKey = `${mac}:${decoded.portIndex}`;
    let monitor = this.refCache.get(cacheKey);
    if (!monitor) {
      monitor = this.reconcile?.(proNameSuffix(localName!), decoded.portIndex)
        ?? { type: 'kegtron_pro', identifier: `ble:${mac}`, portIndex: decoded.portIndex };
      this.refCache.set(cacheKey, monitor);
    }

    if (!this.discovered.has(cacheKey)) {
      this.discovered.add(cacheKey);
      this.bus.emit('device_discovered', {
        monitor,
        portName: decoded.portName || undefined,
        meta: { via: 'pro_ble', bleName: localName },
      });
    }

    const ts = new Date().toISOString();
    // The synthesizer's cumulative-jump model is EXACTLY the Pro's odometer semantics
    // (volDisp updates once at pour end); it emits volume_update on every reading and
    // pour_completed (source 'ble') when a jump settles.
    this.synth.onReading(monitor, decoded.volStartMl, decoded.volDispensedMl, decoded.sizeMl, ts);
    this.emitStatus(true, `last advert from ${localName} (${mac}) at ${ts}`);
  }

  private emitStatus(healthy: boolean, detail: string): void {
    this.bus.emit('source_status', { source: 'pro_ble', healthy, detail, ts: new Date().toISOString() });
  }
}
