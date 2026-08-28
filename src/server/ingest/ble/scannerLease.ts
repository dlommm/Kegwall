import type { BleScanner, NoblePeripheral } from './scanner.js';

// ---------------------------------------------------------------------------
// One source's hold on the shared BleScanner (scanner.ts) — the acquire/release
// "start()-races-stop()" dance that gen1/bleSource.ts, kegtron/proBleSource.ts, and
// bleMotion.ts each carried verbatim, extracted here (dedupe pass; behavior preserved
// exactly — the three copies had NOT drifted). Each source owns ONE lease for its whole
// lifetime; the scanner itself stays refcounted/shared (see scanner.ts's header for why
// noble must be shared at all).
//
// The interleaving guarantees this preserves, exactly as each source's tests pin them:
//
//  - STOP-BEFORE-START-COMPLETES (release-during-load): `scanner.acquire()` awaits the
//    (possibly slow, possibly hanging — see scanner.ts's import timeout) noble load. If
//    the owning source's stop() runs while that await is in flight, stop()'s
//    `releaseIfHeld()` sees no held release fn yet (still null) and does nothing; it is
//    acquire() itself that, once the load settles, observes `isStopped()` and
//    immediately releases the just-registered subscription — so the scanner's refcount
//    always balances and a stopped source never keeps noble alive.
//  - ADAPTER RELAYS AFTER STOP are suppressed: `onStatus` is only forwarded for adapter
//    state changes while `isStopped()` is false (a stopped source must not emit
//    source_status), but an acquire FAILURE always reports via `onStatus(false, detail)`
//    regardless — the caller marks itself unhealthy and returns (pre-existing behavior
//    in all three sources; note stop() can legally race in between).
// ---------------------------------------------------------------------------

export interface ScannerLeaseHooks {
  /** Forwarded to the scanner's discover fan-out untouched — each source's own
   * decode/filter pipeline. */
  onPeripheral: (peripheral: NoblePeripheral) => void;
  /** Funnel for BOTH the scanner's adapter health relays and the acquire-failure
   * detail — each source's own `emitStatus` (they differ only in source name and
   * per-source mirroring, e.g. bleMotion.ts's `registry.markHealth` fan-out). */
  onStatus: (healthy: boolean, detail: string) => void;
  /** The owning source's `stopped` flag — read (not captured) so the lease always sees
   * the current value across the acquire await. */
  isStopped: () => boolean;
}

export class ScannerLease {
  private release: (() => Promise<void>) | null = null;

  /** Subscribes the hooks to `scanner` (see scanner.ts's `acquire`). Never throws: an
   * import/timeout failure is reported via `onStatus(false, detail)` and swallowed —
   * the source stays registered-but-unhealthy, same as before extraction. */
  async acquire(scanner: BleScanner, hooks: ScannerLeaseHooks): Promise<void> {
    try {
      this.release = await scanner.acquire({
        onPeripheral: hooks.onPeripheral,
        onAdapter: (healthy, detail) => { if (!hooks.isStopped()) hooks.onStatus(healthy, detail); },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      hooks.onStatus(false, detail);
      return;
    }
    if (hooks.isStopped()) {
      // stop() ran while the import/timeout race was in flight — releaseIfHeld() saw
      // null then, so this side of the race must release the subscription acquire()
      // just registered (see the interleaving notes in this file's header).
      const release = this.release;
      this.release = null;
      await release();
    }
  }

  /** stop()'s side of the dance: releases the held subscription, if any. Idempotent;
   * a no-op while acquire() is still awaiting the load (see header). */
  async releaseIfHeld(): Promise<void> {
    const release = this.release;
    this.release = null;
    if (release) await release();
  }
}
