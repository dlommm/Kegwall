import {
  type EventBus, type PowerState, type WakeSource,
} from './events.js';

const MOTION_EVENT_MIN_INTERVAL_MS = 5_000;

export interface PresenceZoneConfig {
  wallId: number;
  slug: string;
  screensaverAfterMinutes: number | null;
  offAfterMinutes: number | null;
}

interface Zone {
  cfg: PresenceZoneConfig;
  state: PowerState;
  timer: ReturnType<typeof setTimeout> | null;
  lastMotionEventAt: number; // motion_detected debounce, monotonic-ish via Date.now deltas
}

/** Per-wall display power state machine (presence spec Part A/A1). In-memory only —
 * a server restart resets every zone to 'active' (screens on is the safe default).
 * Pure timers + bus emission; reading walls from the DB and subscribing wake sources
 * is presenceAttach.ts's job so this stays unit-testable with fake timers. */
export class PresenceRegistry {
  private zones = new Map<string, Zone>();

  constructor(private bus: EventBus) {}

  configure(zones: PresenceZoneConfig[]): void {
    const next = new Map<string, Zone>();
    for (const cfg of zones) {
      const prev = this.zones.get(cfg.slug);
      if (prev) { if (prev.timer) clearTimeout(prev.timer); prev.timer = null; }
      const zone: Zone = {
        cfg,
        state: prev?.state ?? 'active',
        timer: null,
        lastMotionEventAt: prev?.lastMotionEventAt ?? 0,
      };
      next.set(cfg.slug, zone);
    }
    for (const [slug, zone] of this.zones) {
      if (!next.has(slug) && zone.timer) clearTimeout(zone.timer);
    }
    this.zones = next;
    for (const zone of this.zones.values()) {
      if (zone.state === 'active') this.schedule(zone);
      // screensaver/off zones stay put across a reconfigure; next motion reschedules.
    }
  }

  motion(slug: string | null, source: WakeSource): void {
    const targets = slug === null
      ? [...this.zones.values()]
      : [this.zones.get(slug)].filter((z): z is Zone => z !== undefined);
    const now = Date.now();
    for (const zone of targets) {
      if (now - zone.lastMotionEventAt >= MOTION_EVENT_MIN_INTERVAL_MS) {
        zone.lastMotionEventAt = now;
        this.bus.emit('motion_detected', {
          wallSlug: slug, source, ts: new Date().toISOString(),
        });
      }
      this.transition(zone, 'active');
      this.schedule(zone);
    }
  }

  setState(slug: string | null, state: PowerState): void {
    const targets = slug === null
      ? [...this.zones.values()]
      : [this.zones.get(slug)].filter((z): z is Zone => z !== undefined);
    for (const zone of targets) {
      if (zone.timer) { clearTimeout(zone.timer); zone.timer = null; }
      this.transition(zone, state);
      // Deliberately no schedule(): an explicit state holds until the next motion.
    }
  }

  stateOf(slug: string): PowerState | undefined { return this.zones.get(slug)?.state; }

  snapshot(): Array<{ wallId: number; slug: string; state: PowerState }> {
    return [...this.zones.values()].map((z) => ({
      wallId: z.cfg.wallId, slug: z.cfg.slug, state: z.state,
    }));
  }

  stop(): void {
    for (const zone of this.zones.values()) {
      if (zone.timer) clearTimeout(zone.timer);
      zone.timer = null;
    }
  }

  /** (Re)arms the idle chain from "activity just happened". Only called for 'active'. */
  private schedule(zone: Zone): void {
    if (zone.timer) { clearTimeout(zone.timer); zone.timer = null; }
    const { screensaverAfterMinutes: saver, offAfterMinutes: off } = zone.cfg;
    if (saver !== null) {
      zone.timer = setTimeout(() => {
        this.transition(zone, 'screensaver');
        if (off !== null) {
          zone.timer = setTimeout(() => this.transition(zone, 'off'), (off - saver) * 60_000);
        }
      }, saver * 60_000);
    } else if (off !== null) {
      zone.timer = setTimeout(() => this.transition(zone, 'off'), off * 60_000);
    }
  }

  private transition(zone: Zone, state: PowerState): void {
    if (zone.state === state) return; // no-op ⇒ no event ⇒ no automation-action loops
    zone.state = state;
    this.bus.emit('display_power_changed', {
      wallId: zone.cfg.wallId, wallSlug: zone.cfg.slug, state, ts: new Date().toISOString(),
    });
  }
}
