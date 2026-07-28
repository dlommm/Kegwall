import type { EventBus } from '../core/events.js';
import type { Source, SourceName } from './source.js';

export interface SourceStatus {
  name: SourceName;
  registered: boolean;
  healthy: boolean;
  detail: string;
  lastEventAt: string | null;
}

// Kept in sync by hand with the SourceName union in source.ts / events.ts — status()
// always reports one row per known source, even ones never registered in this process.
const ALL_SOURCE_NAMES: SourceName[] = [
  'kegtron_cloud', 'kegtron_udp', 'gen1_mqtt', 'gen1_ble', 'mqtt_publisher',
];

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
