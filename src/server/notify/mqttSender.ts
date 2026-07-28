import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import type { SettingsStore } from '../db/settings.js';
import { withRetry, DEFAULT_TIMEOUT_MS, type RetryOptions } from './retry.js';

// ---------------------------------------------------------------------------
// Standalone sender behind the `mqtt_publish` automation action (`core/automationSchema.
// ts`'s `ActionSchema`: `{type: 'mqtt_publish', topic, payloadTemplate}`, the templated
// payload already rendered by the caller — same "this module doesn't template" division
// of labor as `webhookSender.ts`). Reuses the SAME broker connection config as
// `settings.mqtt` (the one settings key `ingest/gen1/mqttSource.ts` and Task 5's HA
// publisher both also read) — there is no separate "automation MQTT" credential.
//
// "Lazily shared client" (per the plan): connects on the FIRST publish() call, then
// reuses that one connection for every subsequent publish() on this same `MqttSender`
// instance, rather than opening/closing a connection per publish the way a one-shot
// mqtt.connect()-per-call design would. Whether ONE `MqttSender` instance is shared
// process-wide (vs. one per engine/context) is Task 3's wiring decision — this module
// only owns the connect/publish/close mechanics, not where the instance lives.
// ---------------------------------------------------------------------------

export interface MqttSenderOptions extends RetryOptions {
  /** Per-attempt connect timeout (ms). Production default: `DEFAULT_TIMEOUT_MS` (5s),
   * same constant every other Task 2 sender uses. */
  timeoutMs?: number;
  /** Test-only override of `mqtt.connect` — same test-injectable-constructor-knob
   * pattern as `ingest/gen1/mqttSource.ts`'s `reconnectPeriodMs`/`synth`. Narrowed to the
   * one (url, opts) call shape this module actually uses, rather than `typeof
   * mqtt.connect`'s full overload set (which also accepts an opts-only or no-args form
   * this module never calls). */
  connectFn?: (url: string, opts?: IClientOptions) => MqttClient;
}

export class MqttSender {
  private readonly settings: SettingsStore;
  private readonly opts: MqttSenderOptions;

  private client: MqttClient | null = null;
  private connecting: Promise<MqttClient> | null = null;

  constructor(settings: SettingsStore, opts: MqttSenderOptions = {}) {
    this.settings = settings;
    this.opts = opts;
  }

  /**
   * Publishes `payload` to `topic` on the configured broker, connecting first if no live
   * connection exists yet. 5s timeout + 2 retries (100ms/500ms backoff, both
   * test-overridable), then throws — matching every other Task 2 external sender. Throws
   * immediately (no point retrying) when `settings.mqtt` isn't configured at all.
   */
  async publish(topic: string, payload: string): Promise<void> {
    await withRetry(async () => {
      const client = await this.getClient();
      await client.publishAsync(topic, payload);
    }, this.opts);
  }

  /** Ends the underlying connection (if one was ever made) and clears it so a later
   * `publish()` call reconnects from scratch. Idempotent — safe to call multiple times,
   * or on a `MqttSender` that never successfully connected. */
  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.endAsync(true);
  }

  private async getClient(): Promise<MqttClient> {
    if (this.client && this.client.connected) return this.client;
    if (this.connecting) return this.connecting;

    const cfg = this.settings.get('mqtt');
    if (!cfg) throw new Error('mqtt is not configured');

    const connectFn = this.opts.connectFn ?? mqtt.connect;
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const options: IClientOptions = {
      username: cfg.username,
      password: cfg.password,
      connectTimeout: timeoutMs,
      reconnectPeriod: 0, // one-shot per attempt -- withRetry owns the retry loop, not mqtt.js's own reconnect logic
    };

    const attempt = new Promise<MqttClient>((resolvePromise, reject) => {
      const client = connectFn(cfg.url, options);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end(true);
        reject(new Error('mqtt connect timed out'));
      }, timeoutMs);

      client.once('connect', () => {
        if (settled) { client.end(true); return; }
        settled = true;
        clearTimeout(timer);
        this.client = client;
        client.on('close', () => {
          if (this.client === client) this.client = null;
        });
        // A connected client that later errors (e.g. broker restart) must not crash the
        // process — mqtt.js requires an 'error' listener or it throws unhandled.
        client.on('error', () => {});
        resolvePromise(client);
      });

      client.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.end(true);
        reject(err);
      });
    });

    this.connecting = attempt.finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
}
