export interface MonitorRef {
  type: 'kegtron_pro' | 'kegtron_gen1';
  identifier: string; // Pro: mdash device id; Gen 1: MAC lowercase
  portIndex: number;
}

/** Canonical `(type, identifier, portIndex)` string key for a `MonitorRef` -- the single
 * source of truth for every Map/Set keyed by monitor identity across the ingest pipeline
 * (StateManager's live/online maps, PourDeduper's dedupe ring, PourSynthesizer's per-ref
 * baselines). Final review Minor 7 / T5 ("extract if third consumer appears"): this was
 * copy-pasted verbatim in `state.ts`, `pourDedupe.ts`, and `pourSynth.ts` -- the trigger
 * fired when the third copy landed, so it's consolidated here instead. */
export function monitorRefKey(ref: MonitorRef): string {
  return `${ref.type}:${ref.identifier}:${ref.portIndex}`;
}

export interface EventMap {
  volume_update: {
    monitor: MonitorRef; volStartMl: number; volDispensedMl: number;
    sizeMl: number | null; ts: string;
  };
  pour_started: { monitor: MonitorRef; ts: string };
  pour_progress: { monitor: MonitorRef; curServMl: number; ts: string };
  pour_completed: {
    monitor: MonitorRef; volumeMl: number; durationMs: number | null;
    source: 'cloud' | 'udp' | 'ble'; ts: string;
  };
  telemetry: { monitor: MonitorRef; temp: number | null; humidity: number | null; ts: string };
  device_discovered: {
    monitor: MonitorRef; serial?: string; portName?: string; meta?: Record<string, unknown>;
  };
  device_online: { monitor: MonitorRef; ts: string };
  device_offline: { monitor: MonitorRef; ts: string };
  source_status: {
    source: 'kegtron_cloud' | 'kegtron_udp' | 'gen1_mqtt' | 'gen1_ble' | 'mqtt_publisher';
    healthy: boolean; detail: string; ts: string;
  };
  state_changed: { scope: 'taps' | 'notifications' | 'sources'; ts: string };
}

type Handler<E> = (payload: E) => void;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<Handler<any>>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) { set = new Set(); this.handlers.set(event, set); }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch (err) {
        // Subscriber errors must never break the pipeline (spec: source isolation).
        console.error(`[events] handler for ${String(event)} threw`, err);
      }
    }
  }
}
