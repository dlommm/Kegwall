import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import type { EventBus } from '../core/events.js';
import type { MotionSourceRegistry } from '../core/motionSources.js';
import type { MatchRule } from '../db/settings.js';
import type { Source } from './source.js';

// ---------------------------------------------------------------------------
// Presence (Plan A Task 6, reworked by Displays & Presence hub Task 2): a `Source`
// (`motion_mqtt`) that subscribes the topics of every configured mqtt-type
// `MotionSource` (Task 1's `ctx.motion.sources()`, see `ingest/bootstrap.ts`) and, for a
// message on one of them, decides "this counts as motion" via that source's own
// `MatchRule` (`matchesRule` below) rather than the old single hard-coded
// `isMotionPayload` check every topic used to share. A match calls
// `registry.trigger(id)`, which does the actual wall wake + per-source
// lastTriggeredAt bookkeeping (see `core/motionSources.ts`) -- this class no longer
// touches `PresenceRegistry` directly. Lives in its own module rather than piggybacking
// on `gen1/mqttSource.ts` because it has nothing to do with Kegtron device readings --
// it shares only the connection config (`settings.mqtt.url`/`username`/`password`), same
// "one broker, several independent MQTT-touching modules" precedent as `haPublisher.ts`
// and `notify/mqttSender.ts`.
//
// `connectFn` is a test seam -- same injected-`mqtt.connect`-override idiom as `notify/
// mqttSender.ts`'s `connectFn` option (tests hand it a fake `EventEmitter` client instead
// of opening a real socket).
// ---------------------------------------------------------------------------

/** A raw MQTT payload string is treated as "motion" unless it's one of a small set of
 * well-known "off"/falsy markers (case-insensitive) -- everything else, including a
 * bare `'1'`/`'true'` counts as motion. This is the `'any'` mode's implementation (see
 * `matchesRule` below) -- it deliberately errs toward waking the display: a motion
 * sensor's whole job is "did something happen", and a false wake is far cheaper than a
 * missed one. */
const FALSY_MOTION_PAYLOADS = new Set(['', 'off', '0', 'false', 'closed']);

export function isMotionPayload(payload: string): boolean {
  return !FALSY_MOTION_PAYLOADS.has(payload.trim().toLowerCase());
}

/**
 * Decides whether a raw MQTT payload counts as motion under a `MotionSource`'s
 * configured `MatchRule` (`db/settings.ts`):
 *  - `any` -- delegates to `isMotionPayload` (the pre-Task-2 default behavior, still
 *    used by the legacy-migrated sources -- see `core/motionSources.ts`'s
 *    `migrateMotionTopics`).
 *  - `json` -- the payload must parse as JSON, the parsed value must be an object, and
 *    `parsed[field]` must `===` (strict, no type coercion) `equals`. This is the
 *    zigbee2mqtt fix: `{"occupancy":false}` under `{field: 'occupancy', equals: true}`
 *    must NOT match -- under the old `isMotionPayload`, ANY non-empty JSON blob
 *    (including an explicit "no motion" occupancy report) counted as motion.
 *  - `exact` -- the raw payload string must `===` `value`, with no trimming (unlike
 *    `any`'s `isMotionPayload`, which trims).
 */
export function matchesRule(payload: string, rule: MatchRule): boolean {
  switch (rule.mode) {
    case 'any':
      return isMotionPayload(payload);
    case 'exact':
      return payload === rule.value;
    case 'json': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return false;
      }
      if (typeof parsed !== 'object' || parsed === null) return false;
      return (parsed as Record<string, unknown>)[rule.field] === rule.equals;
    }
  }
}

export interface MotionMqttSourceOptions {
  url: string;
  username?: string;
  password?: string;
  /** One entry per configured mqtt-type motion source (`ctx.motion.sources().filter(s
   * => s.type === 'mqtt')`, see `ingest/bootstrap.ts`). `id` is the `MotionSource.id`
   * passed to `registry.trigger()` when `topic`'s payload satisfies `match`. Two
   * sources may legally share the same `topic` (e.g. different match rules deciding
   * different walls wake) -- both are checked independently on every message. */
  sources: Array<{ id: string; topic: string; match: MatchRule }>;
  /** Fires the actual wake + per-source `lastTriggeredAt`/health bookkeeping for a
   * matched source id -- see `core/motionSources.ts`'s `MotionSourceRegistry`. */
  registry: MotionSourceRegistry;
  bus: EventBus;
  /** Test-only override of `mqtt.connect` -- see header comment. */
  connectFn?: typeof mqtt.connect;
}

export class MotionMqttSource implements Source {
  readonly name = 'motion_mqtt' as const;

  private readonly url: string;
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly topicToSources: Map<string, Array<{ id: string; match: MatchRule }>>;
  private readonly registry: MotionSourceRegistry;
  private readonly bus: EventBus;
  private readonly connectFn: typeof mqtt.connect;

  private client: MqttClient | null = null;
  private stopped = true;

  constructor(opts: MotionMqttSourceOptions) {
    this.url = opts.url;
    this.username = opts.username;
    this.password = opts.password;
    this.topicToSources = new Map();
    for (const s of opts.sources) {
      const forTopic = this.topicToSources.get(s.topic) ?? [];
      forTopic.push({ id: s.id, match: s.match });
      this.topicToSources.set(s.topic, forTopic);
    }
    this.registry = opts.registry;
    this.bus = opts.bus;
    this.connectFn = opts.connectFn ?? mqtt.connect;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = null;
    if (client) {
      await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
    }
  }

  private connect(): void {
    const options: IClientOptions = { username: this.username, password: this.password };
    const client = this.connectFn(this.url, options);
    this.client = client;

    client.on('connect', () => {
      if (this.stopped) return;
      for (const topic of this.topicToSources.keys()) client.subscribe(topic);
      this.emitStatus(true, `subscribed to ${this.topicToSources.size} motion topic(s)`);
    });

    client.on('reconnect', () => {
      if (!this.stopped) this.emitStatus(false, 'reconnecting');
    });

    client.on('close', () => {
      if (!this.stopped) this.emitStatus(false, 'connection closed');
    });

    // Never let an unhandled 'error' crash the process -- same precedent as
    // gen1/mqttSource.ts and haPublisher.ts.
    client.on('error', (err) => {
      if (!this.stopped) this.emitStatus(false, `mqtt error: ${err.message}`);
    });

    client.on('message', (topic: string, payload: Buffer) => this.handleMessage(topic, payload));
  }

  private handleMessage(topic: string, payload: Buffer): void {
    if (this.stopped) return;
    // A message on a topic this instance never subscribed to (e.g. a broker-side
    // wildcard quirk) is silently ignored -- there's no source to attribute it to.
    const sources = this.topicToSources.get(topic);
    if (!sources) return;
    const raw = payload.toString();
    for (const { id, match } of sources) {
      if (matchesRule(raw, match)) this.registry.trigger(id);
    }
  }

  /** Emits the aggregate `source_status` bus event (pre-Task-2 behavior, unchanged) AND
   * mirrors the same healthy/detail per-source via `registry.markHealth` for every
   * configured source id (Task 2) -- connect/reconnect/close/error all funnel through
   * here, so both paths always stay in sync. */
  private emitStatus(healthy: boolean, detail: string): void {
    this.bus.emit('source_status', { source: 'motion_mqtt', healthy, detail, ts: new Date().toISOString() });
    for (const sources of this.topicToSources.values()) {
      for (const { id } of sources) this.registry.markHealth(id, healthy, detail);
    }
  }
}
