import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HaSetupWizard } from '../../src/web/components/HaSetupWizard';
import { testMqttConnection, patchSettings } from '../../src/web/lib/adminApi';

vi.mock('../../src/web/lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/adminApi')>()),
  testMqttConnection: vi.fn(),
  patchSettings: vi.fn(),
}));

// The component only reads settings.mqtt — a partial cast is enough.
const unconfigured = { mqtt: null } as any;

beforeEach(() => { vi.clearAllMocks(); });

describe('HaSetupWizard', () => {
  it('tests the connection and renders the live result', async () => {
    (testMqttConnection as any).mockResolvedValue({ ok: true, data: { ok: true, detail: 'Connected to the broker' } });
    render(<HaSetupWizard settings={unconfigured} />);
    fireEvent.change(screen.getByTestId('ha-wizard-url'), { target: { value: 'mqtt://ha:1883' } });
    fireEvent.click(screen.getByTestId('ha-wizard-test'));
    expect(await screen.findByTestId('ha-wizard-test-ok')).toHaveTextContent('Connected to the broker');
    expect(testMqttConnection).toHaveBeenCalledWith({ url: 'mqtt://ha:1883', username: undefined, password: undefined });
  });

  it('renders a failed test result', async () => {
    (testMqttConnection as any).mockResolvedValue({ ok: true, data: { ok: false, detail: 'Broker rejected the credentials' } });
    render(<HaSetupWizard settings={unconfigured} />);
    fireEvent.change(screen.getByTestId('ha-wizard-url'), { target: { value: 'mqtt://ha:1883' } });
    fireEvent.click(screen.getByTestId('ha-wizard-test'));
    expect(await screen.findByTestId('ha-wizard-test-fail')).toHaveTextContent('rejected the credentials');
  });

  it('walks the steps and saves the merged mqtt with haPublishEnabled, omitting a blank password', async () => {
    (patchSettings as any).mockResolvedValue({ ok: true, data: {} });
    const onSaved = vi.fn();
    render(<HaSetupWizard settings={unconfigured} onSaved={onSaved} />);

    fireEvent.change(screen.getByTestId('ha-wizard-url'), { target: { value: 'mqtt://ha:1883' } });
    fireEvent.change(screen.getByTestId('ha-wizard-username'), { target: { value: 'user' } });
    fireEvent.click(screen.getByTestId('ha-wizard-next'));
    fireEvent.click(screen.getByTestId('ha-wizard-next-2'));
    fireEvent.click(screen.getByTestId('ha-wizard-save'));

    await waitFor(() => expect(patchSettings).toHaveBeenCalled());
    const patch = (patchSettings as any).mock.calls[0][0];
    expect(patch.mqtt.url).toBe('mqtt://ha:1883');
    expect(patch.mqtt.username).toBe('user');
    expect(patch.mqtt.haPublishEnabled).toBe(true);
    expect('password' in patch.mqtt).toBe(false); // blank → kept, not overwritten
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('sends the typed password when one is entered', async () => {
    (patchSettings as any).mockResolvedValue({ ok: true, data: {} });
    render(<HaSetupWizard settings={unconfigured} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByTestId('ha-wizard-url'), { target: { value: 'mqtt://ha:1883' } });
    fireEvent.change(screen.getByTestId('ha-wizard-password'), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByTestId('ha-wizard-next'));
    fireEvent.click(screen.getByTestId('ha-wizard-next-2'));
    fireEvent.click(screen.getByTestId('ha-wizard-save'));
    await waitFor(() => expect(patchSettings).toHaveBeenCalled());
    expect((patchSettings as any).mock.calls[0][0].mqtt.password).toBe('s3cret');
  });

  it('Skip calls onCancel', () => {
    const onCancel = vi.fn();
    render(<HaSetupWizard settings={unconfigured} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('ha-wizard-skip'));
    expect(onCancel).toHaveBeenCalled();
  });
});
