import { monitorRefKey, type MonitorRef } from './events.js';

// A pour is a duplicate of an already-registered one for the same monitor when it
// arrives within this many ms of the registered pour's ts...
//
// Final review I2: the original 30s window left no margin against udpSource.ts's
// documented cloud-reporting latency (5-30s, PLUS WS delivery time on top) -- a UDP
// pour reported within ~2s of ending could plausibly have its cloud-side duplicate
// arrive just past 30s later and get double-recorded. Widened to 90s to comfortably
// clear that worst case; EXPIRY_MS (below) grows with it so an entry is never pruned
// out from under a still-in-window comparison.
export const DEDUPE_WINDOW_MS = 90_000;
const WINDOW_MS = DEDUPE_WINDOW_MS;
// ...and its volume is within tolerance: max(TOLERANCE_PCT * max(volumeMl, entry.volumeMl), MIN_TOLERANCE_ML).
// Anchored to the LARGER of the two volumes (not just the registered one) so the
// outcome is symmetric regardless of which report — the original or the duplicate —
// happened to arrive first (see Fix round 1: order-dependent tolerance).
const TOLERANCE_PCT = 0.1;
const MIN_TOLERANCE_ML = 30;
// Tracked entries whose ts is more than this far from the incoming event's ts (in
// either direction — see Fix round 1) are pruned before every check, so the ring
// never grows past what's still "live" for dedup purposes. Always kept >= WINDOW_MS
// (2x it, same ratio as the original 60s/30s pairing) so a live-for-dedup entry is
// never pruned before WINDOW_MS's own comparison would have aged it out anyway.
const EXPIRY_MS = 180_000;

/** True when two reports' volumes are close enough to be the same physical pour. Shared
 * with the persisted-pour check (`findRecordedTwin`, db/pours.ts) so both agree. */
export function volumesMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(TOLERANCE_PCT * Math.max(a, b), MIN_TOLERANCE_ML);
}

interface Entry {
  volumeMl: number;
  tsMs: number;
}

/**
 * Suppresses duplicate `pour_completed` reports for the same physical pour observed by
 * more than one source (e.g. Kegtron Pro's cloud shadow diff AND a local UDP/BLE
 * listener both surfacing the same serving). Keyed on `(type, identifier, portIndex)` —
 * see `MonitorRef` — so different ports/devices are never deduped against each other.
 *
 * Time math is always done against the event's own `ts` (never wall-clock `Date.now()`),
 * so behavior is deterministic under test and correct even when events are delivered
 * with real-world lag or out of publish order between sources.
 *
 * Only a non-duplicate ("true") pour is registered. A suppressed duplicate does NOT
 * refresh/extend the window — it keeps comparing against the original registration —
 * so a burst of near-simultaneous re-reports of the same pour all dedupe against the
 * one entry instead of each other, which also keeps memory bounded under a duplicate
 * storm (see pourDedupe.test.ts's "tight burst" case).
 */
export class PourDeduper {
  private entries = new Map<string, Entry[]>();

  /**
   * Returns `false` (and does not register) when a pour for the same monitor with
   * volume within tolerance was already registered within the past `WINDOW_MS`.
   * Otherwise registers this pour and returns `true`.
   */
  shouldRecord(ref: MonitorRef, volumeMl: number, ts: string): boolean {
    const key = monitorRefKey(ref);
    const tsMs = Date.parse(ts);

    // Prune expired entries first so the ring never accumulates stale state — this is
    // what keeps memory bounded even under sustained, well-spaced-out legitimate pours
    // (see pourDedupe.test.ts's 10k-pour memory-bound case). Uses an absolute delta so
    // an entry with a FUTURE ts relative to this call (e.g. an earlier-arriving report
    // that happens to carry a later event ts, or an out-of-order backfill) still ages
    // out instead of lingering forever (Fix round 1).
    const live = (this.entries.get(key) ?? []).filter((e) => Math.abs(tsMs - e.tsMs) < EXPIRY_MS);

    const isDuplicate = live.some((e) => {
      if (Math.abs(tsMs - e.tsMs) > WINDOW_MS) return false;
      return volumesMatch(volumeMl, e.volumeMl);
    });

    if (isDuplicate) {
      // Still write back the pruned list (expired entries were dropped above) even
      // though this pour itself isn't registered.
      if (live.length > 0) this.entries.set(key, live); else this.entries.delete(key);
      return false;
    }

    live.push({ volumeMl, tsMs });
    this.entries.set(key, live);
    return true;
  }

  /** Total number of tracked (not-yet-expired-as-of-last-check) entries across every
   * monitor. Exposed for tests verifying the ring doesn't grow unbounded; additive
   * beyond the brief's literal `shouldRecord`-only interface. */
  size(): number {
    let total = 0;
    for (const list of this.entries.values()) total += list.length;
    return total;
  }
}
