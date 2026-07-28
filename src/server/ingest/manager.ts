import type { EventBus } from '../core/events.js';
import type { Source, SourceName } from './source.js';

export interface SourceStatus {
  name: SourceName;
  registered: boolean;
  healthy: boolean;
  detail: string;
  lastEventAt: string | null;
}

// `satisfies Record<SourceName, true>` gives a compile-time exhaustiveness guard: adding
// or removing a SourceName in source.ts / events.ts without updating this set is a type
// error. status() always reports one row per known source, even ones never registered.
const SOURCE_NAME_SET = {
  kegtron_cloud: true, kegtron_udp: true, gen1_mqtt: true, gen1_ble: true, mqtt_publisher: true,
} satisfies Record<SourceName, true>;
const ALL_SOURCE_NAMES = Object.keys(SOURCE_NAME_SET) as SourceName[];

interface HealthEntry {
  healthy: boolean;
  detail: string;
  lastEventAt: string | null;
}

export class SourceManager {
  private sources = new Map<SourceName, Source>();
  private health = new Map<SourceName, HealthEntry>();
  private started = false;

  constructor(bus: EventBus) {
    bus.on('source_status', (e) => {
      this.health.set(e.source, { healthy: e.healthy, detail: e.detail, lastEventAt: e.ts });
    });
  }

  register(source: Source): void {
    this.sources.set(source.name, source);
  }

  /** Clears all registrations — used by Task 8's `registerConfiguredSources()` to
   * rebuild the registered-source set from scratch on every call (initial app boot AND
   * every settings-triggered restart), so a source whose configuration was just removed
   * (e.g. `mqtt` cleared in settings) doesn't linger `registered:true` pointing at a
   * stale, already-stopped instance. Callers are responsible for `stopAll()`-ing any
   * previously-registered sources first if they were running — `reset()` itself only
   * touches bookkeeping, never a live source.
   *
   * Final review Minor/T8 fix: also resets the health entry for every source that WAS
   * registered (never for names that were never registered — those simply have no
   * entry, per `status()`'s `h?.healthy ?? false` fallback) back to the same
   * not-yet-reported shape a never-registered source shows: `{healthy:false,
   * detail:'not configured', lastEventAt:null}`. Before this fix, a source's last
   * reported health lingered in `this.health` forever — `registered` would correctly
   * flip to `false` after a reset, but `healthy` stayed whatever it was before the
   * source was dropped, so `status()` could report `{registered:false, healthy:true}`
   * for a source that no longer exists. Phase 3 builds its admin health UI directly on
   * `status()`, so that combination would read as "still fine" for a monitor path that
   * was just disabled. */
  reset(): void {
    for (const name of this.sources.keys()) {
      this.health.set(name, { healthy: false, detail: 'not configured', lastEventAt: null });
    }
    this.sources.clear();
  }

  async startAll(): Promise<void> {
    this.started = true;
    for (const source of this.sources.values()) {
      try {
        await source.start();
      } catch (err) {
        // Source isolation: a throwing start() marks that source unhealthy and we
        // move on to the next one — it must never take down the whole process.
        const detail = err instanceof Error ? err.message : String(err);
        this.health.set(source.name, { healthy: false, detail, lastEventAt: new Date().toISOString() });
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const source of this.sources.values()) {
      try {
        await source.stop();
      } catch (err) {
        // stopAll must never throw — this runs during process shutdown / test teardown.
        console.error(`[sources] ${source.name} stop() threw`, err);
      }
    }
  }

  /** True once `startAll()` has been invoked at least once. Used by the settings PATCH
   * route (`routes/crud.ts`) to decide whether a relevant settings change should trigger
   * a live stop/reconfigure/restart cycle. In production this is always true by the time
   * an authenticated settings PATCH can even reach the server (`index.ts` always passes
   * `startSources: true` to `buildApp()`, and the PATCH route only exists on an
   * already-running app). In tests that build the app with the default
   * `startSources: false` and never manually start sources, this stays `false`, so an
   * incidental settings PATCH (e.g. existing tests that set `kegtronApiKey` to a fake
   * value) does NOT spin up a real `KegtronCloudSource` against the live mdash.net API —
   * see task-8-report.md "Deviations". */
  isStarted(): boolean {
    return this.started;
  }

  status(): SourceStatus[] {
    return ALL_SOURCE_NAMES.map((name) => {
      const h = this.health.get(name);
      return {
        name,
        registered: this.sources.has(name),
        healthy: h?.healthy ?? false,
        detail: h?.detail ?? '',
        lastEventAt: h?.lastEventAt ?? null,
      };
    });
  }
}
