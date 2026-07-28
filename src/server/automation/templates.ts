import { z } from 'zod';
import type { AutomationRuleInput } from '../core/automationSchema.js';

// ---------------------------------------------------------------------------
// Phase 5 Task 4: the 9 one-click alert templates named in the plan's binding semantics
// ("Alert triggers shipped as one-click templates: keg low..., keg kicked, servings-
// remaining below N, device offline > N min, temp out of range, humidity out of range,
// possible leak..., cleaning due..., new keg tapped"). `POST /api/automations/from-
// template` (routes/automations.ts) drives this catalog; `GET /api/automations/templates`
// exposes `TEMPLATES.map(...)`'s id/label/description/params for the (future, Task 6)
// admin UI's template picker.
//
// Every template's `build()` returns an ARRAY of `AutomationRuleInput` (not a single
// rule) -- most templates produce exactly one, but `temp_out_of_range`/
// `humidity_out_of_range` each need TWO independent rules (one `*_crosses` trigger per
// direction/threshold; a single `AutomationRule` has exactly one trigger, so "out of
// range" -- two bounds -- cannot be one rule). Making every template's return shape an
// array keeps `from-template`'s route logic uniform (always `inputs.map(createAutomation)`)
// instead of a special case for the two multi-rule templates.
//
// Every template's example action is a plain `notify` -> `inApp` (title/body templated
// with `{{beer.name}}`/`{{tap.number}}`/etc, per the plan's documented variable names --
// see notify/template.ts / automation/engine.ts's TemplateContext mapping). A future
// admin UI (Task 6) editing the created rule can add/replace actions same as any other
// rule; the template only seeds a sane starting point.
//
// Honest v1 limitations (each documented again at its template below, and in the Task 4
// report):
//   - `device_offline`'s `minutes` param is accepted/validated but NOT enforced -- the
//     rule fires immediately on the raw `device_offline` bus event. "For N minutes"
//     would need a delayed/debounced trigger the engine doesn't have (Task 3 shipped
//     `device_offline` as an immediate discrete trigger, matching every other discrete
//     trigger kind). Flagged inline, in the template's own `description`, and in the
//     Task 4 report per the plan's explicit "document honest limitation" instruction.
//   - `possible_leak` only implements the volume variant ("pour > N mL"); the spec's
//     alternate "or flow > N s" has no `duration_ms` condition field to express it
//     against (`ConditionEvalCtx`/`value_compare`'s `field` enum only has level_pct/
//     volume_ml/temp) -- dropped, same "acceptable v1" pattern as device_offline's
//     minutes.
//   - `servings_remaining` translates "N servings" into a `keg_level_crosses` PERCENT
//     threshold at TEMPLATE-INSTANTIATION time, using an assumed `kegSizeMl` param
//     (default 19000 -- a common full-size keg, matching seed.ts's own kegs) --
//     `keg_level_crosses` is percent-based and has no live "remaining volume" concept, so
//     if the tap's actual keg size later differs from the assumed one (a different keg
//     swapped in), the threshold no longer corresponds to exactly N servings. Documented
//     in the template's own description; not fixed here (would need a new
//     volume-denominated trigger kind, out of this task's scope).
// ---------------------------------------------------------------------------

export interface TemplateParamMeta {
  name: string;
  label: string;
  type: 'number' | 'string';
  default?: number | string;
  min?: number;
  max?: number;
}

/** Extra context a template's `build()` needs beyond its own params -- currently just the
 * site's configured serving size (`settings.servingSizeMl`), which `servings_remaining`
 * uses to translate "N servings" into a volume. `routes/automations.ts`'s `from-template`
 * handler supplies this from `app.ctx.settings`. */
export interface TemplateBuildCtx {
  servingSizeMl: number;
}

export interface AlertTemplate<P = any> {
  id: string;
  label: string;
  description: string;
  /** Metadata for a param-form UI (Task 6) -- `paramsSchema` below is the actual source
   * of truth for validation; this is a rendering hint list, kept in sync by convention
   * (`tests/automation/templates.test.ts` checks every listed param round-trips through
   * `paramsSchema`). */
  params: TemplateParamMeta[];
  paramsSchema: z.ZodType<P>;
  build(params: P, ctx: TemplateBuildCtx): AutomationRuleInput[];
}

const NOTIFY_IN_APP = (title: string, body: string) => ({
  type: 'notify' as const, channels: ['inApp'], title, body,
});

// --- 1. keg_low -------------------------------------------------------------------

const kegLowParams = z.object({
  thresholdPct: z.number().min(1).max(99).default(15),
});

const kegLowTemplate: AlertTemplate<z.infer<typeof kegLowParams>> = {
  id: 'keg_low',
  label: 'Keg low',
  description: 'Alert when a keg drops below a level percentage.',
  params: [
    {
      name: 'thresholdPct', label: 'Threshold %', type: 'number', default: 15, min: 1, max: 99,
    },
  ],
  paramsSchema: kegLowParams,
  build: ({ thresholdPct }) => [{
    name: `Keg low (below ${thresholdPct}%)`,
    isAlert: true,
    trigger: { type: 'keg_level_crosses', thresholdPct, direction: 'below' },
    conditions: [],
    actions: [NOTIFY_IN_APP(
      'Keg running low',
      '{{beer.name}} on tap {{tap.number}} is down to {{keg.level_pct}}%',
    )],
    alertConfig: {
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
    },
  }],
};

// --- 2. keg_kicked ------------------------------------------------------------------

const kegKickedParams = z.object({});

const kegKickedTemplate: AlertTemplate<z.infer<typeof kegKickedParams>> = {
  id: 'keg_kicked',
  label: 'Keg kicked',
  description: 'Alert whenever a keg is marked kicked.',
  params: [],
  paramsSchema: kegKickedParams,
  build: () => [{
    name: 'Keg kicked',
    isAlert: true,
    trigger: { type: 'keg_kicked' },
    conditions: [],
    // autoResolve: true -- the engine resolves a keg_kicked alert on the SAME tap's next
    // keg_tapped event (automation/engine.ts's documented device/keg-lifecycle pairing).
    actions: [NOTIFY_IN_APP('Keg kicked', '{{beer.name}} on tap {{tap.number}} just kicked')],
    alertConfig: {
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
    },
  }],
};

// --- 3. servings_remaining ----------------------------------------------------------

const servingsRemainingParams = z.object({
  servings: z.number().int().positive().default(5),
  // See this file's top doc comment: an ASSUMED keg size, used only to translate
  // "servings" into a percent threshold at template-instantiation time.
  kegSizeMl: z.number().int().positive().default(19000),
});

const servingsRemainingTemplate: AlertTemplate<z.infer<typeof servingsRemainingParams>> = {
  id: 'servings_remaining',
  label: 'Servings remaining below N',
  description: 'Alert when roughly N servings are left, estimated from the site’s '
    + 'serving size and an assumed keg size at the time this rule is created. Approximate: '
    + 'if a differently-sized keg is later tapped on the same tap, the threshold no longer '
    + 'corresponds to exactly N servings.',
  params: [
    {
      name: 'servings', label: 'Servings remaining', type: 'number', default: 5, min: 1,
    },
    {
      name: 'kegSizeMl', label: 'Assumed keg size (mL)', type: 'number', default: 19000, min: 1000,
    },
  ],
  paramsSchema: servingsRemainingParams,
  build: ({ servings, kegSizeMl }, { servingSizeMl }) => {
    const thresholdPct = Math.min(99, Math.max(1, Math.round((servings * servingSizeMl / kegSizeMl) * 100)));
    return [{
      name: `Servings remaining below ${servings}`,
      isAlert: true,
      trigger: { type: 'keg_level_crosses', thresholdPct, direction: 'below' },
      conditions: [],
      actions: [NOTIFY_IN_APP(
        'Low on servings',
        `Roughly ${servings} servings left of {{beer.name}} on tap {{tap.number}}`,
      )],
      alertConfig: {
        cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
      },
    }];
  },
};

// --- 4. device_offline ---------------------------------------------------------------

const deviceOfflineParams = z.object({
  minutes: z.number().int().positive().default(5),
});

const deviceOfflineTemplate: AlertTemplate<z.infer<typeof deviceOfflineParams>> = {
  id: 'device_offline',
  label: 'Device offline',
  description: 'Alert when a Kegtron monitor goes offline. Note: fires immediately on the '
    + 'offline event -- the "minutes" delay is accepted but not currently enforced by the '
    + 'engine (device_offline has no debounce/delay trigger support yet).',
  params: [
    {
      name: 'minutes', label: 'Minutes offline before alerting (not yet enforced)', type: 'number', default: 5, min: 1,
    },
  ],
  paramsSchema: deviceOfflineParams,
  // `minutes` is intentionally unused in the built rule -- see this file's top doc
  // comment and the template's own `description` above.
  build: () => [{
    name: 'Device offline',
    isAlert: true,
    trigger: { type: 'device_offline' },
    conditions: [],
    actions: [NOTIFY_IN_APP('Monitor offline', 'A Kegtron monitor on tap {{tap.number}} went offline')],
    alertConfig: {
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
    },
  }],
};

// --- 5. temp_out_of_range --------------------------------------------------------------

const tempOutOfRangeParams = z.object({
  minTemp: z.number().default(1),
  maxTemp: z.number().default(8),
}).refine((p) => p.minTemp < p.maxTemp, { message: 'minTemp must be less than maxTemp', path: ['minTemp'] });

const tempOutOfRangeTemplate: AlertTemplate<z.infer<typeof tempOutOfRangeParams>> = {
  id: 'temp_out_of_range',
  label: 'Temp out of range',
  description: 'Alert when temperature goes above or below a range. Creates two rules '
    + '(one per bound), since a single automation rule has one trigger.',
  params: [
    { name: 'minTemp', label: 'Min temp (°C)', type: 'number', default: 1 },
    { name: 'maxTemp', label: 'Max temp (°C)', type: 'number', default: 8 },
  ],
  paramsSchema: tempOutOfRangeParams,
  build: ({ minTemp, maxTemp }) => [
    {
      name: `Temp above ${maxTemp}°C`,
      isAlert: true,
      trigger: { type: 'temp_crosses', value: maxTemp, direction: 'above' },
      conditions: [],
      actions: [NOTIFY_IN_APP('Temp out of range', 'Tap {{tap.number}} is at {{monitor.temp}}°C (above range)')],
      alertConfig: {
        cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
      },
    },
    {
      name: `Temp below ${minTemp}°C`,
      isAlert: true,
      trigger: { type: 'temp_crosses', value: minTemp, direction: 'below' },
      conditions: [],
      actions: [NOTIFY_IN_APP('Temp out of range', 'Tap {{tap.number}} is at {{monitor.temp}}°C (below range)')],
      alertConfig: {
        cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
      },
    },
  ],
};

// --- 6. humidity_out_of_range -----------------------------------------------------------

const humidityOutOfRangeParams = z.object({
  minHumidity: z.number().default(20),
  maxHumidity: z.number().default(70),
}).refine((p) => p.minHumidity < p.maxHumidity, {
  message: 'minHumidity must be less than maxHumidity', path: ['minHumidity'],
});

const humidityOutOfRangeTemplate: AlertTemplate<z.infer<typeof humidityOutOfRangeParams>> = {
  id: 'humidity_out_of_range',
  label: 'Humidity out of range',
  description: 'Alert when humidity goes above or below a range. Creates two rules '
    + '(one per bound), since a single automation rule has one trigger.',
  params: [
    { name: 'minHumidity', label: 'Min humidity %', type: 'number', default: 20 },
    { name: 'maxHumidity', label: 'Max humidity %', type: 'number', default: 70 },
  ],
  paramsSchema: humidityOutOfRangeParams,
  build: ({ minHumidity, maxHumidity }) => [
    {
      name: `Humidity above ${maxHumidity}%`,
      isAlert: true,
      trigger: { type: 'humidity_crosses', value: maxHumidity, direction: 'above' },
      conditions: [],
      actions: [NOTIFY_IN_APP('Humidity out of range', 'Tap {{tap.number}} is at {{monitor.humidity}}% humidity (above range)')],
      alertConfig: {
        cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
      },
    },
    {
      name: `Humidity below ${minHumidity}%`,
      isAlert: true,
      trigger: { type: 'humidity_crosses', value: minHumidity, direction: 'below' },
      conditions: [],
      actions: [NOTIFY_IN_APP('Humidity out of range', 'Tap {{tap.number}} is at {{monitor.humidity}}% humidity (below range)')],
      alertConfig: {
        cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
      },
    },
  ],
};

// --- 7. possible_leak ------------------------------------------------------------------

const possibleLeakParams = z.object({
  volumeMl: z.number().int().positive().default(2000),
});

const possibleLeakTemplate: AlertTemplate<z.infer<typeof possibleLeakParams>> = {
  id: 'possible_leak',
  label: 'Possible leak',
  description: 'Alert when a single pour exceeds a volume threshold. Note: the spec’s '
    + 'alternate "or flow duration > N s" is not implemented -- there is no flow-duration '
    + 'condition field yet, only the volume variant.',
  params: [
    {
      name: 'volumeMl', label: 'Pour volume threshold (mL)', type: 'number', default: 2000, min: 100,
    },
  ],
  paramsSchema: possibleLeakParams,
  build: ({ volumeMl }) => [{
    name: `Possible leak (pour over ${volumeMl}mL)`,
    isAlert: true,
    trigger: { type: 'pour_completed' },
    conditions: [{ type: 'value_compare', field: 'volume_ml', op: 'gt', value: volumeMl }],
    actions: [NOTIFY_IN_APP(
      'Possible leak',
      'A {{pour.volume_ml}}mL pour was recorded on tap {{tap.number}} — check for a leak',
    )],
    alertConfig: {
      cooldownMinutes: 60,
      // pour_completed has no natural "cleared" counterpart (see automation/engine.ts's
      // top doc comment, point 3) -- explicit false is more honest than true-but-never-
      // resolves.
      autoResolve: false,
      notifyOnResolve: false,
      severity: 'critical',
    },
  }],
};

// --- 8. cleaning_due ---------------------------------------------------------------------

const cleaningDueParams = z.object({
  days: z.number().int().positive().default(30),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected time as HH:MM (24-hour)').default('09:00'),
});

const cleaningDueTemplate: AlertTemplate<z.infer<typeof cleaningDueParams>> = {
  id: 'cleaning_due',
  label: 'Cleaning due',
  description: 'Alert when a Kegtron Pro monitor hasn’t been marked cleaned in N days. '
    + 'Checked once daily at the configured time, per monitor.',
  params: [
    {
      name: 'days', label: 'Days since last cleaning', type: 'number', default: 30, min: 1,
    },
    {
      name: 'time', label: 'Check time (HH:MM)', type: 'string', default: '09:00',
    },
  ],
  paramsSchema: cleaningDueParams,
  build: ({ days, time }) => [{
    name: `Cleaning due (${days}+ days)`,
    isAlert: true,
    trigger: { type: 'schedule', time, weekdays: [] },
    conditions: [{ type: 'days_since_cleaned', days }],
    actions: [NOTIFY_IN_APP(
      'Cleaning due',
      `It has been over ${days} days since tap {{tap.number}} was last cleaned`,
    )],
    alertConfig: {
      cooldownMinutes: 1440,
      // schedule has no natural "cleared" counterpart either -- see possible_leak above.
      autoResolve: false,
      notifyOnResolve: false,
      severity: 'info',
    },
  }],
};

// --- 9. new_keg_tapped ---------------------------------------------------------------------

const newKegTappedParams = z.object({});

const newKegTappedTemplate: AlertTemplate<z.infer<typeof newKegTappedParams>> = {
  id: 'new_keg_tapped',
  label: 'New keg tapped',
  description: 'Post an info notification whenever a new keg goes on tap.',
  params: [],
  paramsSchema: newKegTappedParams,
  // NOT an alert (per the spec's own "(info)" parenthetical -- distinct from the other 8,
  // which are all warning/critical) -- a plain notify rule. The engine's `dispatchNotify`
  // already defaults a non-alert notify action's severity to 'info', so no `alertConfig`
  // is needed to get that outcome; cooldown/auto-resolve semantics don't apply to a
  // routine informational notice either.
  build: () => [{
    name: 'New keg tapped',
    isAlert: false,
    trigger: { type: 'keg_tapped' },
    conditions: [],
    actions: [NOTIFY_IN_APP('New keg tapped', '{{beer.name}} is now on tap {{tap.number}}')],
  }],
};

export const TEMPLATES: readonly AlertTemplate[] = [
  kegLowTemplate,
  kegKickedTemplate,
  servingsRemainingTemplate,
  deviceOfflineTemplate,
  tempOutOfRangeTemplate,
  humidityOutOfRangeTemplate,
  possibleLeakTemplate,
  cleaningDueTemplate,
  newKegTappedTemplate,
];

export function getTemplate(id: string): AlertTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
