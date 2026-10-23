import { useCallback, useEffect, useState } from 'react';
import type { AutomationRule } from '../../../server/core/automationSchema.js';
import {
  listAutomations, listAutomationTemplates, createFromTemplate, updateAutomation, deleteAutomation,
  type AutomationTemplateSummary,
} from '../../lib/adminApi';
import { triggerSummary, actionSummary, SEVERITY_LABELS } from '../../lib/automationForm';
import { useRelativeTime } from '../../lib/useRelativeTime';
import { useAdminContext } from './useAdminContext';
import { AutomationBuilder } from './AutomationBuilder';
import { PageTemplate } from './PageTemplate';
import { capitalize, countWord } from '../../lib/tonightAttention';
import {
  Button, ConfirmDialog, EmptyState, ErrorState, Skeleton, StatusDot, Switch, type RunState,
} from './ui';

type ViewState =
  | { mode: 'list' }
  | { mode: 'picker' }
  | { mode: 'builder'; automation: AutomationRule | null };

interface DeleteState { automation: AutomationRule; error: string | null }

/** One template's param form values, keyed by param name — every value kept as the raw
 * string an `<input>` produces; converted to `number`/`string` per `param.type` only at
 * submit time (`buildParamsPayload`). */
type TemplateParamDraft = Record<string, string>;

function defaultParamDraft(template: AutomationTemplateSummary): TemplateParamDraft {
  const draft: TemplateParamDraft = {};
  for (const param of template.params) draft[param.name] = String(param.default ?? '');
  return draft;
}

function buildParamsPayload(template: AutomationTemplateSummary, draft: TemplateParamDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const param of template.params) {
    const raw = draft[param.name] ?? '';
    payload[param.name] = param.type === 'number' ? Number(raw) : raw;
  }
  return payload;
}

function AlertBadge({ severity }: { severity: 'info' | 'warning' | 'critical' }) {
  return (
    <span
      className={`automations-alert-badge automations-alert-badge--${severity}`}
      data-testid="automations-row-alert-badge"
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

/** A rule's run state, from what the server records: on or off, and done when it fired in the
 * last few minutes. (Waiting, running and failed need a run history the API doesn't keep.) */
function runState(automation: AutomationRule, now: Date = new Date()): { state: RunState; label: string } {
  if (!automation.enabled) return { state: 'disabled', label: 'Off' };
  const fired = automation.lastFiredAt ? new Date(automation.lastFiredAt).getTime() : null;
  if (fired !== null && now.getTime() - fired < RECENT_RUN_MS) return { state: 'completed', label: 'Just ran' };
  return { state: 'enabled', label: 'On' };
}

const RECENT_RUN_MS = 5 * 60_000;

/** "When a keg drops below 15%, notify in the app." */
function ruleSentence(automation: AutomationRule): string {
  const when = triggerSummary(automation.trigger).replace(/^When /, '');
  const then = actionSummary(automation.actions);
  return `When ${when}, ${then.charAt(0).toLowerCase()}${then.slice(1)}${/[.!?]$/.test(then) ? '' : '.'}`;
}

function AutomationRow({
  automation, canEdit, onToggleEnabled, onEdit, onDelete,
}: {
  automation: AutomationRule;
  canEdit: boolean;
  onToggleEnabled: (automation: AutomationRule) => void;
  onEdit: (automation: AutomationRule) => void;
  onDelete: (automation: AutomationRule) => void;
}) {
  const lastFired = useRelativeTime(automation.lastFiredAt);
  const run = runState(automation);

  return (
    <li
      className={automation.enabled ? 'rule-v2' : 'rule-v2 is-off'}
      data-testid="automations-row"
      data-enabled={automation.enabled}
    >
      <span className="rule-v2__state"><StatusDot state={run.state} label={run.label} /></span>
      <div className="rule-v2__body">
        <p className="rule-v2__name">
          <b>{automation.name}</b>
          {automation.isAlert && automation.alertConfig && (
            <AlertBadge severity={automation.alertConfig.severity} />
          )}
        </p>
        <p className="rule-v2__sentence" data-testid="automations-row-summary">{ruleSentence(automation)}</p>
        <small className="adm-sub" data-testid="automations-row-last-fired">
          {lastFired ? `Last ran ${lastFired}` : 'Never ran'}
        </small>
      </div>
      <span className="rule-v2__actions">
        <Button
          variant="quiet"
          data-testid={canEdit ? 'automations-row-edit' : 'automations-row-view'}
          onClick={() => onEdit(automation)}
        >
          {canEdit ? 'Edit' : 'View'}
        </Button>
        {canEdit && (
          <Button variant="quiet" data-testid="automations-row-delete" onClick={() => onDelete(automation)}>
            Delete
          </Button>
        )}
        {canEdit && (
          <Switch
            checked={automation.enabled}
            onCheckedChange={() => onToggleEnabled(automation)}
            aria-label={automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`}
            data-testid="automations-row-enabled"
          />
        )}
      </span>
    </li>
  );
}

/**
 * `/admin/automations` (Task 6): the rule list (name, enabled toggle, human trigger
 * summary, last-fired relative, alert badge), the "Start from a template / Blank rule"
 * creation picker, and the structured `AutomationBuilder`. Editor/admin can create/edit/
 * delete/toggle; a viewer sees the same list read-only, with a "View" button that opens
 * the builder in its own read-only mode (`AutomationBuilder`'s `canEdit={false}`) rather
 * than being unable to inspect a rule's configuration at all.
 */
export function AutomationsPage() {
  const { me } = useAdminContext();
  const canEdit = me.role === 'editor' || me.role === 'admin';

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [view, setView] = useState<ViewState>({ mode: 'list' });
  const [templates, setTemplates] = useState<AutomationTemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<AutomationTemplateSummary | null>(null);
  const [paramDraft, setParamDraft] = useState<TemplateParamDraft>({});
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    listAutomations().then((result) => {
      if (result.ok) {
        setRules(result.data);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openPicker() {
    setSelectedTemplate(null);
    setTemplateError(null);
    setView({ mode: 'picker' });
    listAutomationTemplates().then((result) => {
      if (result.ok) setTemplates(result.data);
    });
  }

  function pickTemplate(template: AutomationTemplateSummary) {
    setSelectedTemplate(template);
    setParamDraft(defaultParamDraft(template));
    setTemplateError(null);
  }

  async function handleCreateFromTemplate() {
    if (!selectedTemplate) return;
    setTemplateError(null);
    setCreatingFromTemplate(true);
    const result = await createFromTemplate(selectedTemplate.id, buildParamsPayload(selectedTemplate, paramDraft));
    setCreatingFromTemplate(false);
    if (!result.ok) {
      setTemplateError(result.message);
      return;
    }
    const created = result.data.automations;
    load();
    // A single-rule template's result opens straight into the builder for review/tweaks;
    // a multi-rule template (temp/humidity out-of-range — two rules from one template)
    // has no single rule to open, so it just returns to the (now-refreshed) list.
    if (created.length === 1 && created[0]) {
      setView({ mode: 'builder', automation: created[0] });
    } else {
      setView({ mode: 'list' });
    }
  }

  function openBlank() {
    setView({ mode: 'builder', automation: null });
  }

  function handleEdit(automation: AutomationRule) {
    setView({ mode: 'builder', automation });
  }

  async function handleToggleEnabled(automation: AutomationRule) {
    const result = await updateAutomation(automation.id, { enabled: !automation.enabled });
    if (result.ok) load();
  }

  function handleBuilderSaved() {
    setView({ mode: 'list' });
    load();
  }

  function handleBuilderCancel() {
    setView({ mode: 'list' });
    load();
  }

  async function handleConfirmDelete() {
    if (!deleteState) return;
    setDeleting(true);
    const result = await deleteAutomation(deleteState.automation.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteState(null);
      load();
      return;
    }
    setDeleteState({ ...deleteState, error: result.message });
  }

  if (view.mode === 'builder') {
    return (
      <PageTemplate
        testId="admin-automations-page"
        crumb="Settings · Automations"
        title={view.automation ? view.automation.name : 'New rule'}
        sub="Say when it runs, then what it does. Rules run on this server; nothing leaves it unless an action sends it."
      >
        <AutomationBuilder
          automation={view.automation}
          canEdit={canEdit}
          onSaved={handleBuilderSaved}
          onCancel={handleBuilderCancel}
        />
      </PageTemplate>
    );
  }

  if (view.mode === 'picker') {
    return (
      <PageTemplate
        testId="admin-automations-page"
        crumb="Settings · Automations"
        title="New rule"
        sub="Start from a template and fill in the blanks, or build one from scratch."
      >
        <div className="automations-template-picker" data-testid="automations-template-picker">
          <p className="admin-field__label-text">Start from:</p>
          <div className="automations-template-picker__grid">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="automations-template-card"
                data-testid={`automations-template-card-${template.id}`}
                onClick={() => pickTemplate(template)}
              >
                <span className="automations-template-card__label">{template.label}</span>
                <span className="automations-template-card__description">{template.description}</span>
              </button>
            ))}
            <button
              type="button"
              className="automations-template-card automations-template-card--blank"
              data-testid="automations-template-blank"
              onClick={openBlank}
            >
              <span className="automations-template-card__label">Blank rule</span>
              <span className="automations-template-card__description">Build a rule from scratch.</span>
            </button>
          </div>

          {selectedTemplate && (
            <div className="automations-template-params" data-testid="automations-template-params">
              <h3 className="admin-field__label-text">{selectedTemplate.label}</h3>
              {selectedTemplate.params.map((param) => (
                <label key={param.name} className="admin-field">
                  <span>{param.label}</span>
                  <input
                    type={param.type === 'number' ? 'number' : 'text'}
                    data-testid={`automations-template-param-${param.name}`}
                    value={paramDraft[param.name] ?? ''}
                    min={param.min}
                    max={param.max}
                    onChange={(e) => setParamDraft((d) => ({ ...d, [param.name]: e.target.value }))}
                  />
                </label>
              ))}
              {templateError && (
                <p role="alert" data-testid="automations-template-error">{templateError}</p>
              )}
              <div className="beer-form__actions">
                <button
                  type="button"
                  className="beer-form__submit"
                  data-testid="automations-template-create"
                  disabled={creatingFromTemplate}
                  onClick={handleCreateFromTemplate}
                >
                  {creatingFromTemplate ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            className="beer-form__cancel"
            data-testid="automations-template-cancel"
            onClick={() => setView({ mode: 'list' })}
          >
            Cancel
          </button>
        </div>
      </PageTemplate>
    );
  }

  const on = rules.filter((r) => r.enabled).length;
  const title = status !== 'loaded' ? 'Automations'
    : rules.length === 0 ? 'No rules yet.'
      : `${rules.length === 1 ? 'One rule' : `${capitalize(countWord(rules.length))} rules`}, ${on === rules.length ? 'all on' : `${countWord(on)} on`}.`;

  return (
    <PageTemplate
      testId="admin-automations-page"
      title={title}
      sub="Each rule says when it runs and what it does: alerts, banners on the walls, Home Assistant and more."
      actions={canEdit && (
        <Button variant="primary" data-testid="automations-add-button" onClick={openPicker}>New rule</Button>
      )}
    >
      {status === 'loading' && <div data-testid="automations-loading"><Skeleton height={80} /></div>}
      {status === 'error' && (
        <div data-testid="automations-error">
          <ErrorState title="Couldn’t load automations." onRetry={load}>Reload to try again.</ErrorState>
        </div>
      )}
      {status === 'loaded' && rules.length === 0 && (
        <div data-testid="automations-empty">
          <EmptyState title="No automations yet.">Create one from a template, or start blank.</EmptyState>
        </div>
      )}
      {status === 'loaded' && rules.length > 0 && (
        <ul className="rule-v2__list" data-testid="automations-list">
          {rules.map((rule) => (
            <AutomationRow
              key={rule.id}
              automation={rule}
              canEdit={canEdit}
              onToggleEnabled={handleToggleEnabled}
              onEdit={handleEdit}
              onDelete={(automation) => setDeleteState({ automation, error: null })}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteState !== null}
        onOpenChange={(open) => { if (!open) setDeleteState(null); }}
        title={deleteState ? `Delete ${deleteState.automation.name}?` : ''}
        confirmLabel="Delete automation"
        busyLabel="Deleting…"
        busy={deleting}
        error={deleteState?.error}
        onConfirm={handleConfirmDelete}
        testId="automations-delete-confirm"
        confirmTestId="automations-delete-confirm-button"
        cancelTestId="automations-delete-cancel-button"
        errorTestId="automations-delete-error"
      >
        {deleteState && (
          <p>
            This will permanently delete the automation &ldquo;{deleteState.automation.name}&rdquo;. It will stop
            running immediately and won&rsquo;t fire again. This can&rsquo;t be undone.
          </p>
        )}
      </ConfirmDialog>
    </PageTemplate>
  );
}
