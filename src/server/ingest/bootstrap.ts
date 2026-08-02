import type { AppContext } from '../context.js';
import type { MotionSource } from '../db/settings.js';
import { reconcileProMonitor, reconcileProMonitorByBleName } from '../db/monitors.js';
import { KegtronCloudSource } from './kegtron/cloudSource.js';
import { KegtronUdpSource } from './kegtron/udpSource.js';
import { KegtronProBleSource } from './kegtron/proBleSource.js';
import { GoveeSource } from './govee/goveeSource.js';
import { Gen1MqttSource } from './gen1/mqttSource.js';
import { Gen1BleSource } from './gen1/bleSource.js';
import { PourSynthesizer } from './gen1/pourSynth.js';
import { BleScanner } from './ble/scanner.js';
import { HaPublisherSource } from './haPublisher.js';
import { MotionMqttSource } from './motionMqtt.js';
import { GpioMotionSource } from './gpioMotion.js';

// ---------------------------------------------------------------------------
// Task 8: wires the four ingest sources (Tasks 4/6/7) into a single `SourceManager`
// (Task 1's `manager.ts`) driven entirely by `settings` — this is the ONLY place in the
// app that decides which sources exist for the current configuration. Called from two
// places:
//   1. `context.ts`'s `createContext()` — every app build registers whatever the
//      current settings call for (but does NOT start them; see `app.ts`'s
//      `startSources` option / `index.ts` for that).
//   2. `routes/crud.ts`'s settings PATCH handler — when a source-relevant setting
//      changes on a LIVE app, the whole registered-source set is torn down and rebuilt
//      from the new settings (see that file for the `isStarted()` gate that keeps this
//      inert in tests that never start sources in the first place).
//
// Always calls `ctx.sources.reset()` first, so this function is idempotent/rebuildable
// from scratch on every call — a source whose config was just removed (e.g. `mqtt`
// cleared) is simply not re-registered, rather than lingering as a stale, already-
// stopped instance (see `manager.ts`'s `reset()` doc comment).
// ---------------------------------------------------------------------------

export function registerConfiguredSources(ctx: AppContext): void {
  ctx.sources.reset();
  const settings = ctx.settings.all();

  // Cloud always registers — KegtronCloudSource.start() self-skips (no network call at
  // all) when `kegtronApiKey` isn't set, per its own "no API key configured" branch, so
  // registering it unconditionally is safe even for a totally unconfigured install.
  ctx.sources.register(new KegtronCloudSource({ bus: ctx.bus, settings: ctx.settings }));

  // Govee ambient sensors (Phase 6) — same always-register/self-skip idiom as cloud.
  // The sensorMonitor callback is read PER POLL (not at construction), so a sensor
  // enabled/disabled in the admin takes effect on the next poll without a restart.
  ctx.sources.register(new GoveeSource({
    bus: ctx.bus,
    settings: ctx.settings,
    sensorMonitor: (identifier) => {
      const r = ctx.db.prepare(
        `SELECT enabled, name FROM monitors
          WHERE type = 'govee_sensor' AND identifier = ? AND port_index = 0`,
      ).get(identifier) as { enabled: number; name: string | null } | undefined;
      return r ? { enabled: !!r.enabled, name: r.name } : null;
    },
  }));

  const isCloudHealthy = (): boolean =>
    ctx.sources.status().find((s) => s.name === 'kegtron_cloud')?.healthy ?? false;

  if (settings.udpEnabled) {
    ctx.sources.register(new KegtronUdpSource({
      bus: ctx.bus,
      settings: ctx.settings,
      isCloudHealthy,
      // Monitor identity reconciliation (Task 8 HARD REQUIREMENT, see monitors.ts's
      // reconcileProMonitor doc comment) — lands UDP events on the same monitor row
      // cloud discovery already created whenever the serial matches, so PourDeduper
      // (Task 5) can actually collapse a duplicate cloud/UDP report of the same pour.
      reconcile: (serialNum, portIndex) => reconcileProMonitor(ctx.db, serialNum, portIndex),
    }));
  }

  // Gen 1's two transports (MQTT bridge / direct BLE) share ONE MAC-dedupe Map (mac ->
  // last-BLE-seen ms; Final review I1) — see mqttSource.ts's "BLE/MQTT DEDUPE" header
  // comment — for the whole lifetime of this registration pass. Always constructed
  // (even if only one or neither Gen 1 source ends up registered) since it's just an
  // empty Map otherwise; cheap either way.
  const bleActiveMacs = new Map<string, number>();

  // A shared PourSynthesizer is only actually needed when BOTH Gen 1 transports are
  // live at once — that's the "handoff" scenario the shared instance exists for (a
  // MAC's pour baseline surviving BLE dropping out and the MQTT bridge picking the
  // same MAC back up, or vice versa; see pourSynth.ts's + both sources' header
  // comments). Neither source disposes an externally-supplied synth on its own stop()
  // (see their `ownsSynth` logic), so it's only handed to both when both are actually
  // being constructed here — when only one is configured, that source instead gets its
  // own default (private, self-disposing) instance by simply omitting `synth`.
  const bothGen1Enabled = Boolean(settings.mqtt) && settings.bleDirectEnabled;
  const sharedSynth = bothGen1Enabled ? new PourSynthesizer(ctx.bus) : undefined;

  if (settings.mqtt) {
    ctx.sources.register(new Gen1MqttSource({
      bus: ctx.bus, settings: ctx.settings, bleActiveMacs, synth: sharedSynth,
    }));
  }

  // BOTH BLE sources (Gen 1 direct + Pro adverts) must share ONE noble scanner —
  // noble is a process-wide singleton, and independent lifecycles meant one source's
  // stop() could strip the other's discover listener (see ble/scanner.ts's header).
  // Constructed only when at least one BLE source is enabled; refcounted acquire/
  // release inside the sources handles actual scan start/stop.
  const bleScanner = (settings.bleDirectEnabled || settings.proBleEnabled)
    ? new BleScanner() : undefined;

  if (settings.bleDirectEnabled) {
    ctx.sources.register(new Gen1BleSource({
      bus: ctx.bus, settings: ctx.settings, bleActiveMacs, synth: sharedSynth, scanner: bleScanner,
    }));
  }

  if (settings.proBleEnabled) {
    ctx.sources.register(new KegtronProBleSource({
      bus: ctx.bus,
      settings: ctx.settings,
      scanner: bleScanner,
      // Same monitor-identity reconciliation story as UDP's `reconcile` above, except
      // the BLE advert has no serial — only the local name's serial-tail suffix (see
      // db/monitors.ts's reconcileProMonitorByBleName).
      reconcile: (nameSuffix, portIndex) => reconcileProMonitorByBleName(ctx.db, nameSuffix, portIndex),
    }));
  }

  // Phase 5 Task 5: the Home Assistant MQTT discovery publisher. Gated specifically on
  // `haPublishEnabled` -- NOT merely `settings.mqtt` being set like `gen1_mqtt` above -- a
  // site can run the Gen 1 MQTT bridge without wanting HA discovery traffic on the same
  // broker. `HaPublisherSource.start()` independently re-checks the same condition (same
  // defense-in-depth precedent as `gen1_mqtt`'s own `!cfg` check in its `start()`), but
  // gating registration here too means an unconfigured install's `status()` correctly
  // reports `mqtt_publisher: {registered: false}` rather than `{registered: true, healthy:
  // false}` for a source nobody asked for.
  if (settings.mqtt?.haPublishEnabled) {
    ctx.sources.register(new HaPublisherSource({
      bus: ctx.bus, settings: ctx.settings, db: ctx.db, state: ctx.state,
    }));
  }

  // Presence (Plan A Task 6, reworked by Displays & Presence hub Task 2): the
  // motion-sensor MQTT subscriber, now driven by the motion-source registry's own
  // mqtt-type entries (Task 1's `ctx.motion.sources()`) rather than the removed
  // `mqtt.motionTopics`. Same "gated on its own condition, not merely `settings.mqtt`
  // being set" precedent as `mqtt_publisher` just above -- a site can run the Gen 1
  // MQTT bridge (or HA discovery) without configuring any motion sources at all, and an
  // unconfigured install's `status()` should report `motion_mqtt: {registered: false}`
  // rather than a registered-but-inert source. `config.topic`/`config.match` are
  // guaranteed present for every mqtt-type entry by `motionSourceSchema`'s `superRefine`
  // (see db/settings.ts), so the non-null assertions below are schema-backed, not a
  // runtime gamble.
  const mqttMotionSources = ctx.motion.sources()
    .filter((s) => s.type === 'mqtt')
    .map((s) => ({ id: s.id, topic: s.config.topic!, match: s.config.match! }));
  if (mqttMotionSources.length > 0 && settings.mqtt) {
    ctx.sources.register(new MotionMqttSource({
      url: settings.mqtt.url, username: settings.mqtt.username, password: settings.mqtt.password,
      sources: mqttMotionSources, registry: ctx.motion, bus: ctx.bus,
    }));
  }

  // Task 6, same "gated on its own condition, registry-driven" precedent as `motion_mqtt`
  // just above: registers only when at least one enabled gpio-type motion source exists,
  // so an install with none configured reports `motion_gpio: {registered: false}` rather
  // than a registered-but-inert transport. Defaulting itself (chip/activeLow/debounceMs)
  // lives in `resolveGpioSources` below -- see its own doc comment.
  const gpioMotionSources = resolveGpioSources(ctx.motion.sources());
  if (gpioMotionSources.length > 0) {
    ctx.sources.register(new GpioMotionSource({
      sources: gpioMotionSources, registry: ctx.motion, bus: ctx.bus,
    }));
  }
}

/**
 * Task 1 adjudication (ledgered, carried into Task 6 as a binding requirement): the
 * schema (`db/settings.ts`'s `motionSourceSchema`) deliberately leaves
 * `config.chip`/`activeLow`/`debounceMs` bare-optional -- THIS is the one place those
 * documented defaults (`chip` 'gpiochip0', `activeLow` false, `debounceMs` 2000) get
 * applied, so `GpioMotionSource` itself only ever sees fully-resolved values (its
 * constructor's own contract, see gpioMotion.ts). Fix-round-1 review finding: extracted
 * out of `registerConfiguredSources` into its own exported pure function specifically so
 * the DEFAULTING is directly unit-testable (feed it a `MotionSource[]` literal, assert
 * the resolved shape) without needing a whole `AppContext`/`registerConfiguredSources`
 * round-trip to prove the defaults landed. `config.line` is guaranteed present for
 * every gpio-type entry by `motionSourceSchema`'s `superRefine`, so the non-null
 * assertion below is schema-backed, same as `mqttMotionSources.topic`/`match` above.
 */
export function resolveGpioSources(
  sources: MotionSource[],
): Array<{ id: string; chip: string; line: number; activeLow: boolean; debounceMs: number }> {
  return sources
    .filter((s) => s.type === 'gpio')
    .map((s) => ({
      id: s.id,
      chip: s.config.chip ?? 'gpiochip0',
      line: s.config.line!,
      activeLow: s.config.activeLow ?? false,
      debounceMs: s.config.debounceMs ?? 2000,
    }));
}

/**
 * Task 3 finding, folded here by Task 6 (reviewer-endorsed extraction site): the exact
 * stop/reconfigure/start cycle that BOTH `routes/crud.ts`'s settings-PATCH handler (when
 * a `SOURCE_RESTART_KEYS` field changes) and `routes/presence.ts`'s motion-source
 * CRUD routes (create/patch/delete) need after writing a source-relevant settings
 * change to a LIVE app -- previously duplicated verbatim in both files. `isStarted()` is
 * false in every test that builds the app with the default `startSources: false` and
 * never manually starts sources, so an incidental settings/source write there never
 * spins up a real transport against a live device/broker/API. In production this is
 * always true by the time an authenticated request can reach either call site
 * (`index.ts` always passes `startSources: true`). See task-8-report.md "Deviations"
 * (crud.ts's original rationale, unchanged by this extraction).
 */
export async function restartSourcesIfLive(ctx: AppContext): Promise<void> {
  if (!ctx.sources.isStarted()) return;
  await ctx.sources.stopAll();
  registerConfiguredSources(ctx);
  await ctx.sources.startAll();
}
