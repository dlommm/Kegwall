import type { EventBus } from '../core/events.js';
import type { MotionSourceRegistry } from '../core/motionSources.js';
import type { Source } from './source.js';
import type { BleScanner, NoblePeripheral } from './ble/scanner.js';
import { ScannerLease } from './ble/scannerLease.js';
import { BTHOME_SERVICE_UUID, parseBthomeServiceData } from './bthome.js';

// ---------------------------------------------------------------------------
// Displays & Presence hub Task 7: a `Source` (`motion_ble`) for ble-type `MotionSource`
// entries (Task 1's `ctx.motion.sources()`) -- BTHome v2 motion beacons read off the
// SAME shared `BleScanner` the Gen 1 direct + Kegtron Pro BLE sources already use (see
// ble/scanner.ts's header for why sharing is mandatory: noble is a process-wide
// singleton). Unlike those two, this source never OWNS a scanner -- `scanner` is a
// required constructor arg (not `scanner ?? new BleScanner(...)`), since bootstrap.ts
// only ever constructs one when at least one BLE-touching source is configured, and
// this source has no nobleFactory/importTimeoutMs test seams of its own to fall back
// on (its tests fake the scanner itself -- see bleMotion.test.ts).
//
// The scanner scans `[]` (unfiltered) with `allowDuplicates: true` already -- BTHome
// adverts arrive at the shared 'discover' callback exactly like every other device's,
// this source just ignores anything whose service data doesn't decode as BTHome.
// ---------------------------------------------------------------------------

/** The Bluetooth Base UUID's 128-bit-form suffix (dashes stripped, lowercase) that
 * every standard 16-bit service UUID gets embedded into when a stack reports the long
 * form -- `0000XXXX-0000-1000-8000-00805F9B34FB`. Noble reports whichever form the
 * peripheral itself advertised; BTHome devices have been observed doing both. */
const BLUETOOTH_BASE_UUID_SUFFIX = '00001000800000805f9b34fb';

/** Normalizes a noble `serviceData[].uuid` to its bare lowercase short form so `'fcd2'`
 * and `'0000fcd2-0000-1000-8000-00805f9b34fb'` compare equal. Anything that isn't a
 * 128-bit Bluetooth-Base-UUID embedding (i.e. already short, or some other unrelated
 * 128-bit vendor UUID) passes through as lowercase/dash-stripped -- a non-BTHome
 * service simply won't equal `BTHOME_SERVICE_UUID` either way. */
function normalizeUuid(uuid: string): string {
  const compact = uuid.toLowerCase().replace(/-/g, '');
  if (compact.length === 32 && compact.endsWith(BLUETOOTH_BASE_UUID_SUFFIX)) {
    return compact.slice(4, 8);
  }
  return compact;
}

/** Lowercase, colon-stripped MAC comparison key -- deliberately simpler than gen1/
 * bleSource.ts's `normalizeBleAddress` (which reformats back into colon-separated form
 * for MonitorRef.identifier's sake): this source only ever COMPARES two normalized
 * strings for equality, it never displays or persists one, so there's no reason to
 * keep the colons around. */
function normalizeMac(mac: string): string {
  return mac.toLowerCase().replace(/:/g, '');
}

/** Same macOS CoreBluetooth quirk gen1/bleSource.ts's `normalizeBleAddress` documents:
 * `address` comes back literally `'unknown'` on that backend, with only `id` left as a
 * stable per-pairing handle. Falls back to `id` in that case; `null` only when neither
 * is present. */
function peripheralMac(peripheral: NoblePeripheral): string | null {
  const candidate = peripheral.address && peripheral.address !== 'unknown'
    ? peripheral.address : peripheral.id;
  return candidate ? normalizeMac(candidate) : null;
}

export interface BleMotionSourceOptions {
  /** One entry per configured ble-type motion source (`ctx.motion.sources().filter(s
   * => s.type === 'ble')`, see `ingest/bootstrap.ts`). `mac: null` means "any BTHome
   * motion advert wakes this source's wall", same broadcast convention as
   * `MotionSource.wallSlug: null` waking every wall. */
  sources: Array<{ id: string; mac: string | null }>;
  /** The shared scanner (ble/scanner.ts) -- REQUIRED, not defaulted, since this source
   * never owns noble's lifecycle itself (see header comment). */
  scanner: BleScanner;
  /** Fires the actual wake + per-source `lastTriggeredAt`/health bookkeeping for a
   * matched source id -- see `core/motionSources.ts`'s `MotionSourceRegistry`. */
  registry: MotionSourceRegistry;
  bus: EventBus;
}

export class BleMotionSource implements Source {
  readonly name = 'motion_ble' as const;

  private readonly sources: BleMotionSourceOptions['sources'];
  private readonly scanner: BleScanner;
  private readonly registry: MotionSourceRegistry;
  private readonly bus: EventBus;

  private readonly lease = new ScannerLease();
  // Encrypted-advert logging is once-per-MAC (not once-per-advert -- a beacon readvertises
  // multiple times a second with allowDuplicates), same "in-memory dedupe set, cleared on
  // stop()" idiom as gen1/bleSource.ts's/proBleSource.ts's own `discovered` sets.
  private readonly loggedEncryptedMacs = new Set<string>();
  private stopped = true;

  constructor(opts: BleMotionSourceOptions) {
    this.sources = opts.sources;
    this.scanner = opts.scanner;
    this.registry = opts.registry;
    this.bus = opts.bus;
  }

  async start(): Promise<void> {
    this.stopped = false;
    // Acquire-failure reporting and the stop()-races-acquire() interleavings live in
    // ble/scannerLease.ts -- the SAME shared dance gen1/bleSource.ts and
    // kegtron/proBleSource.ts's start() use.
    await this.lease.acquire(this.scanner, {
      onPeripheral: (peripheral) => this.handleDiscover(peripheral),
      onStatus: (healthy, detail) => this.emitStatus(healthy, detail),
      isStopped: () => this.stopped,
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.loggedEncryptedMacs.clear();
    await this.lease.releaseIfHeld();
  }

  private handleDiscover(peripheral: NoblePeripheral): void {
    if (this.stopped) return;
    const serviceData = peripheral.advertisement?.serviceData;
    if (!serviceData) return;
    const entry = serviceData.find((e) => normalizeUuid(e.uuid) === BTHOME_SERVICE_UUID);
    if (!entry) return;
    const reading = parseBthomeServiceData(entry.data);
    if (!reading) return;

    const mac = peripheralMac(peripheral);

    if (reading.encrypted) {
      const key = mac ?? 'unknown';
      if (!this.loggedEncryptedMacs.has(key)) {
        this.loggedEncryptedMacs.add(key);
        console.debug(`[motion_ble] skipping encrypted BTHome advert from ${key} (no bindkey configured)`);
      }
      return;
    }

    // `false` (explicit "clear") and `null` (no 0x21 object in this advert) are both
    // ignored -- only a `true` reading ever wakes anything. A sensor's own "motion
    // cleared" broadcast carries no useful signal here: presence.ts's own 5s debounce
    // (not this source) is what decides when a wall goes back to sleep.
    if (reading.motion !== true) return;

    // No per-source debounce here on purpose -- presence's own ~5s wake debounce
    // (PresenceRegistry.motion()) already collapses the burst of repeat adverts
    // allowDuplicates produces for the SAME physical motion event, same as it does for
    // motion_mqtt/motion_gpio. Adding a second, source-local debounce window/config
    // knob here would just be a second place to get that number wrong.
    for (const source of this.sources) {
      if (source.mac === null || (mac !== null && normalizeMac(source.mac) === mac)) {
        this.registry.trigger(source.id);
      }
    }
  }

  /** Emits the aggregate `source_status` bus event AND mirrors it per-source via
   * `registry.markHealth` for every configured ble source id -- same two-audience
   * pattern as motionMqtt.ts's/gpioMotion.ts's own `emitStatus`. The scanner's adapter
   * state is inherently shared (one noble instance), so a state change here really does
   * apply to every ble-type motion source at once -- there's no finer-grained "this
   * source's own health" to report separately. */
  private emitStatus(healthy: boolean, detail: string): void {
    this.bus.emit('source_status', { source: 'motion_ble', healthy, detail, ts: new Date().toISOString() });
    for (const source of this.sources) this.registry.markHealth(source.id, healthy, detail);
  }
}
