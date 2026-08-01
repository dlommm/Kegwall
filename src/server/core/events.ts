export interface MonitorRef {
  type: 'kegtron_pro' | 'kegtron_gen1' | 'govee_sensor';
  identifier: string; // Pro: mdash device id; Gen 1: MAC lowercase; Govee: device id
  portIndex: number; // Govee sensors are always port 0 (single-sensor devices)
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
    source: 'kegtron_cloud' | 'kegtron_udp' | 'gen1_mqtt' | 'gen1_ble' | 'pro_ble' | 'mqtt_publisher' | 'govee';
    healthy: boolean; detail: string; ts: string;
    /** True when unhealthy only because the source was never CONFIGURED (no API key
     * set, etc). LogService logs this as a warn, not an error — a fresh install with
     * no keys shouldn't boot into auto-created error notifications. */
    unconfigured?: boolean;
  };
  /** One event per raw UDP datagram the Kegtron listener receives — INCLUDING
   * malformed ones (that's the debugging value). Ephemeral: nothing persists it;
   * the connection doctor's listen window collects a few samples so an admin can
   * see exactly what's arriving on the wire. `raw` is truncated to 2KB. */
  udp_packet_raw: {
    raw: string; ts: string;
    /** serialNum when the packet parsed; absent for malformed datagrams (which
     * still fire — that's the debugging value). */
    serial?: string;
  };
  /** Emitted by app.ts's 60s host sampler after each host_stats row is written —
   * ws.ts relays it as `{type:'host_stats', ...}` so walls with `showHostStats`
   * render a live CPU/RAM/disk strip without polling an authenticated endpoint. */
  host_stats_sampled: {
    cpuPct: number; memPct: number; diskPct: number | null;
    tempC: number | null; watts: number | null; ts: string;
  };
  /** scope 'walls': a wall's config/devices (or something riding the wall payload,
   * e.g. display units) changed — ws.ts relays it as `{type:'walls_changed'}` so
   * open wall/kiosk clients refetch their config without a reload (they otherwise
   * only refetched on socket reconnect, which a kiosk TV never does). */
  state_changed: { scope: 'taps' | 'notifications' | 'sources' | 'walls'; ts: string };
  /** Pour Wall overhaul Phase 6 (design 6g, Kegtron-first beers): emitted by the cloud
   * shadow differ whenever a port's configured beer NAME first appears or changes —
   * carries whatever beer facts the device shadow holds. core/beerAutoImport.ts
   * subscribes and caches unseen beers into the local library. */
  beer_seen: {
    monitor: MonitorRef; name: string; maker: string | null; style: string | null;
    abv: number | null; ibu: number | null; srm: number | null; ts: string;
  };
  /** Pour Wall overhaul Phase 6 (Govee sensors): a named ambient sensor reading from the
   * Govee cloud poller (ingest/govee/goveeSource.ts). Distinct from `telemetry` (which is
   * a KEGTRON monitor's own reading bound to a monitor ref). */
  sensor_reading: {
    sensorId: string; name: string; tempC: number | null; humidity: number | null; ts: string;
  };
  /** Pour Wall overhaul Phase 3 (tablet flow, design 3a): emitted by StateManager when a
   * recorded pour is attributed to the tablet's ARMED pourer (see core/tabletArm.ts) —
   * NOT for default-drinker or claim-flow attributions. The WS layer relays it as
   * `{type:'pour_attributed', ...}` so the tablet can flip to its done screen with the
   * final volume, beer, and the pourer's lifetime pour count. */
  pour_attributed: {
    drinkerId: number; pourId: number; tapId: number; tapNumber: number;
    beerName: string | null; volumeMl: number; pourCount: number; ts: string;
  };
  /** Phase 5 Task 3: emitted by `routes/crud.ts` whenever a keg's status transitions to
   * `on_tap` — from `POST /api/taps/:id/swap` (both the "kick the incumbent, tap a new
   * or promoted-on-deck keg" swap wizard path) and `PATCH /api/kegs/:id` (a manual status
   * flip to `on_tap`). Feeds the automation engine's `keg_tapped` trigger — see
   * `automation/engine.ts`. Not emitted by `POST /api/kegs`'s bare create path (a direct
   * on_tap creation with no incumbent to kick); see that engine's doc comment for why. */
  keg_tapped: { tapId: number; kegId: number; beerId: number; ts: string };
  /** The `keg_kicked` counterpart to `keg_tapped` above — emitted for the OUTGOING keg
   * whenever a swap kicks an incumbent on_tap keg, and from `PATCH /api/kegs/:id` on a
   * manual status flip to `kicked`. */
  keg_kicked: { tapId: number; kegId: number; beerId: number; ts: string };
  /** Phase 5 Task 3: emitted by the automation engine's `wall_banner` action. Task 4's WS
   * layer relays this to wall clients as `{type:'banner', ...}` — this event is the bus
   * hand-off point only; nothing in this task subscribes to it yet. */
  wall_banner: { text: string; kind: 'info' | 'celebrate' | 'warning'; durationMs?: number };
  /** Phase 5 Task 3: emitted by the automation engine's `party_mode` action. Task 4's WS
   * layer relays this to wall clients as `{type:'theme_override', ...}` with a
   * client-side countdown revert. */
  wall_theme_override: { minutes: number };
  /** Phase 5 Task 3: reload hook for the automation engine's in-memory rule cache — the
   * engine subscribes to this and calls `reloadRules()`. Nothing emits it yet (Task 6's
   * automations CRUD routes don't exist yet); `engine.reloadRules()` remains directly
   * callable in the meantime. See `automation/engine.ts`'s doc comment for the full
   * "why this exists before anything emits it" reasoning. */
  automations_changed: { ts: string };
  /** Phase 5 Task 5: emitted by the automation engine (`considerFire`, see
   * `automation/engine.ts`) whenever an ALERT rule (`isAlert: true`) actually fires (not
   * merely matches -- suppressed-by-cooldown/runaway fires never reach this). This is a
   * separate hand-off point from the `notify` action's channel dispatch (`sendToChannels`)
   * so a consumer that only cares "an alert just fired" doesn't need to masquerade as a
   * notification channel. Currently consumed by `ingest/haPublisher.ts` (Task 5), which
   * relays it to `<appTopicPrefix>/event/alert`. `title`/`body` are the rule's first
   * `notify` action's rendered title/body when it has one, else `{title: rule.name, body:
   * ''}` -- see engine.ts's `alertTitleBodyOf`. `tapId` is the triggering event's resolved
   * tap (undefined when the trigger has no tap context, e.g. `app_startup`/`schedule`).
   * NOT emitted on resolve (`handleResolve`) -- HA's event topic mirrors "an alert fired",
   * not "an alert resolved"; there was no plan requirement for the latter. */
  alert_fired: {
    ruleId: number; ruleName: string; severity: 'info' | 'warning' | 'critical';
    title: string; body: string; tapId?: number; ts: string;
  };
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
