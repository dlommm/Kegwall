import type { EventBus } from './events.js';
import type { PresenceRegistry } from './presence.js';
import type { LogService } from './logService.js';
import {
  type SettingsStore, type MotionSource, parseMotionSources,
} from '../db/settings.js';

// ---------------------------------------------------------------------------
// Displays & Presence hub Task 1: the runtime side of the `motionSources` settings key
// (see db/settings.ts's `motionSourceSchema`/`parseMotionSources` for the schema/parse
// half). `MotionSourceRegistry` is the single place that resolves "a motion source with
// this id fired" into a `PresenceRegistry.motion()` wake — transports (a later task's
// GPIO line watcher, BLE proximity scanner, mqtt topic subscriber, or a webhook route)
// all funnel through `trigger()` rather than calling `presence.motion()` directly, so
// per-source health/lastTriggeredAt bookkeeping lives in exactly one place.
// ---------------------------------------------------------------------------

/** A sentinel `sourceId` prefix for the tablet's own camera-based wake (Plan B face
 * sign-in / presence camera) — those rows are DERIVED from wall config, never stored as
 * a `motionSources` entry, so `trigger()` recognizes the prefix instead of looking the
 * id up in the registry. */
const CAMERA_SOURCE_PREFIX = 'camera:';

export interface MotionSourceStatus {
  lastTriggeredAt: string | null;
  healthy: boolean;
  detail: string;
}

const DEFAULT_STATUS: MotionSourceStatus = { lastTriggeredAt: null, healthy: true, detail: '' };

export class MotionSourceRegistry {
  // Per-source runtime status, keyed by MotionSource.id — NOT persisted (a restart resets
  // every source to the default status, same "in-memory only" precedent as
  // PresenceRegistry's own zone state).
  private statuses = new Map<string, MotionSourceStatus>();

  constructor(
    private bus: EventBus,
    private presence: PresenceRegistry,
    private log: LogService,
    private settings: SettingsStore,
  ) {}

  /** Every stored entry, valid or not, malformed ones dropped with a warn log — used
   * internally by `trigger()` so a DISABLED-but-otherwise-valid source can still be
   * distinguished from a truly unknown id (see that method). */
  private allSources(): MotionSource[] {
    const raw = this.settings.get('motionSources') as unknown[];
    const parsed = parseMotionSources(raw);
    const dropped = raw.length - parsed.length;
    if (dropped > 0) {
      this.log.warn('app', `motionSources: dropped ${dropped} malformed entr${dropped === 1 ? 'y' : 'ies'} while parsing settings`);
    }
    return parsed;
  }

  /** Valid, ENABLED sources parsed from settings (drops malformed with a warn log). */
  sources(): MotionSource[] {
    return this.allSources().filter((s) => s.enabled);
  }

  /**
   * Fires a wake attributed to a source. Accepts:
   *  - a registry id (looked up among ALL stored sources, enabled or not) — wakes that
   *    source's `wallSlug` and stamps its `lastTriggeredAt`;
   *  - the `camera:<wallSlug>` sentinel (tablet camera rows are derived, not stored) —
   *    wakes that wall as a 'camera' source, and stamps ITS OWN status entry (keyed by
   *    the full sentinel string, e.g. `"camera:main"`) rather than a registry entry —
   *    Task 3's GET /api/presence/sources reads this back via `statusOf('camera:' +
   *    slug)` so a derived camera row can surface `lastTriggeredAt` too;
   *  - `null` (anonymous/legacy webhook) — wakes ALL walls, stamps nothing.
   * A DISABLED source id is silently ignored (no wake at all — an admin turned it off on
   * purpose). An id that matches NO stored source (unknown/stale) falls back to waking
   * ALL walls, same as `null`, plus a warn log — this is the pre-Task-1 legacy behavior
   * for a webhook that doesn't carry a recognized source id, preserved so an unrecognized
   * id degrades to "wake everything" rather than silently doing nothing.
   */
  trigger(sourceId: string | null): void {
    if (sourceId === null) {
      this.presence.motion(null, 'webhook', undefined);
      return;
    }
    if (sourceId.startsWith(CAMERA_SOURCE_PREFIX)) {
      const wallSlug = sourceId.slice(CAMERA_SOURCE_PREFIX.length) || null;
      this.presence.motion(wallSlug, 'camera', sourceId);
      // Task 3 ledgered fix: stamp the sentinel's OWN status entry (there's no stored
      // `motionSources` row for a camera row to stamp instead — see the doc comment
      // above) so `statusOf('camera:' + slug)` reflects the wake.
      const prev = this.statuses.get(sourceId) ?? DEFAULT_STATUS;
      this.statuses.set(sourceId, { ...prev, lastTriggeredAt: new Date().toISOString() });
      return;
    }
    const found = this.allSources().find((s) => s.id === sourceId);
    if (!found) {
      this.log.warn('app', `motionSources: trigger() got unknown source id "${sourceId}" — waking all walls (legacy fallback)`);
      this.presence.motion(null, 'webhook', undefined);
      return;
    }
    if (!found.enabled) return; // admin disabled it — no wake, no fallback
    // `found.type` ('mqtt' | 'webhook' | 'gpio' | 'ble') is a subset of `WakeSource`, so
    // it's passed straight through — no cast/mapping step needed.
    this.presence.motion(found.wallSlug, found.type, sourceId);
    const prev = this.statuses.get(sourceId) ?? DEFAULT_STATUS;
    this.statuses.set(sourceId, { ...prev, lastTriggeredAt: new Date().toISOString() });
  }

  statusOf(id: string): MotionSourceStatus {
    return this.statuses.get(id) ?? DEFAULT_STATUS;
  }

  /** Transports (mqtt subscriber, GPIO watcher, BLE scanner — later tasks) report their
   * own per-source connectivity here, independent of `trigger()`'s wake path. */
  markHealth(id: string, healthy: boolean, detail: string): void {
    const prev = this.statuses.get(id) ?? DEFAULT_STATUS;
    this.statuses.set(id, { ...prev, healthy, detail });
  }

  snapshot(): Array<{ source: MotionSource; status: MotionSourceStatus }> {
    return this.sources().map((source) => ({ source, status: this.statusOf(source.id) }));
  }

  /**
   * Final-review C2: every stored source, enabled or not (same `{source, status}` shape
   * as `snapshot()`) — used by the admin `GET /api/presence/sources` route so a source an
   * admin just disabled doesn't vanish from the only surface that can re-enable it.
   * Transport gating (`sources()`, consumed by `ingest/bootstrap.ts`) is untouched and
   * stays enabled-only; this is purely an admin-visibility read.
   */
  snapshotAll(): Array<{ source: MotionSource; status: MotionSourceStatus }> {
    return this.allSources().map((source) => ({ source, status: this.statusOf(source.id) }));
  }

  /** Final-review M2: drops a source's in-memory runtime status when it's actually
   * deleted (routes/presence.ts's DELETE route) — otherwise a stale health/
   * lastTriggeredAt entry for an id that no longer has a `motionSources` row sits in
   * `statuses` forever (unbounded growth across create/delete churn, and a confusing
   * resurfaced status if that exact id space were ever reused). `Map.delete` on a
   * missing key is a no-op, matching the route's own idempotent-delete semantics.
   * Deliberately id-scoped rather than a broad reconcile-against-`allSources()` sweep --
   * a camera row's `camera:<slug>` sentinel status (stamped by `trigger()` above) has no
   * corresponding `motionSources` row EVER, so a blanket "drop anything not in
   * allSources()" pass would wrongly wipe every camera row's `lastTriggeredAt` too. */
  forgetStatus(id: string): void {
    this.statuses.delete(id);
  }
}

/**
 * Boot-time, one-shot migration: `settings.mqtt.motionTopics` (Plan A Task 6) is
 * superseded by the `motionSources` registry (Task 1) — each legacy `{topic, wallSlug}`
 * entry becomes an equivalent mqtt `MotionSource` (`match: {mode: 'any'}` reproduces the
 * old "any non-falsy payload is motion" behavior exactly, see `ingest/motionMqtt.ts`'s
 * `isMotionPayload`), appended to `motionSources`, and `mqtt.motionTopics` is cleared so
 * a second boot is a no-op (nothing left to migrate). Must run BEFORE
 * `registerConfiguredSources` so the ingest layer only ever sees the post-migration
 * settings shape (see context.ts).
 *
 * `crypto.randomUUID()` needs no import — it's a Node global (`globalThis.crypto`, Node
 * >= 19, well under this app's `engines.node: >=24` floor).
 */
export function migrateMotionTopics(settings: SettingsStore, log: LogService): void {
  const mqtt = settings.get('mqtt');
  const topics = mqtt?.motionTopics ?? [];
  if (topics.length === 0) return; // nothing to migrate (fresh install, or already ran)

  const migrated: MotionSource[] = topics.map((t) => ({
    id: crypto.randomUUID(),
    name: t.topic,
    type: 'mqtt',
    enabled: true,
    wallSlug: t.wallSlug,
    config: { topic: t.topic, match: { mode: 'any' } },
  }));

  const existing = settings.get('motionSources') as unknown[];
  settings.set('motionSources', [...existing, ...migrated]);
  settings.set('mqtt', { ...mqtt!, motionTopics: [] });
  log.info('app', `migrated ${migrated.length} legacy mqtt.motionTopics entr${migrated.length === 1 ? 'y' : 'ies'} into motionSources`);
}
