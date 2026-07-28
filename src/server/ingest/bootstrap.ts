import type { AppContext } from '../context.js';
import { reconcileProMonitor } from '../db/monitors.js';
import { KegtronCloudSource } from './kegtron/cloudSource.js';
import { KegtronUdpSource } from './kegtron/udpSource.js';
import { Gen1MqttSource } from './gen1/mqttSource.js';
import { Gen1BleSource } from './gen1/bleSource.js';
import { PourSynthesizer } from './gen1/pourSynth.js';

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

  if (settings.bleDirectEnabled) {
    ctx.sources.register(new Gen1BleSource({
      bus: ctx.bus, settings: ctx.settings, bleActiveMacs, synth: sharedSynth,
    }));
  }
}
