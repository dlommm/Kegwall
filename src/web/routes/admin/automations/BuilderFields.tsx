import type { Tap } from '../../../../server/db/taps.js';
import type { Beer } from '../../../../server/db/beers.js';
import type { Trigger, Condition, Action } from '../../../../server/core/automationSchema.js';
import type { AutomationChannelOption } from '../../../lib/adminApi';
import {
  WEEKDAY_LABELS, VALUE_COMPARE_FIELD_LABELS, VALUE_COMPARE_OP_LABELS, WALL_BANNER_KIND_LABELS,
  TEMPLATE_VARIABLE_HINTS, DISPLAY_POWER_STATE_LABELS, type AutomationFormState,
} from '../../../lib/automationForm';

// The automation builder's field groups (split out of AutomationBuilder in Kegwall V2 M8).
// Each takes the builder's state and setters as a context and returns that part of the form.

export interface BuilderContext {
  form: AutomationFormState;
  taps: Tap[];
  beers: Beer[];
  channels: AutomationChannelOption[];
  canEdit: boolean;
  updateTrigger: (next: Trigger) => void;
  updateCondition: (index: number, next: Condition) => void;
  updateAction: (index: number, next: Action) => void;
}

/** Shared by `wall_scope`'s `wallSlugs` and `display_power`'s optional `wallSlugs` --
 * a bare comma-separated text field rather than a checkbox list fetched from
 * `listWalls()` (the pattern `tap_scope`/`beer_scope` use): this builder has no other
 * reason to know about walls yet, and adding that API dependency here is Task 12's job
 * (admin UI: wall editor fields), not this one's. Blank entries are dropped so a
 * trailing/stray comma never produces an empty-string slug. */
export function parseWallSlugsInput(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}


/** Swaps two array elements by index — identical to `WallPagesBuilder.tsx`'s own `swap`
 * helper (kept local rather than shared: two call sites, both tiny, not worth a new
 * shared module for). */
export function swap<T>(arr: T[], i: number, j: number): T[] {
  const copy = [...arr];
  const a = copy[i];
  const b = copy[j];
  if (a === undefined || b === undefined) return arr;
  copy[i] = b;
  copy[j] = a;
  return copy;
}

export function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

export function tapLabel(tap: Tap): string {
  return tap.name ?? `Tap ${tap.number}`;
}

/** A row of clickable "insert" chips for the curated `TEMPLATE_VARIABLE_HINTS` list —
 * shared by every templated string field (notify title/body, webhook body, MQTT payload,
 * wall banner text). Clicking a chip APPENDS the token to the field's current value
 * (cursor-position-aware insertion would need tracking each textarea's own selection
 * state — judged not worth the complexity for a "here's a variable you can use" hint). */
export function TemplateHintChips({
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
 * rule has a real `id` — a blank draft has nothing to run yet — AND only when `canEdit`:
 * a viewer's "View" entry point renders `canEdit={false}`, and `runRuleOnce` genuinely
 * dispatches every real action (notify/webhook/mqtt/etc, not a dry preview), which the
 * server's `POST /:id/run` route already 403s a viewer out of (`editor` role, see
 * routes/automations.ts) — the button must not even render for a role that can't use it.
 *
 * Every kind-switch (trigger/condition/action) REPLACES that item wholesale with the new
 * kind's schema-valid defaults — the WallEditor "template switch resets fields" lesson,
 * see automationForm.ts's own doc comment for why merging instead would be a landmine.
 */
export function weekdayCheckboxes(ctx: BuilderContext, days: number[], testIdPrefix: string, onChange: (days: number[]) => void) {
  const { canEdit } = ctx;
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

export function triggerFields(ctx: BuilderContext) {
  const { form, canEdit, updateTrigger } = ctx;

  const t = form.trigger;
  switch (t.type) {
    case 'pour_completed':
    case 'pour_started':
    case 'keg_kicked':
    case 'keg_tapped':
    case 'device_online':
    case 'device_offline':
    case 'app_startup':
    case 'motion_detected':
      return null;
    case 'display_power_changed':
      return (
        <label className="admin-field">
          <span>State filter (blank = any transition)</span>
          <select
            disabled={!canEdit}
            data-testid="automation-builder-trigger-field-state"
            value={t.state ?? ''}
            onChange={(e) => updateTrigger({
              ...t,
              state: e.target.value === ''
                ? undefined
                : e.target.value as Extract<Trigger, { type: 'display_power_changed' }>['state'],
            })}
          >
            <option value="">Any</option>
            {Object.entries(DISPLAY_POWER_STATE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      );
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
            {weekdayCheckboxes(
              ctx,
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

export function conditionFields(ctx: BuilderContext, condition: Condition, index: number) {
  const { taps, beers, canEdit, updateCondition } = ctx;

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
      return weekdayCheckboxes(
        ctx,
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
    case 'wall_scope':
      return (
        <label className="admin-field admin-field--full">
          <span>Wall slugs (comma-separated)</span>
          <input
            type="text" disabled={!canEdit} data-testid={`${prefix}-field-wallSlugs`}
            value={condition.wallSlugs.join(', ')}
            onChange={(e) => updateCondition(index, {
              ...condition, wallSlugs: parseWallSlugsInput(e.target.value),
            })}
          />
        </label>
      );
    default:
      return null;
  }
}

export function actionFields(ctx: BuilderContext, action: Action, index: number) {
  const { channels, canEdit, updateAction } = ctx;
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
    case 'display_power':
      return (
        <>
          <label className="admin-field">
            <span>State</span>
            <select
              disabled={!canEdit} data-testid={`${prefix}-field-state`}
              value={action.state}
              onChange={(e) => updateAction(index, {
                ...action, state: e.target.value as Extract<Action, { type: 'display_power' }>['state'],
              })}
            >
              {Object.entries(DISPLAY_POWER_STATE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="admin-field admin-field--full">
            <span>Wall slugs (comma-separated, blank = every wall)</span>
            <input
              type="text" disabled={!canEdit} data-testid={`${prefix}-field-wallSlugs`}
              value={(action.wallSlugs ?? []).join(', ')}
              onChange={(e) => {
                const slugs = parseWallSlugsInput(e.target.value);
                updateAction(index, { ...action, wallSlugs: slugs.length > 0 ? slugs : undefined });
              }}
            />
          </label>
        </>
      );
    default:
      return null;
  }
}

