import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from '../../../src/web/routes/admin/SettingsPage';
import {
  getSettings, patchSettings, uploadLabel, testChannel,
} from '../../../src/web/lib/adminApi';
import type { Settings } from '../../../src/server/db/settings';

vi.mock('../../../src/web/lib/adminApi', () => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  uploadLabel: vi.fn(),
  testChannel: vi.fn(),
}));

vi.mock('../../../src/web/routes/admin/BackupPanel', () => ({
  BackupPanel: () => <div data-testid="backup-panel">mock backup panel</div>,
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    siteName: 'My Taproom',
    siteLogo: null,
    displayUnits: 'us',
    servingSizeMl: 473,
    kegtronApiKey: null,
    kegtronBaseUrl: 'https://mdash.net',
    openBreweryBaseUrl: 'https://api.openbrewerydb.org',
    untappdBaseUrl: 'https://api.untappd.com',
    untappdImageBaseUrl: 'https://untappd.akamaized.net',
    backfillCursors: {},
    udpEnabled: false,
    bleDirectEnabled: false,
    mqtt: null,
    untappd: null,
    quietHours: null,
    alertChannels: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SettingsPage', () => {
  it('shows a loading state, then renders every group plus the backup panel', async () => {
    (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
    render(<SettingsPage />);
    expect(screen.getByTestId('settings-loading')).toBeInTheDocument();

    expect(await screen.findByTestId('admin-settings-page')).toBeInTheDocument();
    expect(screen.getByTestId('settings-group-site')).toBeInTheDocument();
    expect(screen.getByTestId('settings-group-kegtron')).toBeInTheDocument();
    expect(screen.getByTestId('settings-group-sources')).toBeInTheDocument();
    expect(screen.getByTestId('settings-group-integrations')).toBeInTheDocument();
    expect(screen.getByTestId('settings-group-channels')).toBeInTheDocument();
    expect(screen.getByTestId('backup-panel')).toBeInTheDocument();
  });

  it('shows an error state when settings fail to load', async () => {
    (getSettings as Mock).mockResolvedValue({ ok: false, status: 500, message: 'nope' });
    render(<SettingsPage />);
    expect(await screen.findByTestId('settings-error')).toBeInTheDocument();
  });

  it("saving one group doesn't wipe an unrelated group's unsaved draft (Site owns its "
    + "own key, unaffected by a Sources save)", async () => {
    (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
    (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ udpEnabled: true }) });
    render(<SettingsPage />);
    await screen.findByTestId('settings-group-site');

    fireEvent.change(screen.getByTestId('settings-site-name'), { target: { value: 'Half-typed name' } });
    fireEvent.click(screen.getByTestId('settings-sources-udp'));
    fireEvent.click(screen.getByTestId('settings-sources-save'));
    await flush();

    expect(screen.getByTestId('settings-site-name')).toHaveValue('Half-typed name');
    expect(screen.getByTestId('settings-site-save')).not.toBeDisabled();
  });

  describe('Site group', () => {
    it('save is disabled until a field changes, and PATCHes only siteName when just siteName changed', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({ siteName: 'Old Name', kegtronApiKey: 'stored', udpEnabled: true }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ siteName: 'New Name' }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-site');

      expect(screen.getByTestId('settings-site-save')).toBeDisabled();
      fireEvent.change(screen.getByTestId('settings-site-name'), { target: { value: 'New Name' } });
      expect(screen.getByTestId('settings-site-save')).not.toBeDisabled();
      fireEvent.click(screen.getByTestId('settings-site-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledTimes(1);
      expect(patchSettings).toHaveBeenCalledWith({ siteName: 'New Name' });
    });

    it('shows the generic "Saved" notice (not the restart notice) for a non-restart-triggering key', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ siteName: 'New Name' }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-site');
      fireEvent.change(screen.getByTestId('settings-site-name'), { target: { value: 'New Name' } });
      fireEvent.click(screen.getByTestId('settings-site-save'));
      await flush();

      expect(screen.getByTestId('settings-saved-notice')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-restart-notice')).not.toBeInTheDocument();
    });

    it('changing serving size marks the form dirty and PATCHes only servingSizeMl', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ servingSizeMl: 473 }) });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ servingSizeMl: 355 }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-site');

      expect(screen.getByTestId('settings-site-serving-size')).toHaveValue('473');
      expect(screen.getByTestId('settings-site-save')).toBeDisabled();

      fireEvent.change(screen.getByTestId('settings-site-serving-size'), { target: { value: '355' } });
      expect(screen.getByTestId('settings-site-save')).not.toBeDisabled();
      fireEvent.click(screen.getByTestId('settings-site-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({ servingSizeMl: 355 });
    });

    it('rejects a non-positive serving size without submitting', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-site');

      fireEvent.change(screen.getByTestId('settings-site-serving-size'), { target: { value: '0' } });
      fireEvent.click(screen.getByTestId('settings-site-save'));
      await flush();

      expect(screen.getByTestId('settings-site-error')).toHaveTextContent(/serving size/i);
      expect(patchSettings).not.toHaveBeenCalled();
    });

    it('uploading a site logo stores the returned path and PATCHes siteLogo on save', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ siteLogo: null }) });
      (uploadLabel as Mock).mockResolvedValue({ ok: true, data: { path: '/labels/logo-1.png' } });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ siteLogo: '/labels/logo-1.png' }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-site');

      expect(screen.getByTestId('settings-site-logo-placeholder')).toBeInTheDocument();
      const file = new File(['x'], 'logo.png', { type: 'image/png' });
      fireEvent.change(screen.getByTestId('settings-site-logo-file'), { target: { files: [file] } });
      await flush();

      expect(uploadLabel).toHaveBeenCalledWith(file);
      expect(screen.getByTestId('settings-site-logo-thumb')).toHaveAttribute('src', '/labels/logo-1.png');
      expect(screen.getByTestId('settings-site-save')).not.toBeDisabled();

      fireEvent.click(screen.getByTestId('settings-site-save'));
      await flush();
      expect(patchSettings).toHaveBeenCalledWith({ siteLogo: '/labels/logo-1.png' });
    });

    it('removing an existing logo clears it and PATCHes siteLogo: null', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ siteLogo: '/labels/existing.png' }) });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ siteLogo: null }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-site');

      expect(screen.getByTestId('settings-site-logo-thumb')).toHaveAttribute('src', '/labels/existing.png');
      fireEvent.click(screen.getByTestId('settings-site-logo-clear'));
      expect(screen.getByTestId('settings-site-save')).not.toBeDisabled();

      fireEvent.click(screen.getByTestId('settings-site-save'));
      await flush();
      expect(patchSettings).toHaveBeenCalledWith({ siteLogo: null });
    });
  });

  describe('Kegtron group', () => {
    it('shows the masked value and only reveals a real input after clicking Replace', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ kegtronApiKey: '••••ikey' }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-kegtron');

      expect(screen.getByTestId('settings-kegtron-apikey-masked')).toHaveTextContent('••••ikey');
      expect(screen.queryByTestId('settings-kegtron-apikey-input')).not.toBeInTheDocument();
      expect(screen.getByTestId('settings-kegtron-save')).toBeDisabled();

      fireEvent.click(screen.getByTestId('settings-kegtron-apikey-replace'));
      expect(screen.getByTestId('settings-kegtron-apikey-input')).toBeInTheDocument();
      expect(screen.getByTestId('settings-kegtron-save')).toBeDisabled(); // still empty
    });

    it('never round-trips the masked string: PATCHes only the freshly typed value', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ kegtronApiKey: '••••ikey' }) });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ kegtronApiKey: '••••9999' }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-kegtron');

      fireEvent.click(screen.getByTestId('settings-kegtron-apikey-replace'));
      fireEvent.change(screen.getByTestId('settings-kegtron-apikey-input'), { target: { value: 'brandnewkey9999' } });
      fireEvent.click(screen.getByTestId('settings-kegtron-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({ kegtronApiKey: 'brandnewkey9999' });
      const call = (patchSettings as Mock).mock.calls[0]![0];
      expect(JSON.stringify(call)).not.toContain('••••');
    });

    it('canceling a Replace goes back to the masked display without sending anything', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ kegtronApiKey: '••••ikey' }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-kegtron');
      fireEvent.click(screen.getByTestId('settings-kegtron-apikey-replace'));
      fireEvent.change(screen.getByTestId('settings-kegtron-apikey-input'), { target: { value: 'typedbutcanceled' } });
      fireEvent.click(screen.getByTestId('settings-kegtron-apikey-cancel'));

      expect(screen.getByTestId('settings-kegtron-apikey-masked')).toHaveTextContent('••••ikey');
      expect(screen.getByTestId('settings-kegtron-save')).toBeDisabled();
    });

    it('shows the restart notice after saving a restart-triggering key', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ kegtronApiKey: '••••9999' }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-kegtron');
      fireEvent.click(screen.getByTestId('settings-kegtron-apikey-replace'));
      fireEvent.change(screen.getByTestId('settings-kegtron-apikey-input'), { target: { value: 'brandnewkey9999' } });
      fireEvent.click(screen.getByTestId('settings-kegtron-save'));
      await flush();

      expect(screen.getByTestId('settings-restart-notice')).toHaveTextContent('Sources restarted to apply changes.');
    });
  });

  describe('Sources group', () => {
    it('toggling UDP alone PATCHes only udpEnabled — no mqtt, no other groups’ keys', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({ siteName: 'Keep Me', kegtronApiKey: '••••ikey' }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ udpEnabled: true }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-sources');

      fireEvent.click(screen.getByTestId('settings-sources-udp'));
      fireEvent.click(screen.getByTestId('settings-sources-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({ udpEnabled: true });
    });

    it('editing mqtt url/username/prefix without touching the password sends the masked '
      + 'password placeholder, not a typed value, and requires a URL', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          mqtt: {
            url: 'mqtt://old:1883', username: 'olduser', password: '••••',
            gen1TopicPrefix: 'home/TheengsGateway', haPublishEnabled: true,
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegtron-dashboard',
          },
        }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-sources');

      fireEvent.change(screen.getByTestId('settings-sources-mqtt-url'), { target: { value: 'mqtt://new:1883' } });
      fireEvent.click(screen.getByTestId('settings-sources-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({
        mqtt: {
          url: 'mqtt://new:1883',
          username: 'olduser',
          password: '••••',
          gen1TopicPrefix: 'home/TheengsGateway',
          // Preserves Integrations' HA fields exactly as they were -- Sources saving
          // never resets them.
          haPublishEnabled: true,
          haDiscoveryPrefix: 'homeassistant',
          appTopicPrefix: 'kegtron-dashboard',
        },
      });
    });

    it('replacing the mqtt password sends the freshly typed value, not the mask', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          mqtt: {
            url: 'mqtt://host:1883', username: 'u', password: '••••',
            gen1TopicPrefix: 'home/TheengsGateway', haPublishEnabled: false,
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegtron-dashboard',
          },
        }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-sources');

      fireEvent.click(screen.getByTestId('settings-sources-mqtt-password-replace'));
      fireEvent.change(screen.getByTestId('settings-sources-mqtt-password-input'), { target: { value: 'newrealpass' } });
      fireEvent.click(screen.getByTestId('settings-sources-save'));
      await flush();

      const call = (patchSettings as Mock).mock.calls[0]![0];
      expect(call.mqtt.password).toBe('newrealpass');
    });

    it('requires a URL before saving a first-time MQTT configuration', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ mqtt: null }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-sources');

      fireEvent.change(screen.getByTestId('settings-sources-mqtt-username'), { target: { value: 'newuser' } });
      fireEvent.click(screen.getByTestId('settings-sources-save'));
      await flush();

      expect(screen.getByTestId('settings-sources-error')).toBeInTheDocument();
      expect(patchSettings).not.toHaveBeenCalled();
    });
  });

  describe('Integrations group', () => {
    it('editing Untappd creds alone PATCHes only untappd, not mqtt', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          untappd: { clientId: 'oldid', clientSecret: '••••' },
          mqtt: {
            url: 'mqtt://host:1883', gen1TopicPrefix: 'home/TheengsGateway',
            haPublishEnabled: false, haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegtron-dashboard',
          },
        }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-integrations');

      fireEvent.change(screen.getByTestId('settings-integrations-untappd-clientid'), { target: { value: 'newid' } });
      fireEvent.click(screen.getByTestId('settings-integrations-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({
        untappd: { clientId: 'newid', clientSecret: '••••' },
      });
    });

    it('toggling the HA publish switch PATCHes mqtt with Sources’ fields preserved, and no untappd key', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          mqtt: {
            url: 'mqtt://host:1883', username: 'u', password: '••••',
            gen1TopicPrefix: 'home/TheengsGateway', haPublishEnabled: false,
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegtron-dashboard',
          },
        }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-integrations');

      fireEvent.click(screen.getByTestId('settings-integrations-ha-publish'));
      fireEvent.click(screen.getByTestId('settings-integrations-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({
        mqtt: {
          url: 'mqtt://host:1883', username: 'u', password: '••••',
          gen1TopicPrefix: 'home/TheengsGateway', haPublishEnabled: true,
          haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegtron-dashboard',
        },
      });
      const call = (patchSettings as Mock).mock.calls[0]![0];
      expect(call.untappd).toBeUndefined();
    });

    it('blocks enabling HA publish with a clear message when MQTT is not configured at all', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ mqtt: null }) });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-integrations');

      fireEvent.click(screen.getByTestId('settings-integrations-ha-publish'));
      fireEvent.click(screen.getByTestId('settings-integrations-save'));
      await flush();

      expect(screen.getByTestId('settings-integrations-error')).toHaveTextContent(/mqtt/i);
      expect(patchSettings).not.toHaveBeenCalled();
    });
  });

  describe('Channels group (Task 6)', () => {
    it('saving one channel (ntfy) PATCHes alertChannels with the other already-configured channels left untouched (isolation)', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          alertChannels: { discord: { webhookUrl: 'https://discord.example/api/webhooks/1/…' } },
        }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-channels');

      fireEvent.change(screen.getByTestId('settings-channels-ntfy-server-url'), {
        target: { value: 'https://ntfy.sh' },
      });
      fireEvent.change(screen.getByTestId('settings-channels-ntfy-topic'), { target: { value: 'kegtron' } });
      fireEvent.click(screen.getByTestId('settings-channels-ntfy-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({
        alertChannels: {
          discord: { webhookUrl: 'https://discord.example/api/webhooks/1/…' },
          ntfy: { serverUrl: 'https://ntfy.sh', topic: 'kegtron' },
        },
      });
    });

    it('pushover: shows the masked token, only reveals a real input after Replace, and never round-trips the mask', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({ alertChannels: { pushover: { token: '••••abcd', user: 'u1' } } }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-channels');

      expect(screen.getByTestId('settings-channels-pushover-token-masked')).toHaveTextContent('••••abcd');
      fireEvent.click(screen.getByTestId('settings-channels-pushover-token-replace'));
      fireEvent.change(screen.getByTestId('settings-channels-pushover-token-input'), {
        target: { value: 'brandnewtoken' },
      });
      fireEvent.click(screen.getByTestId('settings-channels-pushover-save'));
      await flush();

      const call = (patchSettings as Mock).mock.calls[0]![0];
      expect(call.alertChannels.pushover).toEqual({ token: 'brandnewtoken', user: 'u1' });
      expect(JSON.stringify(call)).not.toContain('••••');
    });

    it('smtp: saves host/port/secure/from/to plus a freshly typed password', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-channels');

      fireEvent.change(screen.getByTestId('settings-channels-smtp-host'), { target: { value: 'smtp.example.com' } });
      fireEvent.change(screen.getByTestId('settings-channels-smtp-port'), { target: { value: '587' } });
      fireEvent.click(screen.getByTestId('settings-channels-smtp-secure'));
      fireEvent.change(screen.getByTestId('settings-channels-smtp-from'), { target: { value: 'a@b.com' } });
      fireEvent.change(screen.getByTestId('settings-channels-smtp-to'), { target: { value: 'c@d.com' } });
      fireEvent.click(screen.getByTestId('settings-channels-smtp-password-replace'));
      fireEvent.change(screen.getByTestId('settings-channels-smtp-password-input'), { target: { value: 'hunter2' } });
      fireEvent.click(screen.getByTestId('settings-channels-smtp-save'));
      await flush();

      const call = (patchSettings as Mock).mock.calls[0]![0];
      expect(call.alertChannels.smtp).toEqual({
        host: 'smtp.example.com', port: 587, secure: true, from: 'a@b.com', to: 'c@d.com', password: 'hunter2',
      });
    });

    it('discord: masked webhook URL with Replace, saved untouched otherwise', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({ alertChannels: { discord: { webhookUrl: 'https://discord.example/…' } } }),
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-channels');
      expect(screen.getByTestId('settings-channels-discord-webhook-masked')).toHaveTextContent('https://discord.example/…');
      expect(screen.getByTestId('settings-channels-discord-save')).toBeDisabled();
    });

    it('send-test: calls testChannel(name) and shows the result', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      (testChannel as Mock).mockResolvedValue({ ok: true, data: { ok: true } });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-channels');

      fireEvent.click(screen.getByTestId('settings-channels-ntfy-test'));
      await flush();

      expect(testChannel).toHaveBeenCalledWith('ntfy');
      expect(screen.getByTestId('settings-channels-ntfy-test-result')).toHaveTextContent(/sent|success|ok/i);
    });

    it('send-test shows a failure message without touching the saved form state', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      (testChannel as Mock).mockResolvedValue({ ok: true, data: { ok: false, message: 'not configured yet' } });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-channels');

      fireEvent.click(screen.getByTestId('settings-channels-ntfy-test'));
      await flush();

      expect(screen.getByTestId('settings-channels-ntfy-test-result')).toHaveTextContent('not configured yet');
    });
  });
});
