import type { ZodIssue } from 'zod';
import {
  AutomationRuleConfigSchema,
  type Trigger, type Condition, type Action, type AlertConfig,
  type AutomationRuleInput, type AutomationRuleConfig,
} from '../../server/core/automationSchema.js';

/**
 * The automations builder's critical logic (Task 6), mirroring `wallEditorConfig.ts`'s
 * exact shape/precedent: a pure, React-free mapping between the builder's form state and
 * `AutomationRuleConfig`, validated on the way out by importing and calling the REAL
 * `AutomationRuleConfigSchema` (same schema `db/automations.ts` enforces server-side) —
 * so a save can never reach the server with a shape it would reject, and every validation
 * failure surfaces as a friendly, field-naming message before the request is even sent.
 * `automationSchema.ts` is dependency-free (only `zod`), the same deliberate design as
 * `wallConfig.ts` — safe to import as a VALUE here (see that file's own top doc comment).
 *
 * WallEditor's card-template-switch lesson applies here too, in three places: switching a
 * trigger's kind (the trigger picker), a condition's kind, or an action's kind must
 * REPLACE that item wholesale with the new kind's schema-valid defaults (`defaultTrigger`/
 * `defaultCondition`/`defaultAction` below) rather than merging fields — otherwise a kind
 * switch could silently carry over a field name the new kind doesn't have (harmless, zod
 * strips unknown keys) while leaving the new kind's OWN required fields unset (not
 * harmless — a save would then either 400 or, worse, silently coerce to a wrong default).
 */

export interface AlertConfigFormState {
  cooldownMinutes: number;
  autoResolve: boolean;
  notifyOnResolve: boolean;
  severity: AlertConfig['severity'];
}

export interface AutomationFormState {
  name: string;
  enabled: boolean;
  isAlert: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  /** Always populated (even when `isAlert` is false) so toggling "this is an alert" on
   * never starts from nothing — see `formStateToRuleCandidate`, which only includes this
   * in the candidate object when `isAlert` is true. */
  alertConfig: AlertConfigFormState;
}

// --- kind lists + labels (sentence case) -----------------------------------------

export const TRIGGER_KINDS: readonly Trigger['type'][] = [
  'pour_completed', 'pour_started', 'keg_level_crosses', 'keg_kicked', 'keg_tapped',
  'device_online', 'device_offline', 'temp_crosses', 'humidity_crosses', 'schedule', 'app_startup',
  // Task 8 (presence/display-power framework):
  'motion_detected', 'display_power_changed',
];

export const TRIGGER_LABELS: Record<Trigger['type'], string> = {
  pour_completed: 'Pour completed',
  pour_started: 'Pour started',
  keg_level_crosses: 'Keg level crosses a threshold',
  keg_kicked: 'Keg kicked',
  keg_tapped: 'Keg tapped',
  device_online: 'Device comes online',
  device_offline: 'Device goes offline',
  temp_crosses: 'Temperature crosses a value',
  humidity_crosses: 'Humidity crosses a value',
  schedule: 'Schedule',
  app_startup: 'App startup',
  motion_detected: 'Motion detected',
  display_power_changed: 'Display power changed',
};

export const CONDITION_KINDS: readonly Condition['type'][] = [
  'tap_scope', 'beer_scope', 'time_window', 'weekday', 'value_compare', 'min_interval', 'days_since_cleaned',
  // Task 8 (presence/display-power framework):
  'wall_scope',
];

export const CONDITION_LABELS: Record<Condition['type'], string> = {
  tap_scope: 'Limit to taps',
  beer_scope: 'Limit to beers',
  time_window: 'Time window',
  weekday: 'Weekday',
  value_compare: 'Value comparison',
  min_interval: 'Minimum time since last fire',
  days_since_cleaned: 'Days since cleaned',
  wall_scope: 'Wall scope',
};

export const ACTION_KINDS: readonly Action['type'][] = [
  'notify', 'webhook', 'mqtt_publish', 'wall_banner', 'party_mode', 'kegtron_reset_volume',
  // Task 8 (presence/display-power framework):
  'display_power',
];

export const ACTION_LABELS: Record<Action['type'], string> = {
  notify: 'Send notification',
  webhook: 'Webhook',
  mqtt_publish: 'MQTT publish',
  wall_banner: 'Wall banner',
  party_mode: 'Party mode',
  kegtron_reset_volume: 'Reset keg volume counter',
  display_power: 'Set display power',
};

export const DISPLAY_POWER_STATE_LABELS: Record<Extract<Action, { type: 'display_power' }>['state'], string> = {
  active: 'Active', screensaver: 'Screensaver', off: 'Off',
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const VALUE_COMPARE_FIELD_LABELS: Record<Extract<Condition, { type: 'value_compare' }>['field'], string> = {
  level_pct: 'Keg level %',
  volume_ml: 'Pour volume (mL)',
  temp: 'Temperature',
};

export const VALUE_COMPARE_OP_LABELS: Record<Extract<Condition, { type: 'value_compare' }>['op'], string> = {
  lt: 'is less than',
  lte: 'is at most',
  gt: 'is greater than',
  gte: 'is at least',
};

export const WALL_BANNER_KIND_LABELS: Record<Extract<Action, { type: 'wall_banner' }>['kind'], string> = {
  info: 'Info', celebrate: 'Celebrate', warning: 'Warning',
};

export const SEVERITY_LABELS: Record<AlertConfig['severity'], string> = {
  info: 'Info', warning: 'Warning', critical: 'Critical',
};

/** A curated, representative subset of `notify/template.ts`'s full `{{beer, tap, keg,
 * pour, monitor, alert}}` template context (see `engine.ts`'s `buildSyntheticEvalCtx` for
 * the exhaustive field list) — every templated string field (notify title/body, webhook
 * body, MQTT payload, wall banner text) gets these as clickable "insert" hint chips. Not
 * exhaustive by design: a full ~25-variable list would overwhelm the affordance; this set
 * covers the plan's own named examples (`{{beer.name}}`, `{{tap.number}}`,
 * `{{pour.volume_ml}}`, `{{keg.level_pct}}`) plus the next-most-useful handful. */
export const TEMPLATE_VARIABLE_HINTS: readonly string[] = [
  '{{beer.name}}', '{{beer.brewery}}', '{{beer.style}}', '{{beer.abv}}',
  '{{tap.number}}', '{{tap.name}}',
  '{{keg.level_pct}}', '{{keg.remaining_ml}}',
  '{{pour.volume_ml}}',
  '{{monitor.temp}}', '{{monitor.humidity}}',
  '{{alert.name}}',
];

// --- defaults, keyed by kind ------------------------------------------------------

export function defaultTrigger(kind: Trigger['type']): Trigger {
  switch (kind) {
    case 'pour_completed': return { type: 'pour_completed' };
    case 'pour_started': return { type: 'pour_started' };
    case 'keg_level_crosses': return { type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' };
    case 'keg_kicked': return { type: 'keg_kicked' };
    case 'keg_tapped': return { type: 'keg_tapped' };
    case 'device_online': return { type: 'device_online' };
    case 'device_offline': return { type: 'device_offline' };
    case 'temp_crosses': return { type: 'temp_crosses', value: 4, direction: 'above' };
    case 'humidity_crosses': return { type: 'humidity_crosses', value: 50, direction: 'above' };
    case 'schedule': return { type: 'schedule', time: '09:00', weekdays: [] };
    case 'app_startup': return { type: 'app_startup' };
    case 'motion_detected': return { type: 'motion_detected' };
    case 'display_power_changed': return { type: 'display_power_changed' };
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown trigger kind: ${String(_exhaustive)}`);
    }
  }
}

export function defaultCondition(kind: Condition['type']): Condition {
  switch (kind) {
    case 'tap_scope': return { type: 'tap_scope', tapIds: [] };
    case 'beer_scope': return { type: 'beer_scope', beerIds: [] };
    case 'time_window': return { type: 'time_window', start: '22:00', end: '08:00' };
    case 'weekday': return { type: 'weekday', days: [] };
    case 'value_compare': return {
      type: 'value_compare', field: 'level_pct', op: 'lt', value: 0,
    };
    case 'min_interval': return { type: 'min_interval', minutes: 60 };
    case 'days_since_cleaned': return { type: 'days_since_cleaned', days: 30 };
    case 'wall_scope': return { type: 'wall_scope', wallSlugs: [] };
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown condition kind: ${String(_exhaustive)}`);
    }
  }
}

export function defaultAction(kind: Action['type']): Action {
  switch (kind) {
    // Defaults to `['inApp']` (always usable, no config required) rather than `[]` — an
    // empty `channels` array is schema-INVALID (`ActionSchema`'s `.min(1)`), so a bare
    // "add a notify action" would otherwise start the builder in an already-broken state.
    case 'notify': return {
      type: 'notify', channels: ['inApp'], title: '', body: '',
    };
    case 'webhook': return { type: 'webhook', url: '', bodyTemplate: '' };
    case 'mqtt_publish': return { type: 'mqtt_publish', topic: '', payloadTemplate: '' };
    case 'wall_banner': return { type: 'wall_banner', text: '', kind: 'info' };
    case 'party_mode': return { type: 'party_mode', minutes: 15 };
    case 'kegtron_reset_volume': return { type: 'kegtron_reset_volume' };
    // `wallSlugs` omitted (not `[]`) -- "every wall", a genuinely usable-as-is default,
    // unlike `wall_scope`'s condition-side default above (see this file's own doc comment
    // point about `wall_scope`'s no-honest-empty-default carve-out; the ACTION side has no
    // such problem since omitting `wallSlugs` is itself meaningful, not "no restriction").
    case 'display_power': return { type: 'display_power', state: 'active' };
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown action kind: ${String(_exhaustive)}`);
    }
  }
}

export function defaultAlertConfig(): AlertConfigFormState {
  return {
    cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
  };
}

/** The form state a brand-new "blank rule" starts from. */
export function blankFormState(): AutomationFormState {
  return {
    name: '',
    enabled: true,
    isAlert: false,
    trigger: defaultTrigger('pour_completed'),
    conditions: [],
    actions: [],
    alertConfig: defaultAlertConfig(),
  };
}

/** Deserializer: a loaded rule (from `GET /api/automations/:id`, or a freshly-built
 * `AutomationRuleConfig` from a template) -> the builder's flat form state. `alertConfig`
 * defaults (rather than being left undefined) so switching "this is an alert" on later
 * doesn't start from nothing. */
export function ruleToFormState(rule: AutomationRuleConfig): AutomationFormState {
  return {
    name: rule.name,
    enabled: rule.enabled,
    isAlert: rule.isAlert,
    trigger: rule.trigger,
    conditions: [...rule.conditions],
    actions: [...rule.actions],
    alertConfig: rule.alertConfig ? { ...rule.alertConfig } : defaultAlertConfig(),
  };
}

/** Serializer: form state -> a plain candidate object shaped for
 * `AutomationRuleConfigSchema`, NOT yet validated (see `parseAutomationForm`, which is
 * what every caller should actually use). `alertConfig` is only included when `isAlert`
 * is true — the schema's own `.refine()` requires exactly that pairing, and always
 * sending it regardless would make an accidental stray `alertConfig` on a non-alert rule
 * silently persist across an isAlert-off edit. */
export function formStateToRuleCandidate(form: AutomationFormState): unknown {
  const candidate: Record<string, unknown> = {
    name: form.name.trim(),
    enabled: form.enabled,
    isAlert: form.isAlert,
    trigger: form.trigger,
    conditions: form.conditions,
    actions: form.actions,
  };
  if (form.isAlert) candidate.alertConfig = { ...form.alertConfig };
  return candidate;
}

/** Human-friendly label for a zod issue's path prefix — same convention as
 * `wallEditorConfig.ts`'s `formatZodIssue`. */
export function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export type AutomationFormParseResult =
  | { ok: true; input: AutomationRuleInput }
  | { ok: false; errors: string[] };

/** The one function every save path should call: builds the candidate object, then runs
 * it through the REAL `AutomationRuleConfigSchema` (imported, not re-implemented) so a
 * save can never send the server something it would reject. `name` gets its own
 * friendly pre-check (matching WallEditor's name/slug precedent); everything else falls
 * through to zod-formatted messages via `formatZodIssue`. */
export function parseAutomationForm(form: AutomationFormState): AutomationFormParseResult {
  if (!form.name.trim()) return { ok: false, errors: ['Name is required.'] };

  const candidate = formStateToRuleCandidate(form);
  const result = AutomationRuleConfigSchema.safeParse(candidate);
  if (result.success) return { ok: true, input: result.data };
  return { ok: false, errors: result.error.issues.map(formatZodIssue) };
}

// --- list page: human trigger summary sentence --------------------------------------

const CROSS_DIRECTION_WORD: Record<'below' | 'above', string> = {
  below: 'drops below', above: 'rises above',
};

/** Builds the automations list's "trigger summary sentence" (Task 6) from a rule's
 * `trigger` — a plain-language restatement of the structured condition, e.g. "When keg
 * level drops below 15%" or "Every Mon, Wed at 09:00". */
export function triggerSummary(trigger: Trigger): string {
  switch (trigger.type) {
    case 'pour_completed': return 'When a pour completes';
    case 'pour_started': return 'When a pour starts';
    case 'keg_level_crosses':
      return `When keg level ${CROSS_DIRECTION_WORD[trigger.direction]} ${trigger.thresholdPct}%`;
    case 'keg_kicked': return 'When a keg is kicked';
    case 'keg_tapped': return 'When a keg is tapped';
    case 'device_online': return 'When a device comes online';
    case 'device_offline': return 'When a device goes offline';
    case 'temp_crosses':
      return `When temperature ${CROSS_DIRECTION_WORD[trigger.direction]} ${trigger.value}°`;
    case 'humidity_crosses':
      return `When humidity ${CROSS_DIRECTION_WORD[trigger.direction]} ${trigger.value}%`;
    case 'schedule': {
      const days = trigger.weekdays.length === 0
        ? 'Every day'
        : `Every ${trigger.weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ')}`;
      return `${days} at ${trigger.time}`;
    }
    case 'app_startup': return 'When the app starts';
    case 'motion_detected': return 'When motion is detected';
    case 'display_power_changed':
      return trigger.state
        ? `When display power changes to ${DISPLAY_POWER_STATE_LABELS[trigger.state].toLowerCase()}`
        : 'When display power changes';
    default: {
      const _exhaustive: never = trigger;
      return String(_exhaustive);
    }
  }
}

/** One action → a short verb phrase for the sentence-card summary (redesign 4g). */
function oneActionSummary(action: Action): string {
  switch (action.type) {
    case 'notify': return `notify ${action.channels.join(' + ')}`;
    case 'webhook': return 'call a webhook';
    case 'mqtt_publish': return `publish to ${action.topic}`;
    case 'wall_banner': return 'show a wall banner';
    case 'display_power': return `turn the display ${action.state === 'off' ? 'off' : 'on'}`;
    default: {
      const _exhaustive: never = action;
      return String(_exhaustive);
    }
  }
}

/** "notify ntfy + Discord, show a wall banner" — the `→` half of a rule's sentence card. */
export function actionSummary(actions: Action[]): string {
  if (actions.length === 0) return 'do nothing';
  return actions.map(oneActionSummary).join(', ');
}
