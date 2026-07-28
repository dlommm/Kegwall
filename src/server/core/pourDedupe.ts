import type { MonitorRef } from './events.js';

// A pour is a duplicate of an already-registered one for the same monitor when it
// arrives within this many ms of the registered pour's ts...
const WINDOW_MS = 30_000;
// ...and its volume is within tolerance: max(TOLERANCE_PCT * registeredVolume, MIN_TOLERANCE_ML).
const TOLERANCE_PCT = 0.1;
const MIN_TOLERANCE_ML = 30;
// Tracked entries older than this (relative to the incoming event's own ts) are pruned
// before every check, so the ring never grows past what's still "live" for dedup purposes.
const EXPIRY_MS = 60_000;

function refKey(ref: MonitorRef): string {
  return `${ref.type}:${ref.identifier}:${ref.portIndex}`;
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
    const key = refKey(ref);
    const tsMs = Date.parse(ts);

    // Prune expired entries first so the ring never accumulates stale state — this is
    // what keeps memory bounded even under sustained, well-spaced-out legitimate pours
    // (see pourDedupe.test.ts's 10k-pour memory-bound case).
    const live = (this.entries.get(key) ?? []).filter((e) => tsMs - e.tsMs < EXPIRY_MS);

    const isDuplicate = live.some((e) => {
      if (Math.abs(tsMs - e.tsMs) > WINDOW_MS) return false;
      const tolerance = Math.max(e.volumeMl * TOLERANCE_PCT, MIN_TOLERANCE_ML);
      return Math.abs(volumeMl - e.volumeMl) <= tolerance;
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
