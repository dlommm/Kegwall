import { useEffect, useState, type FormEvent } from 'react';
import type { Tap } from '../../../server/db/taps.js';
import type { Beer } from '../../../server/db/beers.js';
import type {
  Trigger, Condition, Action, AutomationRule,
} from '../../../server/core/automationSchema.js';
import {
  listTaps, listBeers, listAutomationChannels, createAutomation, updateAutomation, runAutomation,
  type AutomationChannelOption, type AutomationRunResult,
} from '../../lib/adminApi';
import {
  TRIGGER_KINDS, TRIGGER_LABELS, CONDITION_KINDS, CONDITION_LABELS, ACTION_KINDS, ACTION_LABELS,
  WEEKDAY_LABELS, VALUE_COMPARE_FIELD_LABELS, VALUE_COMPARE_OP_LABELS, WALL_BANNER_KIND_LABELS,
  SEVERITY_LABELS, TEMPLATE_VARIABLE_HINTS,
  defaultTrigger, defaultCondition, defaultAction,
  blankFormState, ruleToFormState, parseAutomationForm,
  type AutomationFormState,
} from '../../lib/automationForm';

export interface AutomationBuilderProps {
  /** `null` for a brand-new "blank rule" (see AutomationsPage's template picker for the
   * other creation path — from-template creates rules directly via the API, this builder
   * only ever starts blank or edits an already-persisted rule). */
  automation: AutomationRule | null;
  canEdit: boolean;
  onSaved: (rule: AutomationRule) => void;
  onCancel: () => void;
}

/** Swaps two array elements by index — identical to `WallPagesBuilder.tsx`'s own `swap`
 * helper (kept local rather than shared: two call sites, both tiny, not worth a new
 * shared module for). */
function swap<T>(arr: T[], i: number, j: number): T[] {
  const copy = [...arr];
  const a = copy[i];
  const b = copy[j];
  if (a === undefined || b === undefined) return arr;
  copy[i] = b;
  copy[j] = a;
  return copy;
}

function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

function tapLabel(tap: Tap): string {
  return tap.name ?? `Tap ${tap.number}`;
}

/** A row of clickable "insert" chips for the curated `TEMPLATE_VARIABLE_HINTS` list —
 * shared by every templated string field (notify title/body, webhook body, MQTT payload,
 * wall banner text). Clicking a chip APPENDS the token to the field's current value
 * (cursor-position-aware insertion would need tracking each textarea's own selection
 * state — judged not worth the complexity for a "here's a variable you can use" hint). */
function TemplateHintChips({
  disabled, fieldTestId, onInsert,
}: { disabled: boolean; fieldTestId: string; onInsert: (token: string) => void }) {
  return (
    <div className="automation-builder__hints" data-testid={`${fieldTestId}-hints`}>
      {TEMPLATE_VARIABLE_HINTS.map((token) => (
        <button
          key={token}
          type="button"
          className="automation-builder__hint-chip"
          disabled={disabled}
          data-testid={`${fieldTestId}-hints-hint-${token}`}
          onClick={() => onInsert(token)}
        >
          {token}
        </button>
      ))}
    </div>
  );
}

/**
 * The automations builder (Task 6): structured trigger/conditions/actions editors, backed
 * by `automationForm.ts`'s serializer (the round-trip critical logic — see that module's
 * doc comment). Handles BOTH creation (`automation: null`, starts from
 * `blankFormState()`) and editing (`automation` set, starts from `ruleToFormState`) —
 * AutomationsPage decides which by whether it's opening the builder from "Blank rule" or
 * an existing row's "Edit" button. Test-run (`POST /:id/run`) is only offered once the
 * rule has a real `id` — a blank draft has nothing to run yet.
 *
 * Every kind-switch (trigger/condition/action) REPLACES that item wholesale with the new
 * kind's schema-valid defaults — the WallEditor "template switch resets fields" lesson,
 * see automationForm.ts's own doc comment for why merging instead would be a landmine.
 */
export function AutomationBuilder({
  automation, canEdit, onSaved, onCancel,
}: AutomationBuilderProps) {
  const [form, setForm] = useState<AutomationFormState>(
    () => (automation ? ruleToFormState(automation) : blankFormState()),
  );
  const [taps, setTaps] = useState<Tap[]>([]);
  const [beers, setBeers] = useState<Beer[]>([]);
  const [channels, setChannels] = useState<AutomationChannelOption[]>([]);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState<AutomationRunResult[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    listTaps().then((result) => { if (result.ok) setTaps(result.data); });
    listBeers().then((result) => { if (result.ok) setBeers(result.data); });
    listAutomationChannels().then((result) => { if (result.ok) setChannels(result.data); });
  }, []);

  function updateTrigger(next: Trigger) {
    setForm((f) => ({ ...f, trigger: next }));
  }

  function updateConditionKind(index: number, kind: Condition['type']) {
    setForm((f) => ({
      ...f, conditions: f.conditions.map((c, i) => (i === index ? defaultCondition(kind) : c)),
    }));
  }

  function updateCondition(index: number, next: Condition) {
    setForm((f) => ({ ...f, conditions: f.conditions.map((c, i) => (i === index ? next : c)) }));
  }

  function addCondition() {
    setForm((f) => ({ ...f, conditions: [...f.conditions, defaultCondition('tap_scope')] }));
  }

  function removeCondition(index: number) {
    setForm((f) => ({ ...f, conditions: f.conditions.filter((_, i) => i !== index) }));
  }

  function updateActionKind(index: number, kind: Action['type']) {
    setForm((f) => ({ ...f, actions: f.actions.map((a, i) => (i === index ? defaultAction(kind) : a)) }));
  }

  function updateAction(index: number, next: Action) {
    setForm((f) => ({ ...f, actions: f.actions.map((a, i) => (i === index ? next : a)) }));
  }

  function addAction() {
    setForm((f) => ({ ...f, actions: [...f.actions, defaultAction('notify')] }));
  }

  function removeAction(index: number) {
    setForm((f) => ({ ...f, actions: f.actions.filter((_, i) => i !== index) }));
  }

  function moveAction(index: number, direction: -1 | 1) {
    setForm((f) => ({ ...f, actions: swap(f.actions, index, index + direction) }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setRunResults(null);
    setRunError(null);
    const parsed = parseAutomationForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors(null);
    setSaving(true);
    const result = automation
      ? await updateAutomation(automation.id, parsed.input)
      : await createAutomation(parsed.input);
    setSaving(false);
    if (!result.ok) {
      setErrors([result.message]);
      return;
    }
    onSaved(result.data);
  }

  async function handleRun() {
    if (!automation) return;
    setRunning(true);
    setRunError(null);
    const result = await runAutomation(automation.id);
    setRunning(false);
    if (result.ok) {
      setRunResults(result.data.results);
    } else {
      setRunError(result.message);
    }
  }

  function renderWeekdayCheckboxes(days: number[], testIdPrefix: string, onChange: (days: number[]) => void) {
    return (
      <div className="automation-builder__weekdays">
        {WEEKDAY_LABELS.map((label, i) => (
          <label key={label} className="wall-editor__checkbox">
            <input
              type="checkbox"
              disabled={!canEdit}
              data-testid={`${testIdPrefix}-${i}`}
              checked={days.includes(i)}
              onChange={() => onChange(toggleDay(days, i))}
            />
            {label}
          </label>
        ))}
      </div>
    );
  }

  function renderTriggerFields() {
    const t = form.trigger;
    switch (t.type) {
      case 'pour_completed':
      case 'pour_started':
      case 'keg_kicked':
      case 'keg_tapped':
      case 'device_online':
      case 'device_offline':
      case 'app_startup':
        return null;
      case 'keg_level_crosses':
        return (
          <div className="automation-builder__field-row">
            <label className="admin-field">
              <span>Threshold %</span>
              <input
                type="number" min={0} max={100} disabled={!canEdit}
                data-testid="automation-builder-trigger-field-thresholdPct"
                value={t.thresholdPct}
                onChange={(e) => updateTrigger({ ...t, thresholdPct: Number(e.target.value) })}
              />
            </label>
            <label className="admin-field">
              <span>Direction</span>
              <select
                disabled={!canEdit}
                data-testid="automation-builder-trigger-field-direction"
                value={t.direction}
                onChange={(e) => updateTrigger({ ...t, direction: e.target.value as 'below' | 'above' })}
              >
                <option value="below">Drops below</option>
                <option value="above">Rises above</option>
              </select>
            </label>
          </div>
        );
      case 'temp_crosses':
      case 'humidity_crosses':
        return (
          <div className="automation-builder__field-row">
            <label className="admin-field">
              <span>{t.type === 'temp_crosses' ? 'Temperature' : 'Humidity %'}</span>
              <input
                type="number" disabled={!canEdit}
                data-testid="automation-builder-trigger-field-value"
                value={t.value}
                onChange={(e) => updateTrigger({ ...t, value: Number(e.target.value) })}
              />
            </label>
            <label className="admin-field">
              <span>Direction</span>
              <select
                disabled={!canEdit}
                data-testid="automation-builder-trigger-field-direction"
                value={t.direction}
                onChange={(e) => updateTrigger({ ...t, direction: e.target.value as 'below' | 'above' })}
              >
                <option value="below">Drops below</option>
                <option value="above">Rises above</option>
              </select>
            </label>
          </div>
        );
      case 'schedule':
        return (
          <div className="automation-builder__field-row">
            <label className="admin-field">
              <span>Time (24h)</span>
              <input
                type="text" disabled={!canEdit}
                data-testid="automation-builder-trigger-field-time"
                value={t.time}
                onChange={(e) => updateTrigger({ ...t, time: e.target.value })}
              />
            </label>
            <div className="admin-field">
              <span>Weekdays (none = every day)</span>
              {renderWeekdayCheckboxes(
                t.weekdays,
                'automation-builder-trigger-weekday',
                (weekdays) => updateTrigger({ ...t, weekdays }),
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  function renderConditionFields(condition: Condition, index: number) {
    const prefix = `automation-builder-condition-${index}`;
    switch (condition.type) {
      case 'tap_scope':
        return (
          <div className="automation-builder__checkbox-list">
            {taps.map((tap) => (
              <label key={tap.id} className="wall-editor__checkbox">
                <input
                  type="checkbox" disabled={!canEdit}
                  data-testid={`${prefix}-tap-${tap.id}`}
                  checked={condition.tapIds.includes(tap.id)}
                  onChange={() => updateCondition(index, {
                    ...condition,
                    tapIds: condition.tapIds.includes(tap.id)
                      ? condition.tapIds.filter((id) => id !== tap.id)
                      : [...condition.tapIds, tap.id],
                  })}
                />
                {tapLabel(tap)}
              </label>
            ))}
          </div>
        );
      case 'beer_scope':
        return (
          <div className="automation-builder__checkbox-list">
            {beers.map((beer) => (
              <label key={beer.id} className="wall-editor__checkbox">
                <input
                  type="checkbox" disabled={!canEdit}
                  data-testid={`${prefix}-beer-${beer.id}`}
                  checked={condition.beerIds.includes(beer.id)}
                  onChange={() => updateCondition(index, {
                    ...condition,
                    beerIds: condition.beerIds.includes(beer.id)
                      ? condition.beerIds.filter((id) => id !== beer.id)
                      : [...condition.beerIds, beer.id],
                  })}
                />
                {beer.name}
              </label>
            ))}
          </div>
        );
      case 'time_window':
        return (
          <div className="automation-builder__field-row">
            <label className="admin-field">
              <span>Start</span>
              <input
                type="text" disabled={!canEdit} data-testid={`${prefix}-field-start`}
                value={condition.start}
                onChange={(e) => updateCondition(index, { ...condition, start: e.target.value })}
              />
            </label>
            <label className="admin-field">
              <span>End</span>
              <input
                type="text" disabled={!canEdit} data-testid={`${prefix}-field-end`}
                value={condition.end}
                onChange={(e) => updateCondition(index, { ...condition, end: e.target.value })}
              />
            </label>
          </div>
        );
      case 'weekday':
        return renderWeekdayCheckboxes(
          condition.days,
          `${prefix}-weekday`,
          (days) => updateCondition(index, { ...condition, days }),
        );
      case 'value_compare':
        return (
          <div className="automation-builder__field-row">
            <label className="admin-field">
              <span>Field</span>
              <select
                disabled={!canEdit} data-testid={`${prefix}-field-field`}
                value={condition.field}
                onChange={(e) => updateCondition(index, {
                  ...condition, field: e.target.value as Extract<Condition, { type: 'value_compare' }>['field'],
                })}
              >
                {Object.entries(VALUE_COMPARE_FIELD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Comparison</span>
              <select
                disabled={!canEdit} data-testid={`${prefix}-field-op`}
                value={condition.op}
                onChange={(e) => updateCondition(index, {
                  ...condition, op: e.target.value as Extract<Condition, { type: 'value_compare' }>['op'],
                })}
              >
                {Object.entries(VALUE_COMPARE_OP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Value</span>
              <input
                type="number" disabled={!canEdit} data-testid={`${prefix}-field-value`}
                value={condition.value}
                onChange={(e) => updateCondition(index, { ...condition, value: Number(e.target.value) })}
              />
            </label>
          </div>
        );
      case 'min_interval':
        return (
          <label className="admin-field">
            <span>Minutes since last fire</span>
            <input
              type="number" min={1} disabled={!canEdit} data-testid={`${prefix}-field-minutes`}
              value={condition.minutes}
              onChange={(e) => updateCondition(index, { ...condition, minutes: Number(e.target.value) })}
            />
          </label>
        );
      case 'days_since_cleaned':
        return (
          <label className="admin-field">
            <span>Days since cleaned</span>
            <input
              type="number" min={1} disabled={!canEdit} data-testid={`${prefix}-field-days`}
              value={condition.days}
              onChange={(e) => updateCondition(index, { ...condition, days: Number(e.target.value) })}
            />
          </label>
        );
      default:
        return null;
    }
  }

  function renderActionFields(action: Action, index: number) {
    const prefix = `automation-builder-action-${index}`;
    switch (action.type) {
      case 'notify':
        return (
          <>
            <div className="automation-builder__checkbox-list">
              {channels.map((c) => (
                <label key={c.name} className="wall-editor__checkbox">
                  <input
                    type="checkbox" disabled={!canEdit}
                    data-testid={`${prefix}-channel-${c.name}`}
                    checked={action.channels.includes(c.name)}
                    onChange={() => updateAction(index, {
                      ...action,
                      channels: action.channels.includes(c.name)
                        ? action.channels.filter((n) => n !== c.name)
                        : [...action.channels, c.name],
                    })}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            <label className="admin-field admin-field--full">
              <span>Title</span>
              <input
                type="text" disabled={!canEdit} data-testid={`${prefix}-field-title`}
                value={action.title}
                onChange={(e) => updateAction(index, { ...action, title: e.target.value })}
              />
            </label>
            <TemplateHintChips
              disabled={!canEdit} fieldTestId={`${prefix}-field-title`}
              onInsert={(token) => updateAction(index, { ...action, title: action.title + token })}
            />
            <label className="admin-field admin-field--full">
              <span>Body</span>
              <textarea
                disabled={!canEdit} data-testid={`${prefix}-field-body`}
                value={action.body}
                onChange={(e) => updateAction(index, { ...action, body: e.target.value })}
              />
            </label>
            <TemplateHintChips
              disabled={!canEdit} fieldTestId={`${prefix}-field-body`}
              onInsert={(token) => updateAction(index, { ...action, body: action.body + token })}
            />
          </>
        );
      case 'webhook':
        return (
          <>
            <label className="admin-field admin-field--full">
              <span>URL</span>
              <input
                type="text" disabled={!canEdit} data-testid={`${prefix}-field-url`}
                value={action.url}
                onChange={(e) => updateAction(index, { ...action, url: e.target.value })}
              />
            </label>
            <label className="admin-field admin-field--full">
              <span>Body template (JSON)</span>
              <textarea
                disabled={!canEdit} data-testid={`${prefix}-field-bodyTemplate`}
                value={action.bodyTemplate}
                onChange={(e) => updateAction(index, { ...action, bodyTemplate: e.target.value })}
              />
            </label>
            <TemplateHintChips
              disabled={!canEdit} fieldTestId={`${prefix}-field-bodyTemplate`}
              onInsert={(token) => updateAction(index, { ...action, bodyTemplate: action.bodyTemplate + token })}
            />
          </>
        );
      case 'mqtt_publish':
        return (
          <>
            <label className="admin-field admin-field--full">
              <span>Topic</span>
              <input
                type="text" disabled={!canEdit} data-testid={`${prefix}-field-topic`}
                value={action.topic}
                onChange={(e) => updateAction(index, { ...action, topic: e.target.value })}
              />
            </label>
            <label className="admin-field admin-field--full">
              <span>Payload template</span>
              <textarea
                disabled={!canEdit} data-testid={`${prefix}-field-payloadTemplate`}
                value={action.payloadTemplate}
                onChange={(e) => updateAction(index, { ...action, payloadTemplate: e.target.value })}
              />
            </label>
            <TemplateHintChips
              disabled={!canEdit} fieldTestId={`${prefix}-field-payloadTemplate`}
              onInsert={(token) => updateAction(index, { ...action, payloadTemplate: action.payloadTemplate + token })}
            />
          </>
        );
      case 'wall_banner':
        return (
          <>
            <label className="admin-field admin-field--full">
              <span>Text</span>
              <input
                type="text" disabled={!canEdit} data-testid={`${prefix}-field-text`}
                value={action.text}
                onChange={(e) => updateAction(index, { ...action, text: e.target.value })}
              />
            </label>
            <TemplateHintChips
              disabled={!canEdit} fieldTestId={`${prefix}-field-text`}
              onInsert={(token) => updateAction(index, { ...action, text: action.text + token })}
            />
            <label className="admin-field">
              <span>Kind</span>
              <select
                disabled={!canEdit} data-testid={`${prefix}-field-kind`}
                value={action.kind}
                onChange={(e) => updateAction(index, { ...action, kind: e.target.value as Extract<Action, { type: 'wall_banner' }>['kind'] })}
              >
                {Object.entries(WALL_BANNER_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Duration (ms, optional)</span>
              <input
                type="number" min={1} disabled={!canEdit} data-testid={`${prefix}-field-durationMs`}
                value={action.durationMs ?? ''}
                onChange={(e) => updateAction(index, {
                  ...action, durationMs: e.target.value === '' ? undefined : Number(e.target.value),
                })}
              />
            </label>
          </>
        );
      case 'party_mode':
        return (
          <label className="admin-field">
            <span>Minutes</span>
            <input
              type="number" min={1} disabled={!canEdit} data-testid={`${prefix}-field-minutes`}
              value={action.minutes}
              onChange={(e) => updateAction(index, { ...action, minutes: Number(e.target.value) })}
            />
          </label>
        );
      case 'kegtron_reset_volume':
        return (
          <p className="admin-page-quiet" data-testid={`${prefix}-note`}>
            Resets the bound Kegtron Pro monitor&rsquo;s on-device volume counter for the triggering tap.
          </p>
        );
      default:
        return null;
    }
  }

  return (
    <div data-testid="automation-builder">
      <form data-testid="automation-builder-form" onSubmit={handleSave}>
        <div className="automation-builder__grid">
          <label className="admin-field">
            <span>Name</span>
            <input
              type="text" disabled={!canEdit} data-testid="automation-builder-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="wall-editor__checkbox">
            <input
              type="checkbox" disabled={!canEdit} data-testid="automation-builder-enabled"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Enabled
          </label>
          <label className="wall-editor__checkbox">
            <input
              type="checkbox" disabled={!canEdit} data-testid="automation-builder-is-alert"
              checked={form.isAlert}
              onChange={(e) => setForm((f) => ({ ...f, isAlert: e.target.checked }))}
            />
            This is an alert
          </label>
        </div>

        {form.isAlert && (
          <fieldset className="wall-editor__section">
            <legend>Alert settings</legend>
            <div className="automation-builder__field-row">
              <label className="admin-field">
                <span>Cooldown (minutes)</span>
                <input
                  type="number" min={1} disabled={!canEdit} data-testid="automation-builder-alert-cooldown"
                  value={form.alertConfig.cooldownMinutes}
                  onChange={(e) => setForm((f) => ({
                    ...f, alertConfig: { ...f.alertConfig, cooldownMinutes: Number(e.target.value) },
                  }))}
                />
              </label>
              <label className="admin-field">
                <span>Severity</span>
                <select
                  disabled={!canEdit} data-testid="automation-builder-alert-severity"
                  value={form.alertConfig.severity}
                  onChange={(e) => setForm((f) => ({
                    ...f, alertConfig: { ...f.alertConfig, severity: e.target.value as typeof f.alertConfig.severity },
                  }))}
                >
                  {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="wall-editor__checkbox">
                <input
                  type="checkbox" disabled={!canEdit} data-testid="automation-builder-alert-auto-resolve"
                  checked={form.alertConfig.autoResolve}
                  onChange={(e) => setForm((f) => ({
                    ...f, alertConfig: { ...f.alertConfig, autoResolve: e.target.checked },
                  }))}
                />
                Auto-resolve
              </label>
              <label className="wall-editor__checkbox">
                <input
                  type="checkbox" disabled={!canEdit} data-testid="automation-builder-alert-notify-resolve"
                  checked={form.alertConfig.notifyOnResolve}
                  onChange={(e) => setForm((f) => ({
                    ...f, alertConfig: { ...f.alertConfig, notifyOnResolve: e.target.checked },
                  }))}
                />
                Notify on resolve
              </label>
            </div>
          </fieldset>
        )}

        <fieldset className="wall-editor__section">
          <legend>Trigger</legend>
          <label className="admin-field">
            <span>When</span>
            <select
              disabled={!canEdit} data-testid="automation-builder-trigger-type"
              value={form.trigger.type}
              onChange={(e) => updateTrigger(defaultTrigger(e.target.value as Trigger['type']))}
            >
              {TRIGGER_KINDS.map((kind) => (
                <option key={kind} value={kind}>{TRIGGER_LABELS[kind]}</option>
              ))}
            </select>
          </label>
          {renderTriggerFields()}
        </fieldset>

        <fieldset className="wall-editor__section">
          <legend>Conditions</legend>
          {form.conditions.length === 0 && (
            <p className="admin-page-quiet" data-testid="automation-builder-conditions-empty">
              No conditions — this rule always evaluates its trigger with no extra filtering.
            </p>
          )}
          {form.conditions.map((condition, index) => (
            // eslint-disable-next-line react/no-array-index-key -- items have no stable id, only replaced/removed by position
            <div key={index} className="automation-builder__item" data-testid="automation-builder-condition">
              <div className="automation-builder__item-header">
                <select
                  disabled={!canEdit} data-testid={`automation-builder-condition-${index}-type`}
                  value={condition.type}
                  onChange={(e) => updateConditionKind(index, e.target.value as Condition['type'])}
                >
                  {CONDITION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{CONDITION_LABELS[kind]}</option>
                  ))}
                </select>
                {canEdit && (
                  <button
                    type="button" data-testid={`automation-builder-condition-${index}-remove`}
                    onClick={() => removeCondition(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
              {renderConditionFields(condition, index)}
            </div>
          ))}
          {canEdit && (
            <button type="button" data-testid="automation-builder-add-condition" onClick={addCondition}>
              Add condition
            </button>
          )}
        </fieldset>

        <fieldset className="wall-editor__section">
          <legend>Actions</legend>
          {form.actions.length === 0 && (
            <p className="admin-page-quiet" data-testid="automation-builder-actions-empty">
              No actions yet — this rule won&rsquo;t do anything until you add one.
            </p>
          )}
          {form.actions.map((action, index) => (
            // eslint-disable-next-line react/no-array-index-key -- items have no stable id, only reordered/removed by position
            <div key={index} className="automation-builder__item" data-testid="automation-builder-action">
              <div className="automation-builder__item-header">
                <select
                  disabled={!canEdit} data-testid={`automation-builder-action-${index}-type`}
                  value={action.type}
                  onChange={(e) => updateActionKind(index, e.target.value as Action['type'])}
                >
                  {ACTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{ACTION_LABELS[kind]}</option>
                  ))}
                </select>
                {canEdit && (
                  <div className="automation-builder__item-actions">
                    <button
                      type="button" data-testid={`automation-builder-action-${index}-up`}
                      disabled={index === 0}
                      onClick={() => moveAction(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button" data-testid={`automation-builder-action-${index}-down`}
                      disabled={index === form.actions.length - 1}
                      onClick={() => moveAction(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button" data-testid={`automation-builder-action-${index}-remove`}
                      onClick={() => removeAction(index)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              {renderActionFields(action, index)}
            </div>
          ))}
          {canEdit && (
            <button type="button" data-testid="automation-builder-add-action" onClick={addAction}>
              Add action
            </button>
          )}
        </fieldset>

        {errors && (
          <ul className="wall-editor__errors" role="alert" data-testid="automation-builder-errors">
            {errors.map((err, i) => (
              // eslint-disable-next-line react/no-array-index-key -- error strings have no stable id
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="beer-form__actions">
            <button type="submit" className="beer-form__submit" data-testid="automation-builder-save" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="beer-form__cancel" data-testid="automation-builder-cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
        {!canEdit && (
          <div className="beer-form__actions">
            <button type="button" className="beer-form__cancel" data-testid="automation-builder-cancel" onClick={onCancel}>
              Back
            </button>
          </div>
        )}
      </form>

      {automation && (
        <div className="automation-builder__run" data-testid="automation-builder-run-panel">
          <button type="button" data-testid="automation-builder-run" disabled={running} onClick={handleRun}>
            {running ? 'Running…' : 'Test run'}
          </button>
          <p className="admin-page-quiet">
            Dispatches every action against sample data — no cooldown/history is affected.
          </p>
          {runError && (
            <p role="alert" data-testid="automation-builder-run-error">{runError}</p>
          )}
          {runResults && (
            <ul data-testid="automation-builder-run-results">
              {runResults.map((r, i) => (
                // eslint-disable-next-line react/no-array-index-key -- results have no stable id, in fixed action order
                <li key={i} data-testid={`automation-builder-run-result-${i}`} data-ok={r.ok}>
                  {r.type}: {r.ok ? 'OK' : `Failed — ${r.error}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
