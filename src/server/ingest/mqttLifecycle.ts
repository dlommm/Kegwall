import type { MqttClient } from 'mqtt';
import type { EventBus } from '../core/events.js';
import type { SourceName } from './source.js';

// ---------------------------------------------------------------------------
// Shared MQTT client lifecycle scaffolding — the connect-guard + reconnect/close/
// 'error'-swallow handler block that gen1/mqttSource.ts, motionMqtt.ts, and
// haPublisher.ts each carried verbatim, extracted here (dedupe pass; behavior
// preserved exactly — the three copies had NOT drifted, down to the detail strings).
//
// Everything genuinely caller-specific deliberately STAYS in the caller:
//  - connection options: haPublisher's `will`, gen1's `reconnectPeriod` test knob,
//    motionMqtt's injected-`mqtt.connect` `connectFn` seam;
//  - the 'connect' handler BODY (subscribe vs. availability-publish + publish cycle);
//  - 'message' handlers (haPublisher subscribes nothing and has none);
//  - stop() disposal — haPublisher's graceful, Will-avoiding `end(false, ...)` vs. the
//    others' force `end(true, ...)` (see haPublisher.ts's stop() for why that split
//    is load-bearing, not boilerplate).
//
// notify/mqttSender.ts (a different module tree, not an ingest Source) keeps its own
// copy of the 'error' swallow — the comments below were previously cited across files
// as "same precedent as gen1/mqttSource.ts"; this helper is now that precedent's home
// for the ingest sources.
// ---------------------------------------------------------------------------

export interface MqttLifecycleHooks {
  /** The owning source's `stopped` flag — read (not captured) so late events after
   * stop() are suppressed exactly as each source's inline handlers did. */
  isStopped: () => boolean;
  /** The owning source's own `emitStatus` (they differ only in source name and
   * per-source mirroring, e.g. motionMqtt.ts's `registry.markHealth` fan-out). */
  emitStatus: (healthy: boolean, detail: string) => void;
  /** Runs on every 'connect' (initial + each successful reconnect), only while the
   * owning source hasn't stopped — the caller-specific body (subscribe / publish). */
  onConnect: () => void;
}

/** Attaches the shared connect/reconnect/close/error handlers to a freshly-created
 * client. Call once per `mqtt.connect()`; 'message' handlers (if any) are attached by
 * the caller alongside. */
export function attachMqttLifecycle(client: MqttClient, hooks: MqttLifecycleHooks): void {
  client.on('connect', () => {
    if (hooks.isStopped()) return;
    hooks.onConnect();
  });

  client.on('reconnect', () => {
    if (!hooks.isStopped()) hooks.emitStatus(false, 'reconnecting');
  });

  client.on('close', () => {
    if (!hooks.isStopped()) hooks.emitStatus(false, 'connection closed');
  });

  // Never let an unhandled 'error' crash the process -- a broken broker/network marks
  // the source unhealthy; mqtt.js manages its own reconnect loop underneath.
  client.on('error', (err) => {
    if (!hooks.isStopped()) hooks.emitStatus(false, `mqtt error: ${err.message}`);
  });
}

/** The one-line `source_status` bus emit every ingest source's private `emitStatus`
 * bottoms out in — shared so the event shape (fresh ISO `ts` per emit) can't drift
 * between the MQTT sources. Callers with extra per-source mirroring (motionMqtt.ts's
 * `registry.markHealth`) layer it on around this. */
export function emitSourceStatus(
  bus: EventBus, source: SourceName, healthy: boolean, detail: string,
): void {
  bus.emit('source_status', { source, healthy, detail, ts: new Date().toISOString() });
}
