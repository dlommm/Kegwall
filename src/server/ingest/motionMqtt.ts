import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import type { EventBus } from '../core/events.js';
import type { PresenceRegistry } from '../core/presence.js';
import type { Source } from './source.js';

// ---------------------------------------------------------------------------
// Presence (Plan A Task 6): a `Source` (`motion_mqtt`) that subscribes a set of
// admin-configured MQTT topics (`settings.mqtt.motionTopics`, see db/settings.ts) and
// treats any non-falsy message on one as motion for that topic's wall (`wallSlug: null`
// means "wake every wall", same broadcast convention as `PresenceRegistry.motion()`'s own
// `slug: null` case). Lives in its own module rather than piggybacking on `gen1/
// mqttSource.ts` because it has nothing to do with Kegtron device readings -- it shares
// only the connection config (`settings.mqtt.url`/`username`/`password`), same "one
// broker, several independent MQTT-touching modules" precedent as `haPublisher.ts` and
// `notify/mqttSender.ts`.
//
// `connectFn` is a test seam -- same injected-`mqtt.connect`-override idiom as `notify/
// mqttSender.ts`'s `connectFn` option (tests hand it a fake `EventEmitter` client instead
// of opening a real socket).
// ---------------------------------------------------------------------------

/** A raw MQTT payload string is treated as "motion" unless it's one of a small set of
 * well-known "off"/falsy markers (case-insensitive) -- everything else, including a
 * bare `'1'`/`'true'` or an arbitrary JSON blob (e.g. a Home Assistant occupancy
 * payload), counts as motion. This deliberately errs toward waking the display: a motion
 * sensor's whole job is "did something happen", and a false wake is far cheaper than a
 * missed one. */
const FALSY_MOTION_PAYLOADS = new Set(['', 'off', '0', 'false', 'closed']);

export function isMotionPayload(payload: string): boolean {
  return !FALSY_MOTION_PAYLOADS.has(payload.trim().toLowerCase());
}

export interface MotionMqttSourceOptions {
  url: string;
  username?: string;
  password?: string;
  /** One entry per configured motion topic (`settings.mqtt.motionTopics`).
   * `wallSlug: null` wakes every configured wall. */
  topics: Array<{ topic: string; wallSlug: string | null }>;
  presence: PresenceRegistry;
  bus: EventBus;
  /** Test-only override of `mqtt.connect` -- see header comment. */
  connectFn?: typeof mqtt.connect;
}

export class MotionMqttSource implements Source {
  readonly name = 'motion_mqtt' as const;

  private readonly url: string;
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly topicToWallSlug: Map<string, string | null>;
  private readonly presence: PresenceRegistry;
  private readonly bus: EventBus;
  private readonly connectFn: typeof mqtt.connect;

  private client: MqttClient | null = null;
  private stopped = true;

  constructor(opts: MotionMqttSourceOptions) {
    this.url = opts.url;
    this.username = opts.username;
    this.password = opts.password;
    this.topicToWallSlug = new Map(opts.topics.map((t) => [t.topic, t.wallSlug]));
    this.presence = opts.presence;
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
      for (const topic of this.topicToWallSlug.keys()) client.subscribe(topic);
      this.emitStatus(true, `subscribed to ${this.topicToWallSlug.size} motion topic(s)`);
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
    // wildcard quirk) is silently ignored -- there's no wall to wake it for.
    if (!this.topicToWallSlug.has(topic)) return;
    const wallSlug = this.topicToWallSlug.get(topic)!;
    if (isMotionPayload(payload.toString())) this.presence.motion(wallSlug, 'mqtt');
  }

  private emitStatus(healthy: boolean, detail: string): void {
    this.bus.emit('source_status', { source: 'motion_mqtt', healthy, detail, ts: new Date().toISOString() });
  }
}
