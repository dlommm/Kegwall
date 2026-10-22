/**
 * The kegerator tablet's "armed pourer" registry (Pour Wall overhaul Phase 3,
 * design 3a). When someone taps their avatar on the tablet, the tablet arms
 * them here; the NEXT pour recorded on any tap is attributed to them (see
 * StateManager's pour_completed handler — an armed pourer beats a tap's
 * default drinker, since a person standing at the tablet is the more explicit
 * signal). Arming auto-expires so a walk-away never silently credits someone
 * with the next patron's pour.
 *
 * In-memory only, one slot: the physical tablet is a single kiosk and a
 * kegerator pours for one person at a time. Re-arming (same or different
 * drinker) simply replaces the slot.
 */

export const ARM_TTL_MS = 10 * 60 * 1000;
/** A pour stamped up to this long BEFORE arming still counts (arming mid-pour, device
 * clock drift); anything older is a late delivery, not this pourer's pour. */
export const ARM_GRACE_MS = 2 * 60 * 1000;

export interface ArmedPourer {
  drinkerId: number;
  armedAt: number;
  expiresAt: number;
}

export class TabletArmRegistry {
  private slot: ArmedPourer | null = null;

  arm(drinkerId: number, now: number = Date.now(), ttlMs: number = ARM_TTL_MS): ArmedPourer {
    this.slot = { drinkerId, armedAt: now, expiresAt: now + ttlMs };
    return this.slot;
  }

  disarm(): void {
    this.slot = null;
  }

  /** The currently armed pourer, or null if none/expired (expiry is lazy). */
  current(now: number = Date.now()): ArmedPourer | null {
    if (this.slot && this.slot.expiresAt <= now) this.slot = null;
    return this.slot;
  }

  /** Claims the armed slot for a pour: returns the drinker id and disarms, or
   * null when nothing (unexpired) is armed. One pour per arming — the tablet's
   * done screen re-arms explicitly if the pourer taps "stay signed in".
   *
   * `pourTsMs` (the pour's own completion time) guards against late deliveries: a
   * pour stamped well before arming (e.g. replayed by the Kegtron cloud backfill) is
   * not theirs, and leaves the slot armed for their real pour. */
  consume(now: number = Date.now(), pourTsMs?: number): number | null {
    const armed = this.current(now);
    if (!armed) return null;
    if (pourTsMs !== undefined && Number.isFinite(pourTsMs) && pourTsMs < armed.armedAt - ARM_GRACE_MS) return null;
    this.slot = null;
    return armed.drinkerId;
  }
}
