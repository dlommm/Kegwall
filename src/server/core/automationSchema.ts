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
  z.object({
    type: z.literal('schedule'),
    time: timeOfDaySchema,
    weekdays: z.array(weekdaySchema),
  }),
  z.object({ type: z.literal('app_startup') }),
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
    topic: z.string().min(1),
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
