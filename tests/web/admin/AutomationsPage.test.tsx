import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { AutomationsPage } from '../../../src/web/routes/admin/AutomationsPage';
import {
  listAutomations, listAutomationTemplates, createFromTemplate, updateAutomation, deleteAutomation,
} from '../../../src/web/lib/adminApi';
import { renderAdminPage, adminContext } from './renderAdminPage';
import type { AutomationRule } from '../../../src/server/core/automationSchema';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listAutomations: vi.fn(),
  listAutomationTemplates: vi.fn(),
  createFromTemplate: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
}));

vi.mock('../../../src/web/routes/admin/AutomationBuilder', () => ({
  AutomationBuilder: (props: {
    automation: AutomationRule | null;
    canEdit: boolean;
    onSaved: (rule: AutomationRule) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="mock-automation-builder">
      <span data-testid="mock-builder-name">{props.automation ? props.automation.name : 'blank'}</span>
      <span data-testid="mock-builder-can-edit">{String(props.canEdit)}</span>
      <button
        type="button"
        data-testid="mock-builder-save"
        onClick={() => props.onSaved(props.automation ?? {
          id: 99, name: 'Saved', enabled: true, isAlert: false,
          trigger: { type: 'pour_completed' }, conditions: [], actions: [], lastFiredAt: null,
        } as AutomationRule)}
      >
        Save
      </button>
      <button type="button" data-testid="mock-builder-cancel" onClick={props.onCancel}>Back</button>
    </div>
  ),
}));

function rule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 1,
    name: 'Keg low',
    enabled: true,
    isAlert: true,
    trigger: { type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' },
    conditions: [],
    actions: [],
    alertConfig: {
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
    },
    lastFiredAt: null,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (listAutomations as Mock).mockResolvedValue({ ok: true, data: [] });
  (listAutomationTemplates as Mock).mockResolvedValue({
    ok: true,
    data: [
      {
        id: 'keg_low', label: 'Keg low', description: 'Alert when a keg drops low.',
        params: [{
          name: 'thresholdPct', label: 'Threshold %', type: 'number', default: 15,
        }],
      },
      {
        id: 'new_keg_tapped', label: 'New keg tapped', description: 'Info notice on tap.', params: [],
      },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AutomationsPage', () => {
  it('renders one row per automation: name, trigger summary, last-fired, alert badge', async () => {
    (listAutomations as Mock).mockResolvedValue({
      ok: true,
      data: [rule({ lastFiredAt: null })],
    });
    renderAdminPage(<AutomationsPage />);
    const rows = await screen.findAllByTestId('automations-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Keg low');
    // Sentence-card framing (redesign 4g): WHEN <trigger> → <actions>.
    expect(rows[0]).toHaveTextContent('WHEN keg level drops below 15%');
    expect(rows[0]).toHaveTextContent('→');
    expect(rows[0]).toHaveTextContent('Never');
    expect(screen.getByTestId('automations-row-alert-badge')).toBeInTheDocument();
  });

  it('shows a relative last-fired time when the rule has fired', async () => {
    (listAutomations as Mock).mockResolvedValue({
      ok: true, data: [rule({ lastFiredAt: new Date(Date.now() - 5 * 60_000).toISOString() })],
    });
    renderAdminPage(<AutomationsPage />);
    const row = await screen.findByTestId('automations-row');
    expect(row).toHaveTextContent('5 min ago');
  });

  it('a rule with no alert badge for non-alert rules', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule({ isAlert: false, alertConfig: undefined })] });
    renderAdminPage(<AutomationsPage />);
    await screen.findByTestId('automations-row');
    expect(screen.queryByTestId('automations-row-alert-badge')).not.toBeInTheDocument();
  });

  it('shows a quiet empty state with no automations', async () => {
    renderAdminPage(<AutomationsPage />);
    expect(await screen.findByTestId('automations-empty')).toBeInTheDocument();
  });

  it('toggling enabled calls updateAutomation and refreshes', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule({ enabled: true })] });
    (updateAutomation as Mock).mockResolvedValue({ ok: true, data: rule({ enabled: false }) });
    renderAdminPage(<AutomationsPage />);
    await screen.findByTestId('automations-row');

    fireEvent.click(screen.getByTestId('automations-row-enabled'));
    await flush();
    expect(updateAutomation).toHaveBeenCalledWith(1, { enabled: false });
  });

  it('a viewer sees a read-only list: no add button, no enabled toggle, no delete', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule()] });
    renderAdminPage(<AutomationsPage />, adminContext('viewer'));
    await screen.findByTestId('automations-row');
    expect(screen.queryByTestId('automations-add-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automations-row-enabled')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automations-row-delete')).not.toBeInTheDocument();
    expect(screen.getByTestId('automations-row-view')).toBeInTheDocument();
  });

  it('opening the create flow shows "Start from:" the templates plus a Blank rule option', async () => {
    renderAdminPage(<AutomationsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('automations-add-button'));
    expect(listAutomationTemplates).toHaveBeenCalled();
    await flush();

    expect(screen.getByTestId('automations-template-picker')).toBeInTheDocument();
    expect(screen.getByTestId('automations-template-card-keg_low')).toHaveTextContent('Keg low');
    expect(screen.getByTestId('automations-template-card-new_keg_tapped')).toBeInTheDocument();
    expect(screen.getByTestId('automations-template-blank')).toBeInTheDocument();
  });

  it('picking a template with params shows a param form pre-filled with defaults, then creates on submit', async () => {
    (createFromTemplate as Mock).mockResolvedValue({ ok: true, data: { automations: [rule({ id: 5 })] } });
    renderAdminPage(<AutomationsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('automations-add-button'));
    await flush();

    fireEvent.click(screen.getByTestId('automations-template-card-keg_low'));
    expect(screen.getByTestId('automations-template-param-thresholdPct')).toHaveValue(15);

    fireEvent.change(screen.getByTestId('automations-template-param-thresholdPct'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('automations-template-create'));
    await flush();

    expect(createFromTemplate).toHaveBeenCalledWith('keg_low', { thresholdPct: 25 });
    // A single-rule template opens the builder for the new rule directly.
    expect(screen.getByTestId('mock-automation-builder')).toBeInTheDocument();
  });

  it('a multi-rule template (e.g. temp_out_of_range creating 2 rules) returns to the refreshed list, not the builder', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule({ id: 7 }), rule({ id: 8 })] });
    (createFromTemplate as Mock).mockResolvedValue({
      ok: true, data: { automations: [rule({ id: 7 }), rule({ id: 8 })] },
    });
    renderAdminPage(<AutomationsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('automations-add-button'));
    await flush();
    fireEvent.click(screen.getByTestId('automations-template-card-keg_low'));
    fireEvent.click(screen.getByTestId('automations-template-create'));
    await flush();

    expect(screen.queryByTestId('mock-automation-builder')).not.toBeInTheDocument();
    expect(screen.getByTestId('automations-list')).toBeInTheDocument();
    expect(listAutomations).toHaveBeenCalledTimes(2); // initial + post-create refresh
  });

  it('picking a param-less template creates it immediately with an empty params object', async () => {
    (createFromTemplate as Mock).mockResolvedValue({ ok: true, data: { automations: [rule({ id: 6, name: 'New keg tapped' })] } });
    renderAdminPage(<AutomationsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('automations-add-button'));
    await flush();
    fireEvent.click(screen.getByTestId('automations-template-card-new_keg_tapped'));
    fireEvent.click(screen.getByTestId('automations-template-create'));
    await flush();
    expect(createFromTemplate).toHaveBeenCalledWith('new_keg_tapped', {});
  });

  it('"Blank rule" opens the builder with no automation loaded', async () => {
    renderAdminPage(<AutomationsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('automations-add-button'));
    await flush();
    fireEvent.click(screen.getByTestId('automations-template-blank'));
    expect(screen.getByTestId('mock-builder-name')).toHaveTextContent('blank');
  });

  it('clicking Edit on a row opens the builder editable for editor/admin', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule({ name: 'Keg low' })] });
    renderAdminPage(<AutomationsPage />);
    await screen.findByTestId('automations-row');
    fireEvent.click(screen.getByTestId('automations-row-edit'));
    expect(screen.getByTestId('mock-builder-name')).toHaveTextContent('Keg low');
    expect(screen.getByTestId('mock-builder-can-edit')).toHaveTextContent('true');
  });

  it('a viewer\'s row opens the builder read-only', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule()] });
    renderAdminPage(<AutomationsPage />, adminContext('viewer'));
    await screen.findByTestId('automations-row');
    fireEvent.click(screen.getByTestId('automations-row-view'));
    expect(screen.getByTestId('mock-builder-can-edit')).toHaveTextContent('false');
  });

  it('the builder\'s Back returns to the list and refreshes it', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule()] });
    renderAdminPage(<AutomationsPage />);
    await screen.findByTestId('automations-row');
    fireEvent.click(screen.getByTestId('automations-row-edit'));
    expect(listAutomations).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('mock-builder-cancel'));
    await flush();
    expect(screen.getByTestId('automations-list')).toBeInTheDocument();
    expect(listAutomations).toHaveBeenCalledTimes(2);
  });

  it('the builder\'s onSaved returns to the list and refreshes it', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule()] });
    renderAdminPage(<AutomationsPage />);
    await screen.findByTestId('automations-row');
    fireEvent.click(screen.getByTestId('automations-row-edit'));
    fireEvent.click(screen.getByTestId('mock-builder-save'));
    await flush();
    expect(screen.getByTestId('automations-list')).toBeInTheDocument();
    expect(listAutomations).toHaveBeenCalledTimes(2);
  });

  it('delete shows a full consequence sentence naming the automation (never a bare "are you sure")', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule({ name: 'Keg low' })] });
    renderAdminPage(<AutomationsPage />);
    await screen.findByTestId('automations-row');
    fireEvent.click(screen.getByTestId('automations-row-delete'));
    const confirm = screen.getByTestId('automations-delete-confirm');
    expect(confirm).toHaveTextContent('This will permanently delete');
    expect(confirm).toHaveTextContent('Keg low');
    expect(confirm).toHaveTextContent("can’t be undone");
    expect(confirm.textContent).not.toMatch(/^Are you sure\?$/);
  });

  it('a successful delete closes the confirmation and reloads the list', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule()] });
    (deleteAutomation as Mock).mockResolvedValue({ ok: true, data: null });
    renderAdminPage(<AutomationsPage />);
    await screen.findByTestId('automations-row');
    fireEvent.click(screen.getByTestId('automations-row-delete'));
    fireEvent.click(screen.getByTestId('automations-delete-confirm-button'));
    await flush();
    expect(deleteAutomation).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('automations-delete-confirm')).not.toBeInTheDocument();
    expect(listAutomations).toHaveBeenCalledTimes(2);
  });

  it('a delete failure shows the message and keeps the dialog open', async () => {
    (listAutomations as Mock).mockResolvedValue({ ok: true, data: [rule()] });
    (deleteAutomation as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Something went wrong' });
    renderAdminPage(<AutomationsPage />);
    await screen.findByTestId('automations-row');
    fireEvent.click(screen.getByTestId('automations-row-delete'));
    fireEvent.click(screen.getByTestId('automations-delete-confirm-button'));
    await flush();
    expect(screen.getByTestId('automations-delete-error')).toHaveTextContent('Something went wrong');
    expect(screen.getByTestId('automations-delete-confirm')).toBeInTheDocument();
  });
});
