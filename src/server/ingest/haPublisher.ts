import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import type Database from 'better-sqlite3';
import type { EventBus, EventMap } from '../core/events.js';
import type { TapState } from '../core/state.js';
import type { Settings, SettingsStore } from '../db/settings.js';
import { listMonitors, resolveTapForRef, type Monitor } from '../db/monitors.js';
import { latestTelemetryForMonitor } from '../db/telemetry.js';
import type { Source } from './source.js';

// ---------------------------------------------------------------------------
// Phase 5 Task 5: Home Assistant MQTT discovery publisher. A `Source` (`mqtt_publisher`)
// like every other ingest source, but it runs in the OPPOSITE direction -- it doesn't
// feed the bus, it PUBLISHES the bus's derived state (`StateManager.getTapStates()`) and
// selected bus events out to an MQTT broker in Home Assistant's documented MQTT discovery
// format (https://www.home-assistant.io/integrations/mqtt/#discovery-messages), so HA can
// auto-create entities for every tap and Kegtron Pro monitor with zero YAML.
//
// Own client, NOT `ingest/gen1/mqttSource.ts`'s subscriber -- that source reads Gen 1
// device readings FROM a broker; this one WRITES discovery/state/event topics TO a
// (possibly the same) broker. Reuses the same `settings.mqtt` connection config (url/
// username/password) as every other MQTT-touching module in this app (Gen1MqttSource,
// MqttSender, the engine's `mqtt_publish` action) -- there is no separate "HA" broker
// credential -- but only actually connects when `settings.mqtt.haPublishEnabled` is true
// (gen1_mqtt precedent: `!cfg` -> unhealthy 'not configured', clean return; here the
// analogous precondition is `!cfg?.haPublishEnabled`).
//
// DESIGN DECISIONS the task brief left open (documented here, flagged for the coordinator
// like every prior task's open points):
//
// 1. Discovery topic shape: `{haDiscoveryPrefix}/{component}/kegtron_tap_{tapId}/{object}/
//    config` per tap, `{haDiscoveryPrefix}/{component}/kegtron_monitor_{monitorId}/
//    {object}/config` per Pro monitor -- the `node_id` segment IS the stable per-entity-
//    group id HA's discovery format documents, and is also reused as the `device.
//    identifiers` value so every entity for the same tap/monitor groups under one HA
//    device ("Tap N" / "Kegtron Pro {identifier}").
// 2. One JSON state topic per tap (`{appTopicPrefix}/tap/{tapId}/state`) and per monitor
//    (`{appTopicPrefix}/monitor/{monitorId}/state`), with each entity's discovery config
//    pointing `state_topic` at it plus a `value_template` picking out its own field --
//    this is HA's own documented pattern for "several sensors, one MQTT message" and
//    keeps the publish side to one message per tap/monitor per cycle instead of five.
//    Retained (`retain: true`) like Tasmota/ESPHome's own MQTT integrations do, so a
//    restarted/newly-subscribing HA instance sees the last known value immediately
//    instead of "Unknown" until the next bus event.
// 3. Units: level is unitless-`%`; remaining is LITERS (`remaining_l`, matches the task
//    brief's literal "remaining L"); last pour is MILLILITERS (`last_pour_ml`) -- a single
//    serving is small enough that mL is the more legible unit and the brief didn't specify
//    one for it (both are valid HA `device_class: volume` units).
// 4. Debounce (`state_changed` scope `taps` -> republish): "1s trailing edge" is
//    implemented as a coalescing window, not a timer-resetting debounce -- the FIRST
//    `state_changed` event after an idle period starts a `debounceMs` timer; further
//    events before it fires are coalesced into that same cycle (no reset). A
//    timer-resetting debounce would let a steady stream of `state_changed` (e.g.
//    `pour_progress` firing every sample during an active pour) postpone the publish
//    indefinitely -- undesirable for a live "pouring" sensor. This still satisfies "at
//    most one publish per second" while guaranteeing progress is published at least that
//    often.
// 5. Discovery re-publish signature: a JSON snapshot of `{tapId, beerId, beerName}` per
//    tap + `{monitorId, tapId, identifier}` per bound Pro monitor. Any add/remove/rebind
//    of a tap, keg-swap (new beer id), or monitor bind/unbind changes the signature and
//    re-publishes every discovery config for the affected type; per-cycle STATE always
//    publishes regardless (so editing an existing beer's style/abv/brewery in place -- no
//    new beer row -- still reaches HA via the state topic's `json_attributes_template`
//    without needing a discovery re-publish).
// 6. `alert_fired`/`pour_completed` event relay topics are explicitly NON-retained (task
//    brief) -- they're point-in-time notifications, not current state; a client
//    subscribing later must not replay a stale one.
// ---------------------------------------------------------------------------

const DEFAULT_DEBOUNCE_MS = 1000;

export interface HaPublisherOptions {
  bus: EventBus;
  settings: SettingsStore;
  db: Database.Database;
  /** Narrowed to the one method this source needs -- production passes the real
   * `StateManager`; tests can pass anything structurally compatible (same pattern as
   * `automation/engine.ts`'s `EngineDeps.state`). */
  state: { getTapStates(): TapState[] };
  /** Trailing-edge coalescing window (ms) for `state_changed` -> republish (see header
   * comment, point 4). Production default 1000ms; test-only override. */
  debounceMs?: number;
}

type MqttConfig = NonNullable<Settings['mqtt']>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface DiscoveryConfig {
  name: string;
  unique_id: string;
  state_topic: string;
  value_template: string;
  device: { identifiers: string[]; name: string; manufacturer: string; model: string };
  availability: [{ topic: string }];
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  json_attributes_topic?: string;
  json_attributes_template?: string;
}

function tapNodeId(tapId: number): string {
  return `kegtron_tap_${tapId}`;
}

function monitorNodeId(monitorId: number): string {
  return `kegtron_monitor_${monitorId}`;
}

function tapStateTopic(cfg: MqttConfig, tapId: number): string {
  return `${cfg.appTopicPrefix}/tap/${tapId}/state`;
}

function monitorStateTopic(cfg: MqttConfig, monitorId: number): string {
  return `${cfg.appTopicPrefix}/monitor/${monitorId}/state`;
}

function availabilityTopic(cfg: MqttConfig): string {
  return `${cfg.appTopicPrefix}/availability`;
}

/** Builds this tap's five discovery configs, keyed by HA component/object_id pair --
 * `{sensor: {level, remaining, beer, last_pour}, binary_sensor: {pouring}}`. */
function buildTapDiscoveryConfigs(
  cfg: MqttConfig, tap: TapState,
): { component: 'sensor' | 'binary_sensor'; objectId: string; config: DiscoveryConfig }[] {
  const nodeId = tapNodeId(tap.tapId);
  const stateTopic = tapStateTopic(cfg, tap.tapId);
  const device = {
    identifiers: [nodeId], name: `Tap ${tap.tapNumber}`,
    manufacturer: 'Kegtron Dashboard', model: 'Tap',
  };
  const availability: [{ topic: string }] = [{ topic: availabilityTopic(cfg) }];

  return [
    {
      component: 'sensor', objectId: 'level',
      config: {
        name: 'Level', unique_id: `${nodeId}_level`, state_topic: stateTopic,
        value_template: '{{ value_json.level_pct }}', unit_of_measurement: '%',
        state_class: 'measurement', device, availability,
      },
    },
    {
      component: 'sensor', objectId: 'remaining',
      config: {
        name: 'Remaining', unique_id: `${nodeId}_remaining`, state_topic: stateTopic,
        value_template: '{{ value_json.remaining_l }}', unit_of_measurement: 'L',
        device_class: 'volume', state_class: 'measurement', device, availability,
      },
    },
    {
      component: 'sensor', objectId: 'beer',
      config: {
        name: 'Beer', unique_id: `${nodeId}_beer`, state_topic: stateTopic,
        value_template: '{{ value_json.beer_name }}',
        json_attributes_topic: stateTopic,
        json_attributes_template:
          '{{ {"style": value_json.beer_style, "abv": value_json.beer_abv, "brewery": value_json.beer_brewery} | tojson }}',
        device, availability,
      },
    },
    {
      component: 'sensor', objectId: 'last_pour',
      config: {
        name: 'Last pour', unique_id: `${nodeId}_last_pour`, state_topic: stateTopic,
        value_template: '{{ value_json.last_pour_ml }}', unit_of_measurement: 'mL',
        device_class: 'volume', state_class: 'measurement', device, availability,
      },
    },
    {
      component: 'binary_sensor', objectId: 'pouring',
      config: {
        name: 'Pouring', unique_id: `${nodeId}_pouring`, state_topic: stateTopic,
        value_template: "{{ 'ON' if value_json.pouring else 'OFF' }}",
        device, availability,
      },
    },
  ];
}

/** Builds this Kegtron Pro monitor's two discovery configs (temp + humidity). */
function buildMonitorDiscoveryConfigs(
  cfg: MqttConfig, monitor: Monitor,
): { component: 'sensor'; objectId: string; config: DiscoveryConfig }[] {
  const nodeId = monitorNodeId(monitor.id);
  const stateTopic = monitorStateTopic(cfg, monitor.id);
  const device = {
    identifiers: [nodeId], name: `Kegtron Pro ${monitor.identifier}`,
    manufacturer: 'Kegtron', model: 'Pro',
  };
  const availability: [{ topic: string }] = [{ topic: availabilityTopic(cfg) }];

  return [
    {
      component: 'sensor', objectId: 'temp',
      config: {
        name: 'Temperature', unique_id: `${nodeId}_temp`, state_topic: stateTopic,
        value_template: '{{ value_json.temp_c }}', device_class: 'temperature',
        unit_of_measurement: '°C', state_class: 'measurement', device, availability,
      },
    },
    {
      component: 'sensor', objectId: 'humidity',
      config: {
        name: 'Humidity', unique_id: `${nodeId}_humidity`, state_topic: stateTopic,
        value_template: '{{ value_json.humidity_pct }}', device_class: 'humidity',
        unit_of_measurement: '%', state_class: 'measurement', device, availability,
      },
    },
  ];
}

function discoveryTopic(cfg: MqttConfig, component: string, nodeId: string, objectId: string): string {
  return `${cfg.haDiscoveryPrefix}/${component}/${nodeId}/${objectId}/config`;
}

/** Bound Kegtron Pro monitors only -- an unbound monitor has no tap to attach its device
 * card to in the admin UI, and (more importantly here) HA discovery entities for a
 * monitor nobody's tap ever resolves would be orphaned/meaningless. */
function boundProMonitors(db: Database.Database): Monitor[] {
  return listMonitors(db).filter((m) => m.type === 'kegtron_pro' && m.tapId !== null);
}

/** Signature used to decide whether discovery configs need republishing this cycle -- see
 * header comment, point 5. */
function discoverySignature(tapStates: TapState[], monitors: Monitor[]): string {
  return JSON.stringify({
    taps: tapStates.map((t) => ({ id: t.tapId, beerId: t.beer?.id ?? null, beerName: t.beer?.name ?? null })),
    monitors: monitors.map((m) => ({ id: m.id, tapId: m.tapId, identifier: m.identifier })),
  });
}

export class HaPublisherSource implements Source {
  readonly name = 'mqtt_publisher' as const;

  private readonly bus: EventBus;
  private readonly settings: SettingsStore;
  private readonly db: Database.Database;
  private readonly state: { getTapStates(): TapState[] };
  private readonly debounceMs: number;

  private client: MqttClient | null = null;
  private cfg: MqttConfig | null = null;
  private stopped = true;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: Array<() => void> = [];
  private lastDiscoverySignature: string | null = null;

  constructor(opts: HaPublisherOptions) {
    this.bus = opts.bus;
    this.settings = opts.settings;
    this.db = opts.db;
    this.state = opts.state;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const cfg = this.settings.get('mqtt');
    if (!cfg?.haPublishEnabled) {
      this.emitStatus(false, 'not configured');
      return;
    }
    this.cfg = cfg;
    this.subscribeBus();
    this.connect(cfg);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.lastDiscoverySignature = null;

    const client = this.client;
    const cfg = this.cfg;
    this.client = null;
    this.cfg = null;
    if (!client) return;

    if (client.connected && cfg) {
      // Deliberately `end(false, ...)` here -- NOT the `end(true, ...)` force-end every
      // other MQTT-touching module in this app uses (gen1/mqttSource.ts, notify/
      // mqttSender.ts). Those never configure a `will`, so it doesn't matter; this source
      // does. mqtt.js's `force: true` skips the clean DISCONNECT packet and just destroys
      // the transport (see client.js's `_cleanUp`), which is indistinguishable from a
      // crash to the broker -- it would fire the Will (a SECOND, redundant 'offline'
      // publish) right on top of the graceful one just published two lines up. A graceful
      // `end(false, ...)` sends DISCONNECT first, which makes the broker discard the Will
      // per the MQTT spec, so only the one explicit publish above happens.
      await new Promise<void>((resolve) => {
        client.publish(availabilityTopic(cfg), 'offline', { qos: 1, retain: true }, () => {
          client.end(false, {}, () => resolve());
        });
      });
    } else {
      await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
    }
  }

  private connect(cfg: MqttConfig): void {
    const availTopic = availabilityTopic(cfg);
    const options: IClientOptions = {
      username: cfg.username,
      password: cfg.password,
      will: { topic: availTopic, payload: 'offline', qos: 1, retain: true },
    };
    const client = mqtt.connect(cfg.url, options);
    this.client = client;

    client.on('connect', () => {
      if (this.stopped) return;
      client.publish(availTopic, 'online', { qos: 1, retain: true });
      this.publishCycle(cfg);
      this.emitStatus(true, 'connected');
    });

    client.on('reconnect', () => {
      if (!this.stopped) this.emitStatus(false, 'reconnecting');
    });

    client.on('close', () => {
      if (!this.stopped) this.emitStatus(false, 'connection closed');
    });

    // Never let an unhandled 'error' crash the process -- same precedent as
    // gen1/mqttSource.ts and notify/mqttSender.ts.
    client.on('error', (err) => {
      if (!this.stopped) this.emitStatus(false, `mqtt error: ${err.message}`);
    });
  }

  private subscribeBus(): void {
    this.unsubs.push(this.bus.on('state_changed', (e) => {
      if (e.scope !== 'taps') return;
      this.scheduleStatePublish();
    }));
    this.unsubs.push(this.bus.on('pour_completed', (e) => this.relayPour(e)));
    this.unsubs.push(this.bus.on('alert_fired', (e) => this.relayAlert(e)));
  }

  /** Trailing-edge coalescing window -- see header comment, point 4. */
  private scheduleStatePublish(): void {
    if (this.debounceTimer) return; // a cycle is already pending -- this event rides along
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.cfg || !this.client?.connected) return;
      this.publishCycle(this.cfg);
    }, this.debounceMs);
  }

  private publishCycle(cfg: MqttConfig): void {
    if (!this.client?.connected) return;
    const tapStates = this.state.getTapStates();
    const monitors = boundProMonitors(this.db);

    const sig = discoverySignature(tapStates, monitors);
    if (sig !== this.lastDiscoverySignature) {
      this.publishDiscovery(cfg, tapStates, monitors);
      this.lastDiscoverySignature = sig;
    }
    this.publishState(cfg, tapStates, monitors);
  }

  private publishDiscovery(cfg: MqttConfig, tapStates: TapState[], monitors: Monitor[]): void {
    const client = this.client!;
    for (const tap of tapStates) {
      for (const { component, objectId, config } of buildTapDiscoveryConfigs(cfg, tap)) {
        client.publish(
          discoveryTopic(cfg, component, tapNodeId(tap.tapId), objectId),
          JSON.stringify(config), { retain: true, qos: 1 },
        );
      }
    }
    for (const monitor of monitors) {
      for (const { component, objectId, config } of buildMonitorDiscoveryConfigs(cfg, monitor)) {
        client.publish(
          discoveryTopic(cfg, component, monitorNodeId(monitor.id), objectId),
          JSON.stringify(config), { retain: true, qos: 1 },
        );
      }
    }
  }

  private publishState(cfg: MqttConfig, tapStates: TapState[], monitors: Monitor[]): void {
    const client = this.client!;
    for (const tap of tapStates) {
      const payload = {
        level_pct: tap.keg?.levelPct ?? null,
        remaining_l: tap.keg ? round2(tap.keg.remainingMl / 1000) : null,
        beer_name: tap.beer?.name ?? null,
        beer_style: tap.beer?.style ?? null,
        beer_abv: tap.beer?.abv ?? null,
        beer_brewery: tap.beer?.brewery ?? null,
        last_pour_ml: tap.lastPour?.volumeMl ?? null,
        pouring: tap.pouring,
      };
      client.publish(tapStateTopic(cfg, tap.tapId), JSON.stringify(payload), { retain: true, qos: 0 });
    }
    for (const monitor of monitors) {
      const telemetry = latestTelemetryForMonitor(this.db, monitor.id);
      const payload = { temp_c: telemetry?.temp ?? null, humidity_pct: telemetry?.humidity ?? null };
      client.publish(monitorStateTopic(cfg, monitor.id), JSON.stringify(payload), { retain: true, qos: 0 });
    }
  }

  private relayPour(e: EventMap['pour_completed']): void {
    if (!this.cfg || !this.client?.connected) return;
    const tapId = resolveTapForRef(this.db, e.monitor);
    const tapState = tapId !== null ? this.state.getTapStates().find((t) => t.tapId === tapId) ?? null : null;
    const payload = {
      tap: tapState?.tapNumber ?? null, beer: tapState?.beer?.name ?? null,
      volumeMl: e.volumeMl, ts: e.ts,
    };
    this.client.publish(`${this.cfg.appTopicPrefix}/event/pour`, JSON.stringify(payload));
  }

  private relayAlert(e: EventMap['alert_fired']): void {
    if (!this.cfg || !this.client?.connected) return;
    const payload = { rule: e.ruleName, severity: e.severity, title: e.title, tapId: e.tapId ?? null, ts: e.ts };
    this.client.publish(`${this.cfg.appTopicPrefix}/event/alert`, JSON.stringify(payload));
  }

  private emitStatus(healthy: boolean, detail: string): void {
    this.bus.emit('source_status', { source: 'mqtt_publisher', healthy, detail, ts: new Date().toISOString() });
  }
}
