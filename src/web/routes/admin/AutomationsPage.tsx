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

  return (
    <li
      className={automation.enabled ? 'automations-row' : 'automations-row automations-row--paused'}
      data-testid="automations-row"
      data-enabled={automation.enabled}
    >
      <div className="automations-row__main">
        {canEdit ? (
          <label className="wall-editor__checkbox automations-row__enabled-toggle">
            <input
              type="checkbox"
              data-testid="automations-row-enabled"
              checked={automation.enabled}
              onChange={() => onToggleEnabled(automation)}
            />
          </label>
        ) : (
          <span className="automations-row__enabled-dot" data-enabled={automation.enabled} aria-hidden="true" />
        )}
        <div className="automations-row__body">
          <div className="automations-row__title-line">
            <span className="automations-row__name">{automation.name}</span>
            {automation.isAlert && automation.alertConfig && (
              <AlertBadge severity={automation.alertConfig.severity} />
            )}
          </div>
          {/* Sentence card (redesign 4g): WHEN <trigger> → <actions>, operands emphasized. */}
          <span className="automations-row__summary" data-testid="automations-row-summary">
            <span className="automations-row__when">WHEN</span>
            {` ${triggerSummary(automation.trigger).replace(/^When /, '')} `}
            <span className="automations-row__arrow" aria-hidden="true">→</span>
            <span className="automations-row__then">{` ${actionSummary(automation.actions)}`}</span>
          </span>
        </div>
        <span className="automations-row__last-fired" data-testid="automations-row-last-fired">
          {lastFired ?? 'Never'}
        </span>
        <span className="automations-row__actions">
          <button
            type="button"
            data-testid={canEdit ? 'automations-row-edit' : 'automations-row-view'}
            onClick={() => onEdit(automation)}
          >
            {canEdit ? 'Edit' : 'View'}
          </button>
          {canEdit && (
            <button type="button" data-testid="automations-row-delete" onClick={() => onDelete(automation)}>
              Delete
            </button>
          )}
        </span>
      </div>
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
      <section data-testid="admin-automations-page">
        <header className="admin-page-header">
          <h1 className="admin-page-header__title font-display">
            {view.automation ? `Edit ${view.automation.name}` : 'New automation'}
          </h1>
        </header>
        <AutomationBuilder
          automation={view.automation}
          canEdit={canEdit}
          onSaved={handleBuilderSaved}
          onCancel={handleBuilderCancel}
        />
      </section>
    );
  }

  if (view.mode === 'picker') {
    return (
      <section data-testid="admin-automations-page">
        <header className="admin-page-header">
          <h1 className="admin-page-header__title font-display">New automation</h1>
        </header>
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
      </section>
    );
  }

  return (
    <section data-testid="admin-automations-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Automations</h1>
        {canEdit && (
          <button
            type="button"
            className="admin-page-header__action"
            data-testid="automations-add-button"
            onClick={openPicker}
          >
            New automation
          </button>
        )}
      </header>

      {status === 'loading' && <p className="admin-page-quiet" data-testid="automations-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="automations-error">
          Couldn&rsquo;t load automations. Reload to try again.
        </p>
      )}
      {status === 'loaded' && rules.length === 0 && (
        <p className="admin-page-quiet" data-testid="automations-empty">
          No automations yet — create one from a template or start blank.
        </p>
      )}
      {status === 'loaded' && rules.length > 0 && (
        <ul className="automations-list" data-testid="automations-list">
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

      {deleteState && (
        <div
          className="admin-confirm__backdrop"
          data-testid="automations-delete-confirm"
          onClick={() => !deleting && setDeleteState(null)}
        >
          <div
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="automations-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="automations-delete-title" className="font-display">Delete automation</h3>
            <p>
              This will permanently delete the automation &ldquo;{deleteState.automation.name}&rdquo;. It will stop
              running immediately and won&rsquo;t fire again. This can&rsquo;t be undone.
            </p>
            {deleteState.error && (
              <p role="alert" data-testid="automations-delete-error">{deleteState.error}</p>
            )}
            <div className="admin-confirm__actions">
              <button
                type="button"
                data-testid="automations-delete-confirm-button"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? 'Deleting…' : 'Delete automation'}
              </button>
              <button
                type="button"
                data-testid="automations-delete-cancel-button"
                disabled={deleting}
                onClick={() => setDeleteState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
