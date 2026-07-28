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

  constructor(bus: EventBus) {
    bus.on('source_status', (e) => {
      this.health.set(e.source, { healthy: e.healthy, detail: e.detail, lastEventAt: e.ts });
    });
  }

  register(source: Source): void {
    this.sources.set(source.name, source);
  }

  async startAll(): Promise<void> {
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
