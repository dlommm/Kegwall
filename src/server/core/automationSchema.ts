import { z } from 'zod';

/**
 * Zod schemas for the automation rule engine's `trigger` / `conditions[]` / `actions[]`
 * JSON shapes (Phase 5 Task 1). Kept dependency-free (only `zod`, a real npm package, not
 * another module of this app) for the exact reason `core/lookupTypes.ts` and
 * `core/wallConfig.ts` are: `src/web/lib/adminApi.ts` (and, from Task 6 on, the
 * automations admin UI) type-imports `AutomationRule` and friends from here, and
 * `tsconfig.web.json` compiles that import's WHOLE module graph — a routes-file or
 * Fastify-augmented import here would break the web typecheck. See `lookupTypes.ts`'s doc
 * comment for the full story.
 *
 * DB column mapping (owned by `db/automations.ts`, NOT this file): the `automations`
 * table (migration 001) has exactly three JSON columns — `trigger`, `conditions`,
 * `actions` — and no column for `alertConfig`. Rather than a migration to add one, an
 * `AutomationRule`'s optional `alertConfig` is folded into the `trigger` COLUMN's JSON as
 * an envelope: `{ trigger: <Trigger>, alertConfig?: <AlertConfig> }`. `conditions` and
 * `actions` columns store their arrays directly (matching the columns' own `'[]'`
 * defaults). This file only defines the shapes; `db/automations.ts` is the sole owner of
 * that envelope encode/decode, so nothing outside the repo layer needs to know the
 * `trigger` column isn't just a bare `Trigger`.
 */

/** `HH:MM`, 24-hour, zero-padded — used by both the `schedule` trigger and the
 * `time_window` condition. */
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected time as HH:MM (24-hour)');

/** 0 (Sunday) through 6 (Saturday), matching JS `Date#getDay()` — used by both the
 * `schedule` trigger and the `weekday` condition. */
const weekdaySchema = z.number().int().min(0).max(6);

const crossDirectionSchema = z.enum(['below', 'above']);

/** Display power state, mirroring `core/events.ts`'s `PowerState` -- kept as its own
 * literal enum here (not imported) per this file's dependency-free constraint (see top
 * doc comment); the two must be kept in sync by hand. Shared by the
 * `display_power_changed` trigger's optional `state` filter and the `display_power`
 * action's target state (Task 8, presence/display-power framework). */
const powerStateSchema = z.enum(['active', 'screensaver', 'off']);

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pour_completed') }),
  z.object({ type: z.literal('pour_started') }),
  z.object({
    type: z.literal('keg_level_crosses'),
    thresholdPct: z.number().min(0).max(100),
    direction: crossDirectionSchema,
  }),
  z.object({ type: z.literal('keg_kicked') }),
  z.object({ type: z.literal('keg_tapped') }),
  z.object({ type: z.literal('device_online') }),
  z.object({ type: z.literal('device_offline') }),
  z.object({
    type: z.literal('temp_crosses'),
    value: z.number(),
    direction: crossDirectionSchema,
  }),
  // Phase 5 Task 4: sibling of `temp_crosses` above, not a merged/generic
  // `telemetry_crosses {field: 'temp'|'humidity', ...}` — see the Task 4 report's "my
  // call" note. `telemetry` events already carry both `temp` and `humidity`
  // independently (core/events.ts), and the engine's per-kind trigger-matching loop
  // pattern (one bus handler, one `switch`-style `rule.trigger.type !== '...'` filter per
  // kind) is duplicated cheaply for a second field rather than generalized — a generic
  // `field` union would also touch every `crossed`/`opposite` call site and both
  // `TemplateContext` monitor-mapping helpers for one extra trigger kind, which isn't
  // worth the abstraction yet with only two fields in play.
  z.object({
    type: z.literal('humidity_crosses'),
    value: z.number(),
    direction: crossDirectionSchema,
  }),
  z.object({
    type: z.literal('schedule'),
    time: timeOfDaySchema,
    weekdays: z.array(weekdaySchema),
  }),
  z.object({ type: z.literal('app_startup') }),
  // Task 8 (presence/display-power framework): both MOMENTARY -- no auto-resolve
  // counterpart (see engine.ts's top doc comment, point 3). `motion_detected` fires on
  // every debounced wake signal `PresenceRegistry.motion()` emits; `display_power_changed`
  // fires on every zone state transition `PresenceRegistry`'s `transition()` emits -- that
  // method's own no-op-when-state-is-unchanged guard is what keeps a rule's own
  // `display_power` action from re-triggering itself in a loop, so this trigger needs no
  // extra guard of its own. Neither carries wall-scoping directly -- pair with the
  // `wall_scope` condition below for that (same precedent as `tap_scope`/`beer_scope`
  // being conditions rather than trigger-embedded fields).
  z.object({ type: z.literal('motion_detected') }),
  z.object({
    type: z.literal('display_power_changed'),
    state: powerStateSchema.optional(), // absent = matches any transition
  }),
]);

export type Trigger = z.infer<typeof TriggerSchema>;

export const ConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tap_scope'), tapIds: z.array(z.number().int()) }),
  z.object({ type: z.literal('beer_scope'), beerIds: z.array(z.number().int()) }),
  z.object({ type: z.literal('time_window'), start: timeOfDaySchema, end: timeOfDaySchema }),
  z.object({ type: z.literal('weekday'), days: z.array(weekdaySchema) }),
  z.object({
    type: z.literal('value_compare'),
    field: z.enum(['level_pct', 'volume_ml', 'temp']),
    op: z.enum(['lt', 'lte', 'gt', 'gte']),
    value: z.number(),
  }),
  z.object({ type: z.literal('min_interval'), minutes: z.number().int().positive() }),
  // Phase 5 Task 4 (cleaning-due template ledger note): `value_compare`/the rest of
  // `ConditionEvalCtx` has no notion of a monitor's Kegtron-reported `dateCleaned` (it's
  // per-MONITOR device-shadow data, not a per-EVENT sample like level%/temp), so this is
  // its own condition kind rather than a `value_compare` field. Evaluated against
  // `ConditionEvalCtx.daysSinceCleaned`, which the ENGINE computes (per monitor, from
  // `monitors.meta.dateCleaned` — see shadow.ts) and stamps onto the eval context before
  // calling `evaluateConditions` — this file/`conditions.ts` stay dependency-free (no db
  // access), matching every other condition here. True when at least `days` have elapsed
  // since the monitor's last recorded cleaning (i.e. "cleaning is due" / overdue).
  z.object({ type: z.literal('days_since_cleaned'), days: z.number().int().positive() }),
  // Task 8: true iff the triggering event's wall context (currently only
  // `motion_detected`/`display_power_changed` resolve one -- see conditions.ts's
  // `ConditionEvalCtx.wallSlug`) is one of `wallSlugs`; false when the event has no wall
  // context at all. `.min(1)` here, UNLIKE `tap_scope`/`beer_scope`'s empty-array-means-
  // unrestricted convention -- an empty scope has no "match every wall" reading a rule
  // author would actually want; that's just "don't add this condition".
  z.object({ type: z.literal('wall_scope'), wallSlugs: z.array(z.string().min(1)).min(1) }),
]);

export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('notify'),
    channels: z.array(z.string().min(1)).min(1),
    title: z.string(),
    body: z.string(), // templated: {{beer.name}}, {{tap.number}}, etc. (Task 2's renderTemplate)
  }),
  z.object({
    type: z.literal('webhook'),
    url: z.string().url(),
    bodyTemplate: z.string(),
  }),
  z.object({
    type: z.literal('mqtt_publish'),
    // A PUBLISH topic must be concrete: `+`/`#` are subscription wildcards, a leading `$`
    // addresses broker-reserved system topics, and control chars (NUL/CR/LF/TAB) are topic
    // injection. (Publishing to an arbitrary non-reserved topic stays allowed by design —
    // mqtt_publish exists to integrate with Home Assistant and other brokers.)
    topic: z.string().min(1).refine(
      (t) => !/[+#\u0000-\u001f\u007f]/.test(t) && !t.startsWith('$'),
      { message: 'mqtt topic must be concrete (no +/# wildcards, no leading $, no control chars)' },
    ),
    payloadTemplate: z.string(),
  }),
  z.object({
    type: z.literal('wall_banner'),
    text: z.string(), // templated
    kind: z.enum(['info', 'celebrate', 'warning']),
    durationMs: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal('party_mode'), minutes: z.number().int().positive() }),
  z.object({ type: z.literal('kegtron_reset_volume') }),
  // Task 8: sets a wall's (or, when `wallSlugs` is absent, every wall's) display power
  // state directly via `PresenceRegistry.setState` -- an explicit-hold override that
  // bypasses the idle timers entirely, same as an admin's manual override (see
  // core/presence.ts's own `setState` doc comment: "no schedule(): an explicit state
  // holds until the next motion"). Loop safety is `setState`'s callee-side no-op-when-
  // already-in-that-state guard, not anything this action needs to implement itself.
  z.object({
    type: z.literal('display_power'),
    state: powerStateSchema,
    wallSlugs: z.array(z.string().min(1)).optional(), // absent = every wall
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

/** Alert-only config (`isAlert: true` rules). No column of its own — see this file's top
 * doc comment for how `db/automations.ts` folds it into the `trigger` column's JSON. */
export const AlertConfigSchema = z.object({
  cooldownMinutes: z.number().int().positive().default(60),
  autoResolve: z.boolean().default(true),
  notifyOnResolve: z.boolean().default(false),
  severity: z.enum(['info', 'warning', 'critical']), // matches notifications.severity CHECK
});

export type AlertConfig = z.infer<typeof AlertConfigSchema>;

/**
 * The full logical shape of an automation rule, `id`/`lastFiredAt` aside (those are
 * DB-assigned/DB-owned, not part of what a caller writes — see `AutomationRuleInput`
 * below). `isAlert: true` requires `alertConfig`: cooldown/auto-resolve/severity are
 * meaningless without it, and Task 3's engine will key its per-rule alert state off
 * `alertConfig` being present. This refinement is a deliberate design choice by this
 * task's implementer (the plan left the isAlert/alertConfig relationship unspecified) —
 * flagged here and in the Task 1 report for the coordinator's awareness.
 */
export const AutomationRuleConfigSchema = z
  .object({
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    isAlert: z.boolean().default(false),
    trigger: TriggerSchema,
    conditions: z.array(ConditionSchema).default([]),
    actions: z.array(ActionSchema).default([]),
    alertConfig: AlertConfigSchema.optional(),
  })
  .refine((r) => !r.isAlert || r.alertConfig !== undefined, {
    message: 'isAlert rules require alertConfig',
    path: ['alertConfig'],
  });

/** Parsed/defaulted output shape — `enabled`, `isAlert`, `conditions`, `actions` are
 * always present even if the caller omitted them. */
export type AutomationRuleConfig = z.infer<typeof AutomationRuleConfigSchema>;

/** What a caller passes to `db/automations.ts`'s `createAutomation`/`updateAutomation` —
 * the PRE-default shape (`z.input`, not `z.infer`/`z.output`): only `name` and `trigger`
 * are required; `enabled`/`isAlert`/`conditions`/`actions`/`alertConfig` are all optional,
 * matching `AutomationRuleConfigSchema`'s `.default(...)`s. Deliberately derived from the
 * schema rather than hand-duplicated as an `Omit<AutomationRule, ...>` — the schema is the
 * single source of truth for which fields are optional on write. */
export type AutomationRuleInput = z.input<typeof AutomationRuleConfigSchema>;

/** A fully-loaded automation rule, as returned by `db/automations.ts`'s `rowToRule`. Same
 * fields as `AutomationRuleConfig` plus the two DB-owned ones no `z.input` ever carries. */
export interface AutomationRule extends AutomationRuleConfig {
  id: number;
  lastFiredAt: string | null;
}
