import type Database from 'better-sqlite3';
import {
  type EventBus, type EventMap, type MonitorRef, type PowerState, monitorRefKey,
} from '../core/events.js';
import type { TapState } from '../core/state.js';
import type {
  AutomationRule, Trigger, Action,
} from '../core/automationSchema.js';
import { listAutomations, touchLastFired } from '../db/automations.js';
import type { SettingsStore } from '../db/settings.js';
import type { NotificationSeverity } from '../db/notificationsRepo.js';
import {
  getActiveKegForTap, getKeg, computeLevelPct, computeRemainingMl,
} from '../db/kegs.js';
import { getBeer } from '../db/beers.js';
import { getTap } from '../db/taps.js';
import { resolveTapForRef, listMonitors, groupMonitorsByDevice, deviceAnchorPort } from '../db/monitors.js';
import { renderTemplate, type TemplateContext } from '../notify/template.js';
import { InAppChannel } from '../notify/channels/inApp.js';
import {
  buildAlertChannel, ALERT_CHANNEL_NAMES, type AlertChannelName, type Channel,
} from '../notify/channels/index.js';
import { sendWebhook } from '../notify/webhookSender.js';
import { MqttSender } from '../notify/mqttSender.js';
import { MdashClient } from '../ingest/kegtron/mdashClient.js';
import { assertPublicHost, type HostResolver } from '../core/ssrfGuard.js';
import {
  evaluateConditions, crossed, opposite, isWithinTimeWindow, type ConditionEvalCtx,
} from './conditions.js';

// ---------------------------------------------------------------------------
// Phase 5 Task 3: the automation rule engine. Subscribes to the event bus, matches
// enabled rules' triggers, evaluates their AND-ed conditions, and dispatches their
// actions in order through Task 2's channel senders. Alerts (`isAlert: true`) layer
// active/resolved state, cooldown, and quiet-hours on top of the same match/dispatch
// pipeline every other rule uses.
//
// DESIGN DECISIONS the plan left open (documented here + inline; flagged for the
// coordinator like every prior task's open points):
//
// 1. `min_interval` (a condition, DB-column-backed, per-RULE) vs `alertConfig.
//    cooldownMinutes` (alert-only, engine-memory, per-(RULE, ENTITY)) are deliberately
//    NOT the same mechanism, resolving the Task 1 report's flagged overlap concern:
//    `min_interval` reads `automations.last_fired_at` (one timestamp for the whole rule,
//    touched on EVERY fire regardless of isAlert) via the `min_interval` condition, same
//    as any other AND-ed condition. `cooldownMinutes` is tracked in `this.alertState`,
//    keyed per (ruleId, entityKey) -- so rule "keg low" firing for tap 1 doesn't put tap
//    2's instance of the SAME rule on cooldown. Both can be configured on the same rule
//    (both must then pass) with no conflict -- they answer different questions ("has
//    this exact rule fired recently AT ALL" vs "has THIS entity's alert fired recently").
//    `cooldownMinutes` gates on time-since-last-FIRE regardless of the entity's current
//    active/resolved state (Task 3 review Fix round 1) -- an oscillating signal that
//    auto-resolves between crossings is still capped at one fire per cooldown window,
//    not one fire per crossing; see `considerFire`'s doc comment.
// 2. Entity key (`entityKeyFor`): `tap:{tapId}` when the triggering event resolves to a
//    tap, else `monitor:{monitorRefKey}` when it resolves to a bound monitor, else
//    `'global'` (schedule/app_startup). This is what "per-(rule, entity) active state"
//    keys off.
// 3. Auto-resolve pairing per trigger kind: `keg_level_crosses`/`temp_crosses` resolve on
//    the SAME rule's threshold being re-crossed in the OPPOSITE direction (computed from
//    the exact same prev/curr sample pair the forward match uses -- see `conditions.ts`'s
//    `crossed`/`opposite`). `device_offline` resolves on `device_online` for the same
//    monitor (and vice versa, symmetrically -- a `device_online` alert, if anyone
//    authors one, resolves on `device_offline`). `keg_kicked` resolves on `keg_tapped`
//    for the same tap (and vice versa). `pour_started`/`pour_completed`/`schedule`/
//    `app_startup` are momentary triggers with no natural "cleared" counterpart -- an
//    alert on one of these can still be marked `autoResolve`, it just never actually
//    resolves automatically (matches the spec's "when condition clears" literally: there
//    is no clearing event to observe for a momentary trigger).
// 4. Resolve notifications (`notifyOnResolve`) reuse the UNION of channels named across
//    the rule's own `notify` action(s) (falling back to `['inApp']` if the rule has none)
//    -- NOT a re-run of the full action list (webhook/mqtt/wall_banner do not re-fire on
//    resolve). Title/body are fixed, non-templated strings (`"{rule.name} resolved"` /
//    `"Back within normal range"`) -- the schema has no `alertConfig`-level template
//    field for this, and a resolve is informational, not another instance of the
//    author-written notify body. Quiet hours apply identically to resolve notifications.
// 5. `automations_changed` (added to `EventMap` in this task) is a HOOK POINT: the engine
//    subscribes to it and calls `reloadRules()`. `reloadRules()` is also directly
//    exported/callable so a caller can force a reload without round-tripping through the
//    bus. UPDATE (Phase 5 Task 4): `routes/automations.ts`'s CRUD/from-template routes
//    now emit it on every rule mutation -- this is that hook point's first (and, as of
//    this task, only) emitter.
// 6. Lifecycle: constructed in `context.ts`'s `createContext` (cheap: no I/O), but
//    `start()`/`stop()` are called alongside `sources.startAll()`/`stopAll()` in
//    `app.ts` (gated behind the SAME `startSources` option), NOT unconditionally like
//    `StateManager.start()` -- `start()` can dispatch REAL actions (webhook/mqtt/SMTP/
//    etc, via `app_startup` rules), which is exactly the kind of live-network side effect
//    `startSources: false` exists to suppress in tests that merely `buildApp()` without
//    opting in.
// 7. `flush()`: every rule-fire this engine kicks off is fire-and-forget from the bus's
//    perspective (`EventBus.emit` never awaits its handlers), but every such promise is
//    tracked in `this.inFlight` so `flush()` can await "everything currently pending" --
//    used by `stop()` is NOT required to wait (see its own doc comment) but tests use
//    `flush()` extensively for deterministic assertions instead of arbitrary sleeps.
//
// PHASE 5 TASK 4 additions (alert templates + wall banner delivery + WS + run-now):
//
// 8. `humidity_crosses` is a SIBLING trigger kind of `temp_crosses` (own
//    `handleHumidityCrossing` method, own `previousHumidityByMonitor` baseline map), not
//    a generalized `telemetry_crosses {field}` union -- see `automationSchema.ts`'s doc
//    comment on the trigger for the full "my call" reasoning. `onTelemetry` now evaluates
//    temp/humidity crossings INDEPENDENTLY (a telemetry sample with only one field
//    non-null still evaluates that field's crossings -- see `onTelemetry`'s own doc
//    comment for why this is a behavior change from Task 3's single early-return).
// 9. `days_since_cleaned` (the cleaning-due alert template's condition) needs "which
//    monitor", which a bare schedule tick has none of -- `checkScheduleRules` detects a
//    `days_since_cleaned` condition on a schedule rule and hands it to
//    `checkCleaningDueRule`, which evaluates/fires the rule ONCE PER Kegtron Pro monitor
//    (not once globally, unlike every other schedule rule) using `daysSinceCleaned`
//    computed fresh from that monitor's `meta.dateCleaned` (stamped at cloud discovery --
//    see shadow.ts). `ConditionEvalCtx.daysSinceCleaned` is OPTIONAL specifically so this
//    doesn't ripple a new required field through every other `EvalCtx` builder.
// 10. `runRuleOnce` (`POST /api/automations/:id/run`'s test-run support) is a SEPARATE
//     dispatch path from `considerFire`/`dispatchActions`, not a flag on them -- it skips
//     cooldown/runaway/`touchLastFired`/alert-state entirely (a manual test-run must
//     never consume the rule's real budget) and runs against a fabricated
//     `buildSyntheticEvalCtx()` (no real triggering event exists for a manual run), but
//     still genuinely DISPATCHES each action (a real dry-run, not a preview) and reports
//     per-action `{type, ok, error?}` results instead of "log and continue".
//
// FINAL-REVIEW FIX WAVE (I3) additions:
//
// 11. `alert_fired` (HA's only delivery path, via `haPublisher.relayAlert`) is now
//     suppressed by quiet hours, same as every other external channel -- checked in
//     `considerFire` (engine-side) rather than in the publisher, so the bus event itself
//     never fires, not merely "HA chooses to drop it". In-app is unaffected -- it
//     consumes the rule's `notify` action via `sendToChannels`, never this event.
//
// PRESENCE/DISPLAY-POWER FRAMEWORK (Task 8) additions:
//
// 12. `motion_detected`/`display_power_changed` are a NEW entity-key family: `wall:
//     {wallSlug}` when the event carries one, else `'global'` (see `entityKeyFor`) --
//     added as a third branch alongside `tap:`/`monitor:`, not a replacement of either
//     (these two triggers never resolve a tap or monitor ref). Both are MOMENTARY (point
//     3 above) -- no auto-resolve counterpart. `display_power_changed` additionally
//     supports an optional `state` filter (matches only that specific transition), which
//     -- like `days_since_cleaned`'s per-monitor schedule handling -- needs its own bus
//     handler rather than reusing `fireMatchingTrigger` (that helper only ever checks
//     `trigger.type`, nothing kind-specific beyond it).
// 13. `display_power` (the action) calls `presence.setState` directly -- it does NOT
//     route through the bus/PresenceRegistry's motion-debounce path at all, since an
//     authored action is an explicit override, not a wake signal. Loop safety is entirely
//     `PresenceRegistry.setState`'s own callee-side no-op-when-already-in-that-state guard
//     (core/presence.ts's `transition`) -- a `display_power` action that sets a zone to
//     the state it's already in emits no `display_power_changed` event, so it can never
//     re-trigger a `display_power_changed`-triggered rule (including itself). This engine
//     adds no additional guard on top of that.
//
// PER-DEVICE OFFLINE/ONLINE COLLAPSE (duplicate-notification fix wave):
//
// 14. `device_online`/`device_offline` arrive from the cloud source once PER PORT (that
//     per-port emission shape is load-bearing for per-port consumers — StateManager's
//     monitor state, logService, wallAutoAssign — so it stays), but connectivity is a
//     per-DEVICE fact: one KT-420 dropping off WiFi used to fire up to 4 simultaneous
//     "Monitor offline" notifications on every channel (alert state is keyed per
//     resolved entity, so each port alerted under its own cooldown) and 4 resolves.
//     Collapsed ENGINE-side in `onDeviceEvent` with the same per-device anchor grouping
//     `checkCleaningDueRule` (point 9) already uses — see that method's doc comment.
// ---------------------------------------------------------------------------

const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
const DEFAULT_RUNAWAY_LIMIT_PER_HOUR = 60;
const RUNAWAY_WINDOW_MS = 60 * 60_000;
const SCHEDULE_TICK_MS = 60_000;

export interface EngineDeps {
  db: Database.Database;
  bus: EventBus;
  settings: SettingsStore;
  /** Narrowed to the one method the engine needs (not the full `StateManager` class) --
   * production passes the real `StateManager`; tests can pass anything structurally
   * compatible. */
  state: { getTapStates(): TapState[] };
  /** Task 8: the `display_power` action's sole dependency, narrowed to the one method it
   * calls (not the full `PresenceRegistry` class) -- production passes the real
   * `PresenceRegistry` (constructed in `context.ts` BEFORE this engine, specifically so it
   * can be threaded in here); tests can pass anything structurally compatible, e.g. a
   * `vi.fn()` spy wrapped in an object literal. */
  presence: { setState(slug: string | null, state: PowerState): void };
}

/** Minimal shape of `ingest/kegtron/mdashClient.ts`'s `MdashClient` this engine actually
 * calls (`kegtron_reset_volume` action) -- narrowed so `EngineOptions.mdashClientFactory`
 * doesn't force a test double to implement the whole real client. */
export interface MdashRpcClient {
  callRpc(deviceKey: string, method: string, params?: unknown): Promise<unknown>;
}

export interface EngineOptions {
  /** Per-action dispatch timeout (ms). Default 10s per the plan. Test-overridable so the
   * "per-action timeout" test doesn't need to wait out the real default. */
  actionTimeoutMs?: number;
  /** Runaway guard: max fires/hour/rule, across ALL rules (not just alerts) per the
   * plan. Default 60. Test-overridable to exercise the guard without firing 61 events. */
  runawayLimitPerHour?: number;
  /** Overrides the `webhook` action's SSRF-guard DNS resolver -- tests only; see
   * `core/ssrfGuard.ts`. */
  webhookResolveHost?: HostResolver;
  /** Test-only escape hatch for the `webhook` action's SSRF guard -- never set in
   * production; mirrors `routes/lookup.ts`'s `allowInsecureHosts` (same rationale: lets a
   * test's fake upstream bind to 127.0.0.1 without the guard rejecting it). */
  webhookAllowInsecureHosts?: boolean;
  /** Test-injectable `MqttSender` for the `mqtt_publish` action. When omitted, the engine
   * lazily builds and OWNS one (closed on `stop()`); an injected instance is the test's
   * to manage and is never closed by this engine. */
  mqttSender?: MqttSender;
  /** Test-injectable factory for the `kegtron_reset_volume` action's mdash client. When
   * omitted, the engine builds a real `MdashClient` from `settings.kegtronApiKey`/
   * `kegtronBaseUrl` (matching `routes/kegtron.ts`'s own `buildMdashClient`). */
  mdashClientFactory?: (settings: SettingsStore) => MdashRpcClient;
}

/** One action's outcome from `AutomationEngine.runRuleOnce` (Phase 5 Task 4's
 * `POST /api/automations/:id/run` test-run support). `error` is the same humanized
 * `Error#message` every action's real dispatch path already logs -- never a raw/opaque
 * value -- and is only present when `ok` is `false`. */
export interface ActionRunResult {
  type: Action['type'];
  ok: boolean;
  error?: string;
}

/** The engine's own per-event evaluation context -- `ConditionEvalCtx` (conditions.ts)
 * plus the raw `monitorRef` (for entity-keying/auto-resolve) and the fully-built
 * `TemplateContext` (notify/template.ts) actions render against. */
interface EvalCtx extends ConditionEvalCtx {
  monitorRef: MonitorRef | null;
  templateCtx: TemplateContext;
}

interface AlertEntityState {
  active: boolean;
  /** Epoch ms of the last time THIS (rule, entity)'s alert actually fired (not merely
   * matched) -- what `cooldownMinutes` is measured from. */
  lastFiredAt: number;
}

/** Runs `fn`, rejecting with a timeout error if it hasn't settled within `ms`. Losing
 * side's eventual settlement is still "handled" by `Promise.race` internally attaching
 * its own `.then`/`.catch` to both promises, so a `fn()` that rejects AFTER the timeout
 * already won never produces an unhandled-rejection warning. */
async function runWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Pure helper behind the `days_since_cleaned` condition: whole days elapsed between a
 * monitor's raw `meta.dateCleaned` (whatever date-string format the Kegtron Pro device
 * reported -- see shadow.ts's `ParsedPort.dateCleaned` doc comment, `YYYY/MM/DD` in every
 * fixture seen so far, parsed via the `Date` constructor's general string parsing) and
 * `now`. Returns `null` -- "not applicable", never "0 days" -- for a missing/non-string/
 * unparsable value, or a value that parses to a moment AFTER `now` (clock skew / bad
 * device data; a keg can't have been cleaned in the future, so this is never treated as
 * "just cleaned" either). Never throws.
 */
function computeDaysSinceCleaned(dateCleaned: unknown, now: Date): number | null {
  if (typeof dateCleaned !== 'string' || dateCleaned.length === 0) return null;
  const parsed = new Date(dateCleaned);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = now.getTime() - parsed.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / 86_400_000);
}

/** The channel set a resolve notification (`notifyOnResolve`) sends through -- the union
 * of every `notify` action's `channels` on the rule, or `['inApp']` if the rule has no
 * `notify` action at all. See this file's top doc comment, point 4. */
function notifyChannelsOf(rule: AutomationRule): string[] {
  const set = new Set<string>();
  for (const action of rule.actions) {
    if (action.type === 'notify') for (const ch of action.channels) set.add(ch);
  }
  return set.size > 0 ? [...set] : ['inApp'];
}

/** Phase 5 Task 5: title/body for the `alert_fired` bus event (see `events.ts`'s doc
 * comment on that event). Reuses the rule's FIRST `notify` action's already-templated
 * title/body when it has one -- an alert rule authored with a `notify` action has
 * presumably written a meaningful message there, and re-using it (rather than inventing a
 * second, differently-worded summary) keeps the HA event payload consistent with whatever
 * the in-app/external notification actually said. Falls back to `{title: rule.name, body:
 * ''}` for an alert rule with no `notify` action at all (e.g. a rule that only dispatches
 * `wall_banner`/`mqtt_publish`) -- there's no authored copy to reuse. */
function alertTitleBodyOf(rule: AutomationRule, ctx: TemplateContext): { title: string; body: string } {
  const notifyAction = rule.actions.find(
    (a): a is Extract<Action, { type: 'notify' }> => a.type === 'notify',
  );
  if (notifyAction) {
    return { title: renderTemplate(notifyAction.title, ctx), body: renderTemplate(notifyAction.body, ctx) };
  }
  return { title: rule.name, body: '' };
}

// --- TemplateContext field mapping ------------------------------------------------
// The plan's documented template variables are snake_case for every multi-word field
// (`{{pour.volume_ml}}`, `{{keg.level_pct}}`) even though this app's internal TS shapes
// are camelCase everywhere else -- these helpers are the ONE place that translation
// happens, so every `EvalCtx` builder below produces an identically-shaped
// `TemplateContext` regardless of which trigger built it.

interface TemplateBeerSource {
  id: number; name: string; brewery: string | null; style: string | null;
  abv: number | null; ibu: number | null; srm: number | null;
  description: string | null; labelImage: string | null;
}

function templateBeer(beer: TemplateBeerSource | null | undefined): Record<string, unknown> | null {
  if (!beer) return null;
  return {
    id: beer.id, name: beer.name, brewery: beer.brewery, style: beer.style,
    abv: beer.abv, ibu: beer.ibu, srm: beer.srm, description: beer.description,
    label_image: beer.labelImage,
  };
}

function templateTap(tap: { id: number; number: number; name: string | null } | null): Record<string, unknown> | null {
  return tap ? { id: tap.id, number: tap.number, name: tap.name } : null;
}

interface TemplateKegSource {
  id: number; sizeMl: number; volStartMl: number; volDispensedMl: number;
  dateTapped: string | null; status: string; levelPct: number; remainingMl: number;
}

function templateKeg(keg: TemplateKegSource | null | undefined): Record<string, unknown> | null {
  if (!keg) return null;
  return {
    id: keg.id, size_ml: keg.sizeMl, vol_start_ml: keg.volStartMl, vol_dispensed_ml: keg.volDispensedMl,
    level_pct: keg.levelPct, remaining_ml: keg.remainingMl, date_tapped: keg.dateTapped, status: keg.status,
  };
}

function templatePour(
  pour: { volumeMl: number | null; durationMs: number | null; ts: string } | null | undefined,
): Record<string, unknown> | null {
  if (!pour) return null;
  return { volume_ml: pour.volumeMl, duration_ms: pour.durationMs, ts: pour.ts };
}

function templateMonitor(ref: MonitorRef, temp: number | null, humidity: number | null): Record<string, unknown> {
  return { type: ref.type, identifier: ref.identifier, port_index: ref.portIndex, temp, humidity };
}

export class AutomationEngine {
  private readonly db: Database.Database;
  private readonly bus: EventBus;
  private readonly settings: SettingsStore;
  private readonly state: { getTapStates(): TapState[] };
  private readonly presence: { setState(slug: string | null, state: PowerState): void };
  private readonly opts: EngineOptions;
  private readonly inAppChannel: InAppChannel;

  private rules: AutomationRule[] = [];
  private unsubs: Array<() => void> = [];
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private lastScheduleFireKey = new Map<number, string>();
  /** Last observed level%/temp per tap/monitor -- crossing detection compares each new
   * sample against these. No entry yet = no baseline = the sample can't be a "crossing"
   * (there's nothing to have crossed FROM), so it's just recorded, not evaluated. */
  private previousLevelByTap = new Map<number, number>();
  private previousTempByMonitor = new Map<string, number>();
  private previousHumidityByMonitor = new Map<string, number>();
  private alertState = new Map<string, AlertEntityState>();
  /** Per-device collapse for `device_online`/`device_offline` fan-out (see
   * `onDeviceEvent`): `"type:identifier"` -> the last `"{kind}@{ts}"` processed. */
  private lastDeviceEventBurst = new Map<string, string>();
  private fireTimestamps = new Map<number, number[]>();
  private inFlight = new Set<Promise<void>>();
  private ownedMqttSender: MqttSender | null = null;

  constructor(deps: EngineDeps, opts: EngineOptions = {}) {
    this.db = deps.db;
    this.bus = deps.bus;
    this.settings = deps.settings;
    this.state = deps.state;
    this.presence = deps.presence;
    this.opts = opts;
    this.inAppChannel = new InAppChannel(this.db, this.bus);
  }

  /**
   * Loads current rule cache from `db/automations.ts` (enabled rules only). Called by
   * `start()`, by the `automations_changed` bus hook, and directly callable any time
   * (before or after `start()`) -- see this file's top doc comment, point 5.
   */
  reloadRules(): void {
    this.rules = listAutomations(this.db, { enabledOnly: true });
  }

  /**
   * Subscribes to every bus event a trigger kind depends on, starts the schedule minute
   * timer (checking once immediately too, so a rule matching the CURRENT minute at boot
   * doesn't wait a full tick), and fires `app_startup` rules. Safe to call once; calling
   * again without an intervening `stop()` would double-subscribe (not guarded -- matches
   * `SourceManager`/`StateManager`'s own "caller's job to call this once" precedent).
   */
  start(): void {
    this.reloadRules();

    const on = <K extends keyof EventMap>(event: K, handler: (e: EventMap[K]) => void): void => {
      this.unsubs.push(this.bus.on(event, handler));
    };

    on('pour_started', (e) => this.onPourStarted(e));
    on('pour_completed', (e) => this.onPourCompleted(e));
    on('volume_update', (e) => this.onVolumeUpdate(e));
    on('telemetry', (e) => this.onTelemetry(e));
    on('device_online', (e) => this.onDeviceEvent('device_online', e.monitor, e.ts));
    on('device_offline', (e) => this.onDeviceEvent('device_offline', e.monitor, e.ts));
    on('keg_tapped', (e) => this.onKegLifecycle('keg_tapped', e));
    on('keg_kicked', (e) => this.onKegLifecycle('keg_kicked', e));
    on('motion_detected', (e) => this.onMotionDetected(e));
    on('display_power_changed', (e) => this.onDisplayPowerChanged(e));
    on('automations_changed', () => this.reloadRules());

    this.scheduleTimer = setInterval(() => this.checkScheduleRules(), SCHEDULE_TICK_MS);
    this.checkScheduleRules();
    this.fireAppStartup();
  }

  /**
   * Unsubscribes every bus handler and clears the schedule timer -- no NEW rule
   * evaluation can start after this returns. Does NOT await already-in-flight action
   * dispatches (a webhook/SMTP/etc call already underway keeps running to completion in
   * the background; each has its own per-action timeout as a backstop) -- awaiting up to
   * `actionTimeoutMs` per in-flight action here would make shutdown itself as slow as
   * the slowest pending action, which is worse than letting it finish (or time out) on
   * its own. Tests that need to observe in-flight settlement use `flush()` explicitly,
   * BEFORE calling `stop()`, instead. Idempotent -- safe to call multiple times, or
   * before `start()` was ever called.
   */
  stop(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    if (this.ownedMqttSender) {
      const sender = this.ownedMqttSender;
      this.ownedMqttSender = null;
      void sender.close().catch(() => {});
    }
  }

  /** Awaits every currently-tracked in-flight rule-fire (a snapshot -- fires started
   * AFTER this is called are not waited on). Test-only determinism helper: since
   * `EventBus.emit` never awaits its handlers, an emitted event's resulting action
   * dispatch is inherently "somewhere in the background" from the caller's perspective;
   * `flush()` gives tests a way to wait for it to settle instead of an arbitrary sleep. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private track(p: Promise<void>): void {
    this.inFlight.add(p);
    const done = (): void => { this.inFlight.delete(p); };
    p.then(done, done);
  }

  private logError(rule: AutomationRule, what: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[automation] rule ${rule.id} ("${rule.name}") ${what} failed: ${message}`);
  }

  // --- trigger -> event wiring ---------------------------------------------------

  private onPourStarted(e: EventMap['pour_started']): void {
    const tapId = resolveTapForRef(this.db, e.monitor);
    const ctx = this.buildTapEvalCtx(tapId, e.ts, {
      monitorRef: e.monitor, pour: { volumeMl: null, durationMs: null, ts: e.ts },
    });
    this.fireMatchingTrigger('pour_started', ctx);
  }

  private onPourCompleted(e: EventMap['pour_completed']): void {
    const tapId = resolveTapForRef(this.db, e.monitor);
    const ctx = this.buildTapEvalCtx(tapId, e.ts, {
      monitorRef: e.monitor, volumeMl: e.volumeMl,
      pour: { volumeMl: e.volumeMl, durationMs: e.durationMs, ts: e.ts },
    });
    this.fireMatchingTrigger('pour_completed', ctx);
  }

  /** `keg_level_crosses` is derived from `volume_update`'s freshly-applied keg state --
   * relies on `StateManager`'s OWN `volume_update` subscriber (registered earlier, during
   * `createContext`) having already run and updated `kegs.vol_dispensed_ml` in the DB
   * before this handler runs (`EventBus` calls subscribers in registration order). */
  private onVolumeUpdate(e: EventMap['volume_update']): void {
    const tapId = resolveTapForRef(this.db, e.monitor);
    if (tapId === null) return;
    const keg = getActiveKegForTap(this.db, tapId);
    if (!keg) return;
    const newLevel = computeLevelPct(keg.volStartMl, keg.volDispensedMl);
    const prevLevel = this.previousLevelByTap.get(tapId);
    this.previousLevelByTap.set(tapId, newLevel);
    if (prevLevel === undefined) return; // no baseline yet -- can't detect a crossing

    const ctx = this.buildTapEvalCtx(tapId, e.ts, { monitorRef: e.monitor, levelPct: newLevel });
    const now = new Date();
    for (const rule of this.rules) {
      if (rule.trigger.type !== 'keg_level_crosses') continue;
      const { thresholdPct, direction } = rule.trigger;
      if (crossed(prevLevel, newLevel, thresholdPct, direction)) {
        if (evaluateConditions(rule.conditions, ctx, rule.lastFiredAt, now)) {
          this.track(this.considerFire(rule, ctx).catch((err) => this.logError(rule, 'fire', err)));
        }
      } else if (rule.isAlert && rule.alertConfig?.autoResolve
        && crossed(prevLevel, newLevel, thresholdPct, opposite(direction))) {
        this.handleResolve(rule, ctx);
      }
    }
  }

  /**
   * `temp`/`humidity` crossings are evaluated INDEPENDENTLY -- a `telemetry` event that
   * has one field null (many Kegtron Pro payloads only update one sensor per sample --
   * see shadow.ts's `diffToEvents`) must still evaluate crossings for whichever field DID
   * report a value, rather than a single early return bailing out of both (that was this
   * method's behavior before `humidity_crosses` existed, when only `temp_crosses` needed
   * handling here).
   */
  private onTelemetry(e: EventMap['telemetry']): void {
    const tapId = resolveTapForRef(this.db, e.monitor);
    if (e.temp !== null) this.handleTempCrossing(e, tapId);
    if (e.humidity !== null) this.handleHumidityCrossing(e, tapId);
  }

  private handleTempCrossing(e: EventMap['telemetry'], tapId: number | null): void {
    const temp = e.temp as number; // caller guarantees non-null
    const key = monitorRefKey(e.monitor);
    const prevTemp = this.previousTempByMonitor.get(key);
    this.previousTempByMonitor.set(key, temp);
    if (prevTemp === undefined) return;

    const ctx = this.buildMonitorEvalCtx(e.monitor, tapId, e.ts, { temp, humidity: e.humidity });
    const now = new Date();
    for (const rule of this.rules) {
      if (rule.trigger.type !== 'temp_crosses') continue;
      const { value, direction } = rule.trigger;
      if (crossed(prevTemp, temp, value, direction)) {
        if (evaluateConditions(rule.conditions, ctx, rule.lastFiredAt, now)) {
          this.track(this.considerFire(rule, ctx).catch((err) => this.logError(rule, 'fire', err)));
        }
      } else if (rule.isAlert && rule.alertConfig?.autoResolve
        && crossed(prevTemp, temp, value, opposite(direction))) {
        this.handleResolve(rule, ctx);
      }
    }
  }

  /** Sibling of `handleTempCrossing` above for the `humidity_crosses` trigger -- see
   * `automationSchema.ts`'s doc comment on that trigger for why it's a separate method/
   * trigger kind rather than a generalized `field` parameter. */
  private handleHumidityCrossing(e: EventMap['telemetry'], tapId: number | null): void {
    const humidity = e.humidity as number; // caller guarantees non-null
    const key = monitorRefKey(e.monitor);
    const prevHumidity = this.previousHumidityByMonitor.get(key);
    this.previousHumidityByMonitor.set(key, humidity);
    if (prevHumidity === undefined) return;

    const ctx = this.buildMonitorEvalCtx(e.monitor, tapId, e.ts, { temp: e.temp ?? undefined, humidity });
    const now = new Date();
    for (const rule of this.rules) {
      if (rule.trigger.type !== 'humidity_crosses') continue;
      const { value, direction } = rule.trigger;
      if (crossed(prevHumidity, humidity, value, direction)) {
        if (evaluateConditions(rule.conditions, ctx, rule.lastFiredAt, now)) {
          this.track(this.considerFire(rule, ctx).catch((err) => this.logError(rule, 'fire', err)));
        }
      } else if (rule.isAlert && rule.alertConfig?.autoResolve
        && crossed(prevHumidity, humidity, value, opposite(direction))) {
        this.handleResolve(rule, ctx);
      }
    }
  }

  /**
   * Per-device collapse of the per-port `device_online`/`device_offline` fan-out (this
   * file's top doc comment, point 14), in two parts:
   *  1. BURST DEDUPE: one WS offline/online notification fans out as portCount bus
   *     events all stamped with a SINGLE `ts` (cloudSource.ts's `emitPortStatus`
   *     computes it once per notification), so a repeat of the same (kind, ts) for a
   *     device is the same physical signal seen through another port — skipped. A LATER
   *     notification of the same kind carries a fresh `ts` and still processes, so
   *     "device still offline an hour later" reminder fires keep working under the
   *     alert cooldown exactly as before — this is deliberately NOT a transition latch.
   *  2. ANCHOR: the surviving event is re-anchored onto the device's anchor port
   *     (`anchorDeviceRef` — `checkCleaningDueRule`'s grouping), so the entity key,
   *     alert cooldown/auto-resolve state, and tap context are all stable regardless of
   *     which port's event won the burst: a 4-port Kegtron is one device, not four.
   */
  private onDeviceEvent(kind: 'device_online' | 'device_offline', monitorRef: MonitorRef, ts: string): void {
    const deviceKey = `${monitorRef.type}:${monitorRef.identifier}`;
    const burstKey = `${kind}@${ts}`;
    if (this.lastDeviceEventBurst.get(deviceKey) === burstKey) return;
    this.lastDeviceEventBurst.set(deviceKey, burstKey);

    const anchored = this.anchorDeviceRef(monitorRef);
    const tapId = resolveTapForRef(this.db, anchored);
    const ctx = this.buildMonitorEvalCtx(anchored, tapId, ts, {});
    const resolveType: Trigger['type'] = kind === 'device_online' ? 'device_offline' : 'device_online';
    this.fireAndAutoResolve(kind, resolveType, ctx);
  }

  /** `checkCleaningDueRule`'s anchor grouping as a ref->ref mapping: among the device's
   * monitor rows (same type+identifier), the first BOUND port wins, else the lowest
   * (db/monitors.ts's `deviceAnchorPort` — the shared pick both sites use) — so an
   * offline burst and its later online burst always key the SAME entity even if
   * different ports' events survive the dedupe. An unknown device (no rows yet, e.g. a
   * test-synthesized event) keeps its own ref. */
  private anchorDeviceRef(ref: MonitorRef): MonitorRef {
    const ports = listMonitors(this.db)
      .filter((m) => m.type === ref.type && m.identifier === ref.identifier);
    if (ports.length === 0) return ref;
    const anchor = deviceAnchorPort(ports);
    return { type: anchor.type, identifier: anchor.identifier, portIndex: anchor.portIndex };
  }

  private onKegLifecycle(
    kind: 'keg_tapped' | 'keg_kicked', e: EventMap['keg_tapped'] | EventMap['keg_kicked'],
  ): void {
    const ctx = this.buildKegEvalCtx(e.tapId, e.kegId, e.ts);
    const resolveType: Trigger['type'] = kind === 'keg_tapped' ? 'keg_kicked' : 'keg_tapped';
    this.fireAndAutoResolve(kind, resolveType, ctx);
  }

  /** `motion_detected` has no kind-specific filter beyond trigger type -- straight
   * through `fireMatchingTrigger`, same as `pour_started`/`device_online`/etc. */
  private onMotionDetected(e: EventMap['motion_detected']): void {
    const ctx = this.buildWallEvalCtx(e.wallSlug, e.ts);
    this.fireMatchingTrigger('motion_detected', ctx);
  }

  /** `display_power_changed` additionally supports an optional `state` filter (matches
   * only that specific transition) -- can't reuse `fireMatchingTrigger`, which only ever
   * checks `trigger.type` (same reason `checkScheduleRules` doesn't reuse it either). */
  private onDisplayPowerChanged(e: EventMap['display_power_changed']): void {
    const ctx = this.buildWallEvalCtx(e.wallSlug, e.ts);
    const now = new Date();
    for (const rule of this.rules) {
      if (rule.trigger.type !== 'display_power_changed') continue;
      if (rule.trigger.state !== undefined && rule.trigger.state !== e.state) continue;
      if (!evaluateConditions(rule.conditions, ctx, rule.lastFiredAt, now)) continue;
      this.track(this.considerFire(rule, ctx).catch((err) => this.logError(rule, 'fire', err)));
    }
  }

  private fireAppStartup(): void {
    const ctx = this.buildGlobalEvalCtx(new Date().toISOString());
    this.fireMatchingTrigger('app_startup', ctx);
  }

  private checkScheduleRules(): void {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}T${timeStr}`;

    for (const rule of this.rules) {
      if (rule.trigger.type !== 'schedule') continue;
      if (rule.trigger.time !== timeStr) continue;
      if (rule.trigger.weekdays.length > 0 && !rule.trigger.weekdays.includes(now.getDay())) continue;
      if (this.lastScheduleFireKey.get(rule.id) === minuteKey) continue; // already fired this exact minute
      this.lastScheduleFireKey.set(rule.id, minuteKey);

      // Phase 5 Task 4 (cleaning-due alert template ledger note): a `days_since_cleaned`
      // condition needs "which monitor" -- a bare schedule tick has no such notion (every
      // OTHER schedule rule fires once, globally). Detected here and dispatched to a
      // dedicated per-monitor path instead of the single `buildGlobalEvalCtx` below.
      if (rule.conditions.some((c) => c.type === 'days_since_cleaned')) {
        this.checkCleaningDueRule(rule, now);
        continue;
      }

      const ctx = this.buildGlobalEvalCtx(now.toISOString());
      if (!evaluateConditions(rule.conditions, ctx, rule.lastFiredAt, now)) continue;
      this.track(this.considerFire(rule, ctx).catch((err) => this.logError(rule, 'fire', err)));
    }
  }

  /**
   * `days_since_cleaned`-conditioned schedule rules are evaluated PER Kegtron Pro monitor
   * (`dateCleaned` is Pro-only device-shadow data stamped into `monitors.meta` at cloud
   * discovery -- see shadow.ts) rather than once globally like every other schedule rule:
   * "is cleaning due" is inherently a per-device question. Each monitor gets its own
   * tap-scoped `EvalCtx` (so `tap_scope`/alert cooldown/entity-keyed state all work
   * per-device, exactly like any other monitor-derived event) with `daysSinceCleaned`
   * computed fresh from THAT device's `meta.dateCleaned`. Evaluated once per physical
   * DEVICE (monitors rows grouped by type+identifier — db/monitors.ts's
   * `groupMonitorsByDevice`; `dateCleaned` is stamped identically on every port row at
   * cloud discovery), anchored on the first bound port row (else the lowest port —
   * `deviceAnchorPort`, shared with `anchorDeviceRef` below) so the entity-keyed alert
   * cooldown/auto-resolve state stays stable. A rule with 2 overdue devices fires 2 times (once per device),
   * not once per port — a 4-port Kegtron is one device, not four.
   */
  private checkCleaningDueRule(rule: AutomationRule, now: Date): void {
    const byDevice = groupMonitorsByDevice(
      listMonitors(this.db).filter((m) => m.type === 'kegtron_pro'),
    );
    for (const ports of byDevice.values()) {
      const anchor = deviceAnchorPort(ports);
      const ref: MonitorRef = { type: anchor.type, identifier: anchor.identifier, portIndex: anchor.portIndex };
      const ctx = this.buildMonitorEvalCtx(ref, anchor.tapId, now.toISOString(), {});
      ctx.daysSinceCleaned = computeDaysSinceCleaned(anchor.meta?.dateCleaned, now);
      if (!evaluateConditions(rule.conditions, ctx, rule.lastFiredAt, now)) continue;
      this.track(this.considerFire(rule, ctx).catch((err) => this.logError(rule, 'fire', err)));
    }
  }

  /** Forward-match dispatch (any trigger kind) PLUS, for a paired `resolveType`, checks
   * every isAlert-with-autoResolve rule of that opposite kind for resolution. Used by the
   * two symmetric device/keg-lifecycle event pairs (see this file's top doc comment,
   * point 3) -- NOT by the crossing triggers, which compute forward/resolve from the same
   * prev/curr sample pair inline (`onVolumeUpdate`/`onTelemetry` above) rather than two
   * independent trigger types. */
  private fireAndAutoResolve(forwardType: Trigger['type'], resolveType: Trigger['type'], ctx: EvalCtx): void {
    this.fireMatchingTrigger(forwardType, ctx);
    for (const rule of this.rules) {
      if (rule.trigger.type !== resolveType || !rule.isAlert || !rule.alertConfig?.autoResolve) continue;
      this.handleResolve(rule, ctx);
    }
  }

  private fireMatchingTrigger(type: Trigger['type'], ctx: EvalCtx): void {
    const now = new Date();
    for (const rule of this.rules) {
      if (rule.trigger.type !== type) continue;
      if (!evaluateConditions(rule.conditions, ctx, rule.lastFiredAt, now)) continue;
      this.track(this.considerFire(rule, ctx).catch((err) => this.logError(rule, 'fire', err)));
    }
  }

  // --- fire / alert-state / dispatch ---------------------------------------------

  private entityKeyFor(ctx: EvalCtx): string {
    if (ctx.tapId !== null) return `tap:${ctx.tapId}`;
    if (ctx.monitorRef) return `monitor:${monitorRefKey(ctx.monitorRef)}`;
    // Task 8: `motion_detected`/`display_power_changed` resolve neither a tap nor a
    // monitor ref -- their own entity key family, `wall:{wallSlug}`, falling back to
    // 'global' for a wall-less event (e.g. motion with no zone context).
    if (ctx.wallSlug) return `wall:${ctx.wallSlug}`;
    return 'global';
  }

  private checkRunaway(ruleId: number, now: Date): boolean {
    const limit = this.opts.runawayLimitPerHour ?? DEFAULT_RUNAWAY_LIMIT_PER_HOUR;
    const arr = (this.fireTimestamps.get(ruleId) ?? []).filter((t) => now.getTime() - t < RUNAWAY_WINDOW_MS);
    if (arr.length >= limit) {
      this.fireTimestamps.set(ruleId, arr);
      return false;
    }
    arr.push(now.getTime());
    this.fireTimestamps.set(ruleId, arr);
    return true;
  }

  /**
   * A rule's trigger matched and its conditions passed -- decide whether it ACTUALLY
   * fires (cooldown / runaway guard) and, if so, dispatch its actions. Marks
   * `last_fired_at` (DB + in-memory cache) and, for alerts, the active state BEFORE
   * awaiting action dispatch -- see this file's top comment for why (a concurrently
   * processed event must see this fire's effect immediately, not after its actions,
   * which may take up to `actionTimeoutMs` each, have finished).
   */
  private async considerFire(rule: AutomationRule, ctx: EvalCtx): Promise<void> {
    const now = new Date();
    const stateKey = `${rule.id}:${this.entityKeyFor(ctx)}`;

    if (rule.isAlert && rule.alertConfig) {
      // Task 3 review Fix round 1 (Important): gated on time-since-last-FIRE
      // REGARDLESS of the entity's current active/resolved state -- NOT `st?.active`
      // only. An oscillating signal (e.g. temp bouncing around a threshold) with
      // `autoResolve: true` resolves between crossings, so checking `active` alone lets
      // every single re-crossing fire again the instant it resolves, bounded only by the
      // runaway guard -- a rule author setting `cooldownMinutes: 60` expects AT MOST ONE
      // fire per hour, not "one fire per hour while continuously active". `st.lastFiredAt`
      // is only ever updated by an ACTUAL fire (never by a suppressed attempt or a
      // resolve), so this is genuinely "time since this (rule, entity) last fired",
      // independent of whether it's currently active. Resolve/`notifyOnResolve` are
      // untouched by this check -- `handleResolve` doesn't call `considerFire` at all.
      const st = this.alertState.get(stateKey);
      if (st) {
        const elapsedMinutes = (now.getTime() - st.lastFiredAt) / 60_000;
        if (elapsedMinutes < rule.alertConfig.cooldownMinutes) return; // suppressed by cooldown
      }
    }

    if (!this.checkRunaway(rule.id, now)) {
      const limit = this.opts.runawayLimitPerHour ?? DEFAULT_RUNAWAY_LIMIT_PER_HOUR;
      console.error(`[automation] rule ${rule.id} ("${rule.name}") exceeded ${limit}/hr -- skipping this fire`);
      return;
    }

    touchLastFired(this.db, rule.id, now.toISOString());
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx !== -1) this.rules[idx] = { ...this.rules[idx]!, lastFiredAt: now.toISOString() };
    if (rule.isAlert && rule.alertConfig) {
      this.alertState.set(stateKey, { active: true, lastFiredAt: now.getTime() });
    }

    const templateCtx: TemplateContext = {
      ...ctx.templateCtx,
      alert: rule.isAlert ? { name: rule.name, severity: rule.alertConfig?.severity ?? 'info' } : null,
    };
    if (rule.isAlert && rule.alertConfig) {
      const { title, body } = alertTitleBodyOf(rule, templateCtx);
      // Final-review fix wave (I3a): `alert_fired` is HA's ONLY delivery path (see
      // haPublisher.ts's `relayAlert`) -- the spec lists "Home Assistant notify" as a
      // channel quiet hours suppress, same as every other external channel. Checked here
      // (engine-side), not in the publisher, so the EVENT ITSELF is suppressed -- matching
      // "quiet hours suppress the channel", not "the channel happens to ignore it". `now`
      // (already computed above) is reused rather than re-reading `new Date()` so this and
      // `sendToChannels`'s own quiet-hours check below (via `dispatchActions`) agree on the
      // instant being evaluated. In-app is unaffected: it never consumes this event -- it's
      // driven entirely by the rule's own `notify` action through `dispatchActions` /
      // `sendToChannels`, which keeps its unchanged "inApp always records" carve-out.
      if (!this.isQuietHours(now)) {
        this.bus.emit('alert_fired', {
          ruleId: rule.id, ruleName: rule.name, severity: rule.alertConfig.severity,
          title, body, tapId: ctx.tapId ?? undefined, ts: ctx.ts,
        });
      }
    }
    await this.dispatchActions(rule, templateCtx, ctx);
  }

  /** Marks an active alert (rule, entity) resolved. A no-op if it wasn't active (a
   * "resolve" signal for an alert that never activated, or already resolved, carries no
   * information). Optionally sends a resolve notification -- see this file's top
   * comment, point 4. */
  private handleResolve(rule: AutomationRule, ctx: EvalCtx): void {
    const stateKey = `${rule.id}:${this.entityKeyFor(ctx)}`;
    const st = this.alertState.get(stateKey);
    if (!st?.active) return;
    this.alertState.set(stateKey, { active: false, lastFiredAt: st.lastFiredAt });
    if (!rule.alertConfig?.notifyOnResolve) return;

    const channels = notifyChannelsOf(rule);
    const severity: NotificationSeverity = rule.alertConfig.severity;
    this.track(
      this.sendToChannels(
        channels, { title: `${rule.name} resolved`, body: 'Back within normal range', severity }, rule.id,
      ).catch((err) => this.logError(rule, 'resolve-notify', err)),
    );
  }

  /**
   * Phase 5 Task 4: `POST /api/automations/:id/run`'s "test-run" support -- runs every
   * action of `rule` in order against a fabricated `buildSyntheticEvalCtx()` (there is no
   * real triggering event for a manual test-run) and reports a per-action `{type, ok,
   * error?}` result instead of the fire-and-forget "log and continue" behavior
   * `dispatchActions` (the REAL fire path) uses. Deliberately bypasses `considerFire`
   * entirely -- no cooldown/runaway-guard check, no `touchLastFired`/alert-active-state
   * write, no template `alert` field beyond what `rule.isAlert` already implies -- a
   * manual test-run must never consume the rule's real cooldown budget or be
   * indistinguishable, in `automations.last_fired_at`, from an actual fire. A real
   * `notify`/`webhook`/`mqtt_publish`/`wall_banner`/`party_mode` action still genuinely
   * SENDS (this is a real dry-run of the rule's configured actions, not a preview) --
   * only the engine's own bookkeeping is skipped. `kegtron_reset_volume` will always fail
   * here (the synthetic ctx has no real tap), which is the correct, honest outcome for a
   * test-run with no live trigger context.
   */
  async runRuleOnce(rule: AutomationRule): Promise<ActionRunResult[]> {
    const ctx = this.buildSyntheticEvalCtx();
    const templateCtx: TemplateContext = {
      ...ctx.templateCtx,
      alert: rule.isAlert ? { name: rule.name, severity: rule.alertConfig?.severity ?? 'info' } : null,
    };
    const timeoutMs = this.opts.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    const results: ActionRunResult[] = [];
    for (const action of rule.actions) {
      try {
        await runWithTimeout(() => this.executeAction(action, templateCtx, ctx, rule), timeoutMs);
        results.push({ type: action.type, ok: true });
      } catch (err) {
        results.push({ type: action.type, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  private async dispatchActions(rule: AutomationRule, templateCtx: TemplateContext, ctx: EvalCtx): Promise<void> {
    const timeoutMs = this.opts.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    for (const action of rule.actions) {
      try {
        await runWithTimeout(() => this.executeAction(action, templateCtx, ctx, rule), timeoutMs);
      } catch (err) {
        this.logError(rule, `action "${action.type}"`, err);
      }
    }
  }

  private async executeAction(
    action: Action, templateCtx: TemplateContext, ctx: EvalCtx, rule: AutomationRule,
  ): Promise<void> {
    switch (action.type) {
      case 'notify': return this.dispatchNotify(action, templateCtx, rule);
      case 'webhook': return this.dispatchWebhook(action, templateCtx);
      case 'mqtt_publish': return this.dispatchMqtt(action, templateCtx);
      case 'wall_banner': return this.dispatchWallBanner(action, templateCtx);
      case 'party_mode': return this.dispatchPartyMode(action);
      case 'kegtron_reset_volume': return this.dispatchResetVolume(ctx);
      case 'display_power': return this.dispatchDisplayPower(action);
    }
  }

  // --- per-action-type dispatch ---------------------------------------------------

  private async dispatchNotify(
    action: Extract<Action, { type: 'notify' }>, ctx: TemplateContext, rule: AutomationRule,
  ): Promise<void> {
    const title = renderTemplate(action.title, ctx);
    const body = renderTemplate(action.body, ctx);
    const severity: NotificationSeverity = rule.isAlert && rule.alertConfig ? rule.alertConfig.severity : 'info';
    await this.sendToChannels(action.channels, { title, body, severity }, rule.id);
  }

  /**
   * Shared per-channel dispatch for BOTH the `notify` action and resolve notifications.
   * Quiet hours (`settings.quietHours`) suppress every channel EXCEPT `inApp` -- in-app
   * always records, per the plan's explicit "in-app still records" carve-out. A channel
   * name this app doesn't recognize, or one with no config saved, is logged and skipped
   * (never thrown -- one bad channel in a multi-channel `notify` action must not stop the
   * others).
   */
  private async sendToChannels(
    channels: string[], msg: { title: string; body: string; severity: NotificationSeverity }, ruleId: number,
  ): Promise<void> {
    const quiet = this.isQuietHours(new Date());
    for (const name of channels) {
      if (quiet && name !== 'inApp') continue;
      const channel = this.buildChannel(name);
      if (!channel) {
        console.error(`[automation] rule ${ruleId} references channel "${name}", which is not configured -- skipping`);
        continue;
      }
      try {
        await channel.send({ ...msg, meta: { automationId: ruleId } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[automation] rule ${ruleId} channel "${name}" send failed: ${message}`);
      }
    }
  }

  private isQuietHours(now: Date): boolean {
    const qh = this.settings.get('quietHours');
    return qh ? isWithinTimeWindow(now, qh.start, qh.end) : false;
  }

  private buildChannel(name: string): Channel | null {
    if (name === 'inApp') return this.inAppChannel;
    if ((ALERT_CHANNEL_NAMES as readonly string[]).includes(name)) {
      return buildAlertChannel(this.settings, name as AlertChannelName);
    }
    return null;
  }

  /**
   * HARD REQUIREMENT (Task 2 review): `url` is EDITOR-authored (set on the rule, not
   * server-controlled), so it goes through the exact same SSRF guard as `labelUrl`'s
   * download before ever reaching `sendWebhook` -- fail-closed, same as
   * `routes/lookup.ts`'s `downloadAndStoreLabel`. A rejected/invalid URL throws, which
   * `dispatchActions`' per-action try/catch logs and continues past -- it never crashes
   * the engine or blocks the rule's remaining actions.
   */
  private async dispatchWebhook(action: Extract<Action, { type: 'webhook' }>, ctx: TemplateContext): Promise<void> {
    const body = renderTemplate(action.bodyTemplate, ctx);
    let target: URL;
    try {
      target = new URL(action.url);
    } catch {
      throw new Error('webhook: url is not a valid URL');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('webhook: url must be http(s)');
    }
    if (!this.opts.webhookAllowInsecureHosts) {
      await assertPublicHost(target, { resolve: this.opts.webhookResolveHost });
    }
    await sendWebhook(action.url, body);
  }

  private async dispatchMqtt(action: Extract<Action, { type: 'mqtt_publish' }>, ctx: TemplateContext): Promise<void> {
    const payload = renderTemplate(action.payloadTemplate, ctx);
    await this.getMqttSender().publish(action.topic, payload);
  }

  private getMqttSender(): MqttSender {
    if (this.opts.mqttSender) return this.opts.mqttSender;
    if (!this.ownedMqttSender) this.ownedMqttSender = new MqttSender(this.settings);
    return this.ownedMqttSender;
  }

  private dispatchWallBanner(action: Extract<Action, { type: 'wall_banner' }>, ctx: TemplateContext): void {
    const text = renderTemplate(action.text, ctx);
    this.bus.emit('wall_banner', { text, kind: action.kind, durationMs: action.durationMs });
  }

  private dispatchPartyMode(action: Extract<Action, { type: 'party_mode' }>): void {
    this.bus.emit('wall_theme_override', { minutes: action.minutes });
  }

  /** Task 8: `wallSlugs` present -> one `setState` call per named slug; ABSENT (not
   * merely empty) -> a single `setState(null, ...)` call, which `PresenceRegistry`
   * treats as "every zone" (see presence.ts's `setState`). An explicitly empty
   * `wallSlugs: []` -- not reachable via the schema (`.optional()`, no `.min(1)` at the
   * array level, but the admin builder never produces one) -- degenerates to zero calls,
   * not "every wall"; only OMITTING the field means "every wall". */
  private dispatchDisplayPower(action: Extract<Action, { type: 'display_power' }>): void {
    if (action.wallSlugs) {
      for (const slug of action.wallSlugs) this.presence.setState(slug, action.state);
    } else {
      this.presence.setState(null, action.state);
    }
  }

  /**
   * Kegtron.ResetVolume via mdash.net, for the triggering event's tap's bound Kegtron Pro
   * monitor -- per the plan, meaningful in a keg-swap context (a `keg_tapped`-triggered
   * rule resolves `ctx.tapId` to the tap the swap just happened on). Not hard-restricted
   * to `keg_tapped` triggers -- any trigger that resolves a `tapId` with a bound Pro
   * monitor works the same way -- but that's the trigger this action is DOCUMENTED to
   * pair with. Throws (logged by `dispatchActions`, other actions still run) when there's
   * no tap context, no bound Pro monitor, or no linked mdash device key -- same
   * validation `routes/kegtron.ts`'s reset-volume route performs.
   */
  private async dispatchResetVolume(ctx: EvalCtx): Promise<void> {
    if (ctx.tapId === null) {
      throw new Error('kegtron_reset_volume: no tap context for this trigger');
    }
    const monitor = listMonitors(this.db).find((m) => m.tapId === ctx.tapId && m.type === 'kegtron_pro');
    if (!monitor) {
      throw new Error(`kegtron_reset_volume: tap ${ctx.tapId} has no bound Kegtron Pro monitor`);
    }
    const deviceKey = monitor.meta?.deviceKey;
    if (typeof deviceKey !== 'string' || deviceKey.length === 0) {
      throw new Error('kegtron_reset_volume: monitor has no linked mdash device key (not cloud-discovered)');
    }
    const client = this.opts.mdashClientFactory
      ? this.opts.mdashClientFactory(this.settings)
      : new MdashClient({
          apiKey: this.settings.get('kegtronApiKey') ?? '', baseUrl: this.settings.get('kegtronBaseUrl'),
        });
    await client.callRpc(deviceKey, 'Kegtron.ResetVolume', { port: monitor.portIndex });
  }

  // --- EvalCtx builders ------------------------------------------------------------

  private buildTapEvalCtx(
    tapId: number | null, ts: string,
    extra: {
      monitorRef?: MonitorRef; levelPct?: number; volumeMl?: number;
      pour?: { volumeMl: number | null; durationMs: number | null; ts: string } | null;
    } = {},
  ): EvalCtx {
    const tapState = tapId !== null ? this.state.getTapStates().find((t) => t.tapId === tapId) ?? null : null;
    return {
      tapId,
      beerId: tapState?.beer?.id ?? null,
      levelPct: extra.levelPct ?? tapState?.keg?.levelPct ?? null,
      volumeMl: extra.volumeMl ?? null,
      temp: tapState?.temp ?? null,
      ts,
      monitorRef: extra.monitorRef ?? null,
      templateCtx: {
        beer: templateBeer(tapState?.beer),
        tap: templateTap(
          tapState ? { id: tapState.tapId, number: tapState.tapNumber, name: tapState.tapName } : null,
        ),
        keg: templateKeg(tapState?.keg),
        pour: templatePour(extra.pour),
        monitor: extra.monitorRef ? templateMonitor(extra.monitorRef, tapState?.temp ?? null, null) : null,
      },
    };
  }

  private buildMonitorEvalCtx(
    monitorRef: MonitorRef, tapId: number | null, ts: string,
    extra: { temp?: number; humidity?: number | null },
  ): EvalCtx {
    const tapState = tapId !== null ? this.state.getTapStates().find((t) => t.tapId === tapId) ?? null : null;
    const temp = extra.temp ?? tapState?.temp ?? null;
    return {
      tapId,
      beerId: tapState?.beer?.id ?? null,
      levelPct: tapState?.keg?.levelPct ?? null,
      volumeMl: null,
      temp,
      ts,
      monitorRef,
      templateCtx: {
        beer: templateBeer(tapState?.beer),
        tap: templateTap(
          tapState ? { id: tapState.tapId, number: tapState.tapNumber, name: tapState.tapName } : null,
        ),
        keg: templateKeg(tapState?.keg),
        pour: null,
        monitor: templateMonitor(monitorRef, temp, extra.humidity ?? null),
      },
    };
  }

  private buildKegEvalCtx(tapId: number, kegId: number, ts: string): EvalCtx {
    const keg = getKeg(this.db, kegId);
    const beer = keg ? getBeer(this.db, keg.beerId) : null;
    const tap = getTap(this.db, tapId);
    const levelPct = keg ? computeLevelPct(keg.volStartMl, keg.volDispensedMl) : null;
    return {
      tapId, beerId: beer?.id ?? null, levelPct, volumeMl: null, temp: null, ts, monitorRef: null,
      templateCtx: {
        beer: templateBeer(beer),
        tap: templateTap(tap ? { id: tap.id, number: tap.number, name: tap.name } : null),
        keg: keg
          ? templateKeg({ ...keg, levelPct: levelPct!, remainingMl: computeRemainingMl(keg.volStartMl, keg.volDispensedMl) })
          : null,
        pour: null,
        monitor: null,
      },
    };
  }

  private buildGlobalEvalCtx(ts: string): EvalCtx {
    return {
      tapId: null, beerId: null, levelPct: null, volumeMl: null, temp: null, ts, monitorRef: null,
      templateCtx: { beer: null, tap: null, keg: null, pour: null, monitor: null },
    };
  }

  /** Task 8: `motion_detected`/`display_power_changed` ctx builder -- neither resolves a
   * tap, beer, or monitor (there is no `TemplateContext` field for "which wall" yet, so
   * `templateCtx` is the same all-null shape `buildGlobalEvalCtx` uses), but both stamp
   * `wallSlug` for the `wall_scope` condition and `entityKeyFor`'s `wall:{slug}` keying.
   * `wallSlug: null` (motion with no zone context, e.g. a pour-triggered wake) collapses
   * to `undefined` -- `ConditionEvalCtx.wallSlug` is `string | undefined`, matching every
   * other "not applicable" field's convention in that interface. */
  private buildWallEvalCtx(wallSlug: string | null, ts: string): EvalCtx {
    return {
      tapId: null, beerId: null, levelPct: null, volumeMl: null, temp: null, ts, monitorRef: null,
      wallSlug: wallSlug ?? undefined,
      templateCtx: { beer: null, tap: null, keg: null, pour: null, monitor: null },
    };
  }

  /**
   * `runRuleOnce`'s fabricated ctx -- there is no real triggering event for a manual
   * test-run, so every `{{...}}` template placeholder still needs SOMETHING plausible to
   * resolve against (an all-null ctx would render every placeholder as '', making the
   * test-run result useless for previewing a rule's notify/webhook/mqtt body). Values are
   * representative sample data, not tied to any real row in the DB (`id: 0` throughout).
   * `tapId`/`monitorRef` are deliberately `null` -- a test-run has no real tap/monitor
   * context, so a `kegtron_reset_volume` action correctly fails here the same honest way
   * it would for any trigger that doesn't resolve a tap.
   */
  private buildSyntheticEvalCtx(): EvalCtx {
    const ts = new Date().toISOString();
    return {
      tapId: null, beerId: null, levelPct: 50, volumeMl: 355, temp: 4, ts, monitorRef: null,
      templateCtx: {
        beer: {
          id: 0, name: 'Sample Beer', brewery: 'Sample Brewery', style: 'IPA',
          abv: 6.5, ibu: 40, srm: 8, description: null, label_image: null,
        },
        tap: { id: 0, number: 1, name: 'Sample Tap' },
        keg: {
          id: 0, size_ml: 19000, vol_start_ml: 19000, vol_dispensed_ml: 9500,
          level_pct: 50, remaining_ml: 9500, date_tapped: null, status: 'on_tap',
        },
        pour: { volume_ml: 355, duration_ms: 4200, ts },
        monitor: {
          type: 'kegtron_pro', identifier: 'sample', port_index: 0, temp: 4, humidity: 45,
        },
      },
    };
  }
}
