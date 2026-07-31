/**
 * Shared BLE scanner — ONE noble instance fanned out to every BLE ingest source
 * (Gen 1 direct + Kegtron Pro adverts).
 *
 * Why this exists: `@abandonware/noble` is a process-wide singleton. When two sources
 * each owned the noble lifecycle, the first `stop()`'s `removeAllListeners('discover')`
 * would silently kill the OTHER source's subscription, and the shared scan state made
 * start/stop ordering load-bearing. This class makes the sharing explicit: sources
 * `acquire()` a subscription and get back a release function; the underlying noble
 * import/scan starts on the first acquire and stops on the last release.
 *
 * NOT a module-level singleton on purpose — `registerConfiguredSources()` constructs a
 * fresh instance per registration pass and hands it to both sources, so tests get full
 * isolation by constructing their own (with a FakeNoble via `nobleFactory`, the same
 * seam Gen1BleSource always had).
 */

/** Minimal slice of `@abandonware/noble`'s API actually used — see gen1/noble.d.ts's
 * header for why nothing relies on the package's own shipped types. */
export interface NobleLike {
  state: string;
  on(event: string, listener: (...args: any[]) => void): void;
  startScanningAsync(serviceUUIDs?: string[], allowDuplicates?: boolean): Promise<void>;
  stopScanningAsync(): Promise<void>;
  removeAllListeners(event?: string): void;
}

export interface NoblePeripheral {
  id?: string;
  address?: string;
  advertisement?: { manufacturerData?: Buffer; localName?: string };
}

export interface BleSubscriber {
  onPeripheral(peripheral: NoblePeripheral): void;
  /** Adapter-level status relay — each source turns these into its OWN source_status
   * events (the manager tracks health per source name). */
  onAdapter(healthy: boolean, detail: string): void;
}

export interface BleScannerOptions {
  /** Test seam replacing the real dynamic import — same contract as
   * Gen1BleSourceOptions.nobleFactory always had. */
  nobleFactory?: () => Promise<NobleLike>;
  /** Bounds the noble import wait (a bare import can HANG indefinitely with no
   * adapter — see Gen1BleSourceOptions.importTimeoutMs's history). Default 8000ms. */
  importTimeoutMs?: number;
}

const DEFAULT_IMPORT_TIMEOUT_MS = 8_000;

export class BleScanner {
  private readonly nobleFactory: (() => Promise<NobleLike>) | undefined;
  private readonly importTimeoutMs: number;

  private readonly subs = new Set<BleSubscriber>();
  private noble: NobleLike | null = null;
  private loading: Promise<NobleLike> | null = null;
  private lastAdapter: { healthy: boolean; detail: string } | null = null;

  constructor(opts: BleScannerOptions = {}) {
    this.nobleFactory = opts.nobleFactory;
    this.importTimeoutMs = opts.importTimeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS;
  }

  /** Subscribes and (on first acquire) imports noble + starts scanning. Throws when
   * the import fails or times out — the caller marks itself unhealthy and moves on.
   * Returns the release function; the LAST release stops the scan and drops noble. */
  async acquire(sub: BleSubscriber): Promise<() => Promise<void>> {
    this.subs.add(sub);
    let noble: NobleLike;
    try {
      noble = await this.ensureNoble();
    } catch (err) {
      this.subs.delete(sub);
      throw err;
    }
    if (!this.subs.has(sub)) {
      // Released (or torn down) while the import was in flight.
      return async () => {};
    }
    // Late subscribers get the current adapter picture immediately instead of waiting
    // for the next stateChange.
    if (this.lastAdapter) sub.onAdapter(this.lastAdapter.healthy, this.lastAdapter.detail);
    void noble;
    return async () => this.release(sub);
  }

  private async release(sub: BleSubscriber): Promise<void> {
    if (!this.subs.delete(sub)) return;
    if (this.subs.size > 0) return;
    const noble = this.noble;
    this.noble = null;
    this.loading = null;
    this.lastAdapter = null;
    if (noble) {
      try {
        await noble.stopScanningAsync();
      } catch {
        // best-effort — nothing further to do if the adapter is already gone
      }
      noble.removeAllListeners('discover');
      noble.removeAllListeners('stateChange');
    }
  }

  private ensureNoble(): Promise<NobleLike> {
    if (this.noble) return Promise.resolve(this.noble);
    if (!this.loading) {
      this.loading = this.loadNobleWithTimeout().then((noble) => {
        this.noble = noble;
        this.broadcastAdapter(false, `waiting for Bluetooth adapter (state: ${noble.state})`);
        noble.on('stateChange', (state: string) => this.handleStateChange(state));
        noble.on('discover', (peripheral: NoblePeripheral) => {
          for (const s of this.subs) s.onPeripheral(peripheral);
        });
        if (noble.state === 'poweredOn') this.handleStateChange('poweredOn');
        return noble;
      });
      // A failed load must not poison later acquires permanently — clear the cached
      // promise so a source restart retries the import.
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  }

  private handleStateChange(state: string): void {
    const noble = this.noble;
    if (!noble) return;
    if (state === 'poweredOn') {
      this.broadcastAdapter(true, 'scanning for Kegtron adverts');
      // No scan filter: Kegtron Gen 1 filters by manufacturer id, the Pro by local
      // name — both decoders discard everything else. allowDuplicates matters: every
      // advert is a fresh volume reading.
      void noble.startScanningAsync([], true).catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        this.broadcastAdapter(false, `startScanning failed: ${detail}`);
      });
    } else {
      this.broadcastAdapter(false, `adapter state: ${state}`);
    }
  }

  private broadcastAdapter(healthy: boolean, detail: string): void {
    this.lastAdapter = { healthy, detail };
    for (const s of this.subs) s.onAdapter(healthy, detail);
  }

  private loadNobleWithTimeout(): Promise<NobleLike> {
    const load = this.nobleFactory ? this.nobleFactory() : this.importRealNoble();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(
          `@abandonware/noble import timed out after ${this.importTimeoutMs}ms (missing native dependency or no Bluetooth adapter available?)`,
        ));
      }, this.importTimeoutMs);
    });
    return Promise.race([load, timeout]).finally(() => clearTimeout(timer!));
  }

  private async importRealNoble(): Promise<NobleLike> {
    // Dynamic import ONLY — it's an optionalDependency that may not be installed.
    const mod: any = await import('@abandonware/noble');
    return (mod.default ?? mod) as NobleLike;
  }
}
