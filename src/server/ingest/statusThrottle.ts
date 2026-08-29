/**
 * Throttle for ROUTINE per-datagram/per-reading `source_status` emissions
 * (server-hardening review, 2026-08-29).
 *
 * Sources like kegtron_udp and gen1_mqtt used to emit a healthy `source_status` for
 * EVERY datagram/reading — during a pour that's 5/sec per port, each one fanned out to
 * every bus listener, written to the app log (core/logService.ts subscribes to
 * `source_status`), and pushed at the sources admin UI. This class gates only those
 * routine "still alive, last packet at ..." emissions:
 *
 *   - the FIRST routine emission always passes (fast "data is actually flowing"
 *     feedback right after connect/bind);
 *   - any healthy-flag TRANSITION always passes immediately (error/recovery must never
 *     wait out the interval) — call note() from the source's unconditional emit path so
 *     the throttle knows the true last-emitted state even for emissions it didn't gate;
 *   - an unchanged repeat passes at most once per intervalMs.
 *
 * Non-routine emissions (bind/subscribe results, socket errors, staleness) stay
 * UNTHROTTLED at their call sites — they only ever fire on actual events.
 */
export class SourceStatusThrottle {
  private lastHealthy: boolean | null = null;
  private lastEmitMs = 0;
  private routineEmitted = false;

  constructor(private readonly intervalMs: number) {}

  /** Record an emission that bypassed the throttle (transition/error paths) so the next
   * shouldEmit() compares against the truly-last-emitted state. */
  note(healthy: boolean, nowMs: number = Date.now()): void {
    this.lastHealthy = healthy;
    this.lastEmitMs = nowMs;
  }

  /** Decides (and records) whether a routine emission of `healthy` goes out now. Call
   * exactly once per candidate emission — a `true` return claims the slot. */
  shouldEmit(healthy: boolean, nowMs: number = Date.now()): boolean {
    const due = !this.routineEmitted
      || healthy !== this.lastHealthy
      || nowMs - this.lastEmitMs >= this.intervalMs;
    if (!due) return false;
    this.routineEmitted = true;
    this.note(healthy, nowMs);
    return true;
  }
}

/** Production cadence for routine status repeats: at most one "still healthy, last
 * packet at ..." per source per 30s, matching the admin sources page's freshness needs
 * without a per-datagram write amplification. */
export const DEFAULT_STATUS_INTERVAL_MS = 30_000;
