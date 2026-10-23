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
  actionFields, conditionFields, swap, triggerFields, type BuilderContext,
} from './automations/BuilderFields';
import {
  TRIGGER_KINDS, TRIGGER_LABELS, CONDITION_KINDS, CONDITION_LABELS, ACTION_KINDS, ACTION_LABELS,
  SEVERITY_LABELS, defaultTrigger, defaultCondition, defaultAction,
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

  const ctx: BuilderContext = {
    form, taps, beers, channels, canEdit, updateTrigger, updateCondition, updateAction,
  };

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

  return (
    <div data-testid="automation-builder">
      <form className="automation-builder" data-testid="automation-builder-form" onSubmit={handleSave}>
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
          {triggerFields(ctx)}
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
              {conditionFields(ctx, condition, index)}
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
              {actionFields(ctx, action, index)}
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

      {automation && canEdit && (
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
                  {/* `AutomationRunResult.type` (adminApi.ts) is a plain `string`, not the
                      literal `Action['type']` union -- it's decoded from an HTTP response,
                      so it can't be narrowed at compile time. Falls back to the raw value
                      for a type this build's ACTION_LABELS doesn't know about (defensive,
                      matches this app's other "unrecognized -> fall back, never throw"
                      precedents, e.g. renderTemplate's missing-path behavior). */}
                  {(ACTION_LABELS as Record<string, string>)[r.type] ?? r.type}: {r.ok ? 'OK' : `Failed — ${r.error}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
