import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { AutomationBuilder } from '../../../src/web/routes/admin/AutomationBuilder';
import {
  listTaps, listBeers, listAutomationChannels, createAutomation, updateAutomation, runAutomation,
} from '../../../src/web/lib/adminApi';
import { renderAdminPage, adminContext } from './renderAdminPage';
import type { AutomationRule } from '../../../src/server/core/automationSchema';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listTaps: vi.fn(),
  listBeers: vi.fn(),
  listAutomationChannels: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  runAutomation: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function rule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 1,
    name: 'Keg low',
    enabled: true,
    isAlert: true,
    trigger: { type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' },
    conditions: [],
    actions: [{
      type: 'notify', channels: ['inApp'], title: 'Low keg', body: '{{beer.name}} is low',
    }],
    alertConfig: {
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
    },
    lastFiredAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listTaps as Mock).mockResolvedValue({ ok: true, data: [{ id: 1, number: 1, name: 'Left', defaultDrinkerId: null }] });
  (listBeers as Mock).mockResolvedValue({ ok: true, data: [{ id: 1, name: 'Test IPA' }] });
  (listAutomationChannels as Mock).mockResolvedValue({
    ok: true, data: [{ name: 'inApp', label: 'In-app' }, { name: 'discord', label: 'Discord' }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AutomationBuilder', () => {
  it('a blank rule starts with the pour_completed trigger and no conditions/actions', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('automation-builder-trigger-type')).toHaveValue('pour_completed');
    expect(screen.queryAllByTestId(/automation-builder-condition-\d+-type/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/automation-builder-action-\d+-type/)).toHaveLength(0);
  });

  it('loads an existing rule\'s trigger/action fields', async () => {
    renderAdminPage(<AutomationBuilder automation={rule()} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('automation-builder-name')).toHaveValue('Keg low');
    expect(screen.getByTestId('automation-builder-trigger-type')).toHaveValue('keg_level_crosses');
    expect(screen.getByTestId('automation-builder-trigger-field-thresholdPct')).toHaveValue(15);
    expect(screen.getByTestId('automation-builder-trigger-field-direction')).toHaveValue('below');
    expect(screen.getAllByTestId(/automation-builder-action-\d+-type/)).toHaveLength(1);
  });

  it('switching trigger kind resets that kind\'s fields to defaults (no leftover fields from the old kind)', async () => {
    renderAdminPage(<AutomationBuilder automation={rule()} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('automation-builder-trigger-field-thresholdPct')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('automation-builder-trigger-type'), { target: { value: 'temp_crosses' } });
    expect(screen.queryByTestId('automation-builder-trigger-field-thresholdPct')).not.toBeInTheDocument();
    expect(screen.getByTestId('automation-builder-trigger-field-value')).toBeInTheDocument();
    expect(screen.getByTestId('automation-builder-trigger-field-direction')).toHaveValue('above');
  });

  it('a schedule trigger renders a time field and weekday checkboxes', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.change(screen.getByTestId('automation-builder-trigger-type'), { target: { value: 'schedule' } });
    expect(screen.getByTestId('automation-builder-trigger-field-time')).toHaveValue('09:00');
    expect(screen.getAllByTestId(/automation-builder-trigger-weekday-\d/)).toHaveLength(7);
  });

  it('add condition appends a default tap_scope condition; remove condition removes it', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByTestId('automation-builder-add-condition'));
    expect(screen.getAllByTestId(/automation-builder-condition-\d+-type/)).toHaveLength(1);

    fireEvent.click(screen.getByTestId('automation-builder-condition-0-remove'));
    expect(screen.queryAllByTestId(/automation-builder-condition-\d+-type/)).toHaveLength(0);
  });

  it('a value_compare condition renders field/op/value selects', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByTestId('automation-builder-add-condition'));
    fireEvent.change(screen.getByTestId('automation-builder-condition-0-type'), { target: { value: 'value_compare' } });
    expect(screen.getByTestId('automation-builder-condition-0-field-field')).toBeInTheDocument();
    expect(screen.getByTestId('automation-builder-condition-0-field-op')).toBeInTheDocument();
    expect(screen.getByTestId('automation-builder-condition-0-field-value')).toBeInTheDocument();
  });

  it('adds a notify action with a channel multi-select built from configured channels', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByTestId('automation-builder-add-action'));
    expect(screen.getByTestId('automation-builder-action-0-channel-inApp')).toBeChecked();
    expect(screen.getByTestId('automation-builder-action-0-channel-discord')).not.toBeChecked();

    fireEvent.click(screen.getByTestId('automation-builder-action-0-channel-discord'));
    expect(screen.getByTestId('automation-builder-action-0-channel-discord')).toBeChecked();
  });

  it('a webhook action shows a URL field, a templated body textarea, and variable hint chips that insert into the body', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByTestId('automation-builder-add-action'));
    fireEvent.change(screen.getByTestId('automation-builder-action-0-type'), { target: { value: 'webhook' } });
    fireEvent.change(screen.getByTestId('automation-builder-action-0-field-url'), { target: { value: 'https://example.com/hook' } });

    fireEvent.click(screen.getByTestId('automation-builder-action-0-field-bodyTemplate-hints-hint-{{beer.name}}'));
    expect(screen.getByTestId('automation-builder-action-0-field-bodyTemplate')).toHaveValue('{{beer.name}}');
  });

  it('a wall_banner action shows text + kind fields; party_mode shows a minutes field', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByTestId('automation-builder-add-action'));
    fireEvent.change(screen.getByTestId('automation-builder-action-0-type'), { target: { value: 'wall_banner' } });
    expect(screen.getByTestId('automation-builder-action-0-field-text')).toBeInTheDocument();
    expect(screen.getByTestId('automation-builder-action-0-field-kind')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('automation-builder-action-0-type'), { target: { value: 'party_mode' } });
    expect(screen.getByTestId('automation-builder-action-0-field-minutes')).toHaveValue(15);
  });

  it('reorders actions up/down', async () => {
    const twoActionRule = rule({
      actions: [
        { type: 'notify', channels: ['inApp'], title: 'First', body: '' },
        { type: 'party_mode', minutes: 10 },
      ],
    });
    renderAdminPage(<AutomationBuilder automation={twoActionRule} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    expect(screen.getAllByTestId(/automation-builder-action-\d+-type/).map((el) => (el as HTMLSelectElement).value))
      .toEqual(['notify', 'party_mode']);

    fireEvent.click(screen.getByTestId('automation-builder-action-1-up'));
    expect(screen.getAllByTestId(/automation-builder-action-\d+-type/).map((el) => (el as HTMLSelectElement).value))
      .toEqual(['party_mode', 'notify']);
  });

  it('toggling "this is an alert" reveals cooldown/auto-resolve/severity fields', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    expect(screen.queryByTestId('automation-builder-alert-severity')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('automation-builder-is-alert'));
    expect(screen.getByTestId('automation-builder-alert-severity')).toBeInTheDocument();
    expect(screen.getByTestId('automation-builder-alert-cooldown')).toHaveValue(60);
  });

  it('save with an empty name shows a friendly error and does not call the API', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByTestId('automation-builder-save'));
    await flush();
    expect(screen.getByTestId('automation-builder-errors')).toHaveTextContent('Name is required.');
    expect(createAutomation).not.toHaveBeenCalled();
  });

  it('saving a new (blank) rule calls createAutomation with the parsed input', async () => {
    const onSaved = vi.fn();
    (createAutomation as Mock).mockResolvedValue({ ok: true, data: rule({ id: 5, name: 'New rule', isAlert: false, alertConfig: undefined }) });
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={onSaved} onCancel={vi.fn()} />);
    await flush();

    fireEvent.change(screen.getByTestId('automation-builder-name'), { target: { value: 'New rule' } });
    fireEvent.click(screen.getByTestId('automation-builder-save'));
    await flush();

    expect(createAutomation).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New rule', trigger: { type: 'pour_completed' }, conditions: [], actions: [],
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('saving an existing rule calls updateAutomation(id, ...)', async () => {
    const onSaved = vi.fn();
    (updateAutomation as Mock).mockResolvedValue({ ok: true, data: rule() });
    renderAdminPage(<AutomationBuilder automation={rule()} canEdit onSaved={onSaved} onCancel={vi.fn()} />);
    await flush();

    fireEvent.click(screen.getByTestId('automation-builder-save'));
    await flush();

    expect(updateAutomation).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Keg low' }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('a server-side save failure shows the message and does not call onSaved', async () => {
    (createAutomation as Mock).mockResolvedValue({ ok: false, status: 400, message: 'trigger: Invalid' });
    const onSaved = vi.fn();
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={onSaved} onCancel={vi.fn()} />);
    await flush();
    fireEvent.change(screen.getByTestId('automation-builder-name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByTestId('automation-builder-save'));
    await flush();
    expect(screen.getByTestId('automation-builder-errors')).toHaveTextContent('trigger: Invalid');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('test-run is only available for an already-saved rule, and shows per-action results', async () => {
    (runAutomation as Mock).mockResolvedValue({
      ok: true, data: { results: [{ type: 'notify', ok: true }, { type: 'webhook', ok: false, error: 'timed out' }] },
    });
    renderAdminPage(<AutomationBuilder automation={rule()} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();

    fireEvent.click(screen.getByTestId('automation-builder-run'));
    await flush();

    expect(runAutomation).toHaveBeenCalledWith(1);
    const results = screen.getByTestId('automation-builder-run-results');
    // Humanized action labels (Task 7 polish fix — the raw enum-ish `r.type` ("notify",
    // "webhook") used to render verbatim here, inconsistent with the same action's own
    // dropdown label just above ("Send notification", "Webhook") — see ACTION_LABELS).
    expect(results).toHaveTextContent('Send notification');
    expect(results).toHaveTextContent('Webhook');
    expect(results).toHaveTextContent('timed out');
  });

  it('a blank (unsaved) rule has no test-run button', async () => {
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    expect(screen.queryByTestId('automation-builder-run')).not.toBeInTheDocument();
  });

  it('a viewer sees every field disabled and no save/run/add/remove controls', async () => {
    renderAdminPage(
      <AutomationBuilder automation={rule()} canEdit={false} onSaved={vi.fn()} onCancel={vi.fn()} />,
      adminContext('viewer'),
    );
    await flush();
    expect(screen.getByTestId('automation-builder-name')).toBeDisabled();
    expect(screen.getByTestId('automation-builder-trigger-type')).toBeDisabled();
    expect(screen.queryByTestId('automation-builder-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automation-builder-add-condition')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automation-builder-add-action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automation-builder-action-0-remove')).not.toBeInTheDocument();
    // `runRuleOnce` genuinely dispatches every real action (not a dry preview) and the
    // server 403s a viewer out of POST /:id/run — the test-run button must not render at
    // all for a read-only viewer, even though `automation` (the rule being viewed) has a
    // real id.
    expect(screen.queryByTestId('automation-builder-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('automation-builder-run-panel')).not.toBeInTheDocument();
  });

  it('cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    renderAdminPage(<AutomationBuilder automation={null} canEdit onSaved={vi.fn()} onCancel={onCancel} />);
    await flush();
    fireEvent.click(screen.getByTestId('automation-builder-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
