import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from '../../../src/web/routes/admin/SettingsPage';
import {
  getSettings, patchSettings, uploadLabel, testChannel, checkForUpdates, triggerUpdate,
  triggerOsUpdate,
} from '../../../src/web/lib/adminApi';
import type { Settings } from '../../../src/server/db/settings';

vi.mock('../../../src/web/lib/adminApi', () => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  uploadLabel: vi.fn(),
  testChannel: vi.fn(),
  getSystemVersion: vi.fn().mockResolvedValue({ ok: true, data: { version: '0.0.0-test' } }),
  checkForUpdates: vi.fn(),
  triggerUpdate: vi.fn(),
  pollSystemVersion: vi.fn().mockResolvedValue(null),
  pollUpdateStatus: vi.fn().mockResolvedValue(null),
  triggerOsUpdate: vi.fn(),
  triggerKioskRestart: vi.fn(),
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
    logRetentionDays: 30,
    autoImportBeers: true,
    pricing: { enabled: false, markupPct: 245, taxPct: 0, rounding: 0.25 },
    govee: null,
    goveeBaseUrl: 'https://openapi.api.govee.com',
    updateCheckBaseUrl: 'https://github.com',
    updateCheckProjectPath: 'dlomm/kegwall',
    updates: null,
    osUpdates: null,
    kegtronApiKey: null,
    kegtronBaseUrl: 'https://mdash.net',
    openBreweryBaseUrl: 'https://api.openbrewerydb.org',
    untappdImageBaseUrl: 'https://untappd.akamaized.net',
    catalogBeer: null,
    catalogBeerBaseUrl: 'https://catalog.beer',
    backfillCursors: {},
    udpEnabled: false,
    bleDirectEnabled: false,
    proBleEnabled: false,
    mqtt: null,
    motionSources: [],
    quietHours: null,
    presenceWebhookToken: null,
    faceSignIn: { enabled: false, threshold: 0.6 },
    displays: { enforceToken: false },
    alertChannels: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Tab clicks write ?tab= via history.replaceState and jsdom's URL persists across
  // tests — reset so every test starts on the default tab.
  window.history.replaceState(null, '', '/');
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

    it('the "Saved." notice auto-clears after a few seconds instead of sticking forever', async () => {
      vi.useFakeTimers();
      try {
        (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
        (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ siteName: 'New Name' }) });
        render(<SettingsPage />);
        await flush(); // resolve getSettings (findBy* would spin under fake timers)
        fireEvent.change(screen.getByTestId('settings-site-name'), { target: { value: 'New Name' } });
        fireEvent.click(screen.getByTestId('settings-site-save'));
        await flush();

        expect(screen.getByTestId('settings-saved-notice')).toBeInTheDocument();
        act(() => {
          vi.advanceTimersByTime(4_000);
        });
        expect(screen.queryByTestId('settings-saved-notice')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
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

  describe('Pricing group (4k)', () => {
    it('enabling the toggle + markup PATCHes the whole pricing object and shows the who-sees-what note', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      (patchSettings as Mock).mockResolvedValue({
        ok: true, data: baseSettings({ pricing: { enabled: true, markupPct: 200, taxPct: 0, rounding: 0.5 } }),
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-pricing');

      expect(screen.getByTestId('settings-pricing-matrix')).toHaveTextContent('never your cost');
      expect(screen.getByTestId('settings-pricing-save')).toBeDisabled();
      fireEvent.click(screen.getByTestId('settings-pricing-enabled'));
      fireEvent.change(screen.getByTestId('settings-pricing-markup'), { target: { value: '200' } });
      fireEvent.change(screen.getByTestId('settings-pricing-rounding'), { target: { value: '0.5' } });
      fireEvent.click(screen.getByTestId('settings-pricing-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({ pricing: { enabled: true, markupPct: 200, taxPct: 0, rounding: 0.5 } });
    });

    it('rejects an out-of-range markup without calling the server', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-pricing');
      fireEvent.change(screen.getByTestId('settings-pricing-markup'), { target: { value: '9999' } });
      fireEvent.click(screen.getByTestId('settings-pricing-save'));
      await flush();
      expect(screen.getByTestId('settings-pricing-error')).toBeInTheDocument();
      expect(patchSettings).not.toHaveBeenCalled();
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
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall', motionTopics: [],
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
          appTopicPrefix: 'kegwall',
          // Displays & Presence hub Task 5: `motionTopics` is deliberately ABSENT — see
          // the "never sends motionTopics" test below.
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
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall', motionTopics: [],
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

    // Displays & Presence hub Task 5: the motion-topics repeater that used to live here
    // (Task 12) is REMOVED — the `motionSources` registry (PresencePage.tsx's Sources
    // panel) owns motion configuration now. `mqtt.motionTopics` stays in the settings
    // schema purely so `core/motionSources.ts`'s boot-time migration can still read and
    // clear a pre-upgrade value; this form never writes it again. This test is the
    // inversion of the old Plan A "preserves motionTopics verbatim" test: instead of
    // proving an untouched value round-trips unchanged, it proves the key is never sent
    // AT ALL from this save handler, regardless of what was previously stored.
    it('never sends motionTopics — the motionSources registry owns motion config now', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          mqtt: {
            url: 'mqtt://host:1883', username: 'u', password: '••••',
            gen1TopicPrefix: 'home/TheengsGateway', haPublishEnabled: false,
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
            motionTopics: [{ topic: 'sensors/bar/motion', wallSlug: 'main-bar' }],
          },
        }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-sources');

      fireEvent.change(screen.getByTestId('settings-sources-mqtt-url'), { target: { value: 'mqtt://new:1883' } });
      fireEvent.click(screen.getByTestId('settings-sources-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledTimes(1);
      const call = (patchSettings as Mock).mock.calls[0]![0];
      expect(call.mqtt).not.toHaveProperty('motionTopics');
    });

    it('has no motion-topics repeater UI at all', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          mqtt: {
            url: 'mqtt://host:1883', username: 'u', password: '••••',
            gen1TopicPrefix: 'home/TheengsGateway', haPublishEnabled: false,
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall',
            motionTopics: [{ topic: 'sensors/bar/motion', wallSlug: 'main-bar' }],
          },
        }),
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-sources');

      expect(screen.queryByTestId('settings-sources-mqtt-motion-topics')).not.toBeInTheDocument();
      expect(screen.queryByTestId('settings-sources-mqtt-motion-add')).not.toBeInTheDocument();
    });
  });

  describe('Integrations group', () => {
    it('has no Untappd fields (integration removed)', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-integrations');

      expect(screen.queryByTestId('settings-integrations-untappd-clientid')).not.toBeInTheDocument();
      expect(screen.queryByTestId('settings-integrations-untappd-secret-field')).not.toBeInTheDocument();
    });

    it('toggling the HA publish switch PATCHes mqtt with Sources’ fields preserved', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          mqtt: {
            url: 'mqtt://host:1883', username: 'u', password: '••••',
            gen1TopicPrefix: 'home/TheengsGateway', haPublishEnabled: false,
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall', motionTopics: [],
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
          haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall', motionTopics: [],
        },
      });
    });

    // Regression: the group used to carry ONE composite remount key
    // (`integrations-${mqttVersion}-${catalogBeerVersion}-${faceSignInVersion}`), so
    // saving ANY block remounted EVERY sibling and silently discarded their unsaved
    // drafts. Each block is now keyed by its own counter — only the saved block remounts.
    it("saving Home Assistant doesn't wipe unsaved drafts in sibling integrations blocks", async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          mqtt: {
            url: 'mqtt://host:1883', username: 'u', password: '••••',
            gen1TopicPrefix: 'home/TheengsGateway', haPublishEnabled: false,
            haDiscoveryPrefix: 'homeassistant', appTopicPrefix: 'kegwall', motionTopics: [],
          },
        }),
      });
      (patchSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-integrations');

      // Half-typed drafts in three sibling blocks that share nothing with `mqtt`.
      fireEvent.click(screen.getByTestId('settings-integrations-govee-apikey-replace'));
      fireEvent.change(screen.getByTestId('settings-integrations-govee-apikey-input'), {
        target: { value: 'half-typed-govee-key' },
      });
      fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-apikey-replace'));
      fireEvent.change(screen.getByTestId('settings-integrations-catalogbeer-apikey-input'), {
        target: { value: 'half-typed-catalogbeer-key' },
      });
      fireEvent.change(screen.getByLabelText(/match threshold/i), { target: { value: '0.75' } });

      // Save a DIFFERENT block (Home Assistant — bumps the shared mqtt counter).
      fireEvent.click(screen.getByTestId('settings-integrations-ha-publish'));
      fireEvent.click(screen.getByTestId('settings-integrations-save'));
      await flush();

      expect(screen.getByTestId('settings-integrations-govee-apikey-input')).toHaveValue('half-typed-govee-key');
      expect(screen.getByTestId('settings-integrations-catalogbeer-apikey-input')).toHaveValue('half-typed-catalogbeer-key');
      expect(screen.getByLabelText(/match threshold/i)).toHaveValue(0.75);
    });

    // Regression: GoveeBlock's onSaved was miswired to the CATALOG.BEER version counter,
    // so a Govee save remounted the sibling CatalogBeerBlock and wiped its draft. It now
    // bumps its own `goveeVersion` counter only.
    it("saving Govee doesn't wipe an unsaved catalog.beer API key draft in the sibling block", async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      (patchSettings as Mock).mockResolvedValue({
        ok: true, data: baseSettings({ autoImportBeers: false }),
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-integrations');

      fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-apikey-replace'));
      fireEvent.change(screen.getByTestId('settings-integrations-catalogbeer-apikey-input'), {
        target: { value: 'half-typed-catalogbeer-key' },
      });

      fireEvent.click(screen.getByTestId('settings-integrations-auto-import'));
      fireEvent.click(screen.getByTestId('settings-integrations-govee-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({ autoImportBeers: false });
      expect(screen.getByTestId('settings-integrations-catalogbeer-apikey-input')).toHaveValue('half-typed-catalogbeer-key');
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

    // catalog.beer beer search (replaces the removed Untappd search) — an independent
    // masked-secret block within Integrations, same Replace affordance as Kegtron's own
    // API key, plus a one-line note about the 1,000 requests/month free tier.
    describe('Catalog.beer block', () => {
      it('shows the masked value, a free-tier note, and only reveals a real input after Replace', async () => {
        (getSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ catalogBeer: { apiKey: '••••-key' } }),
        });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');

        expect(screen.getByTestId('settings-integrations-catalogbeer-apikey-masked')).toHaveTextContent('••••-key');
        expect(screen.queryByTestId('settings-integrations-catalogbeer-apikey-input')).not.toBeInTheDocument();
        expect(screen.getByTestId('settings-integrations-catalogbeer-save')).toBeDisabled();
        expect(screen.getByTestId('settings-integrations-catalogbeer')).toHaveTextContent(/1,000 requests\/month/i);

        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-apikey-replace'));
        expect(screen.getByTestId('settings-integrations-catalogbeer-apikey-input')).toBeInTheDocument();
        expect(screen.getByTestId('settings-integrations-catalogbeer-save')).toBeDisabled(); // still empty
      });

      it('shows "Not set" when catalog.beer has never been configured', async () => {
        (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ catalogBeer: null }) });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');
        expect(screen.getByTestId('settings-integrations-catalogbeer-apikey-masked')).toHaveTextContent('Not set');
      });

      it('never round-trips the masked string: PATCHes only the freshly typed apiKey, as {catalogBeer: {apiKey}}', async () => {
        (getSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ catalogBeer: { apiKey: '••••-key' } }),
        });
        (patchSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ catalogBeer: { apiKey: '••••9999' } }),
        });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');

        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-apikey-replace'));
        fireEvent.change(screen.getByTestId('settings-integrations-catalogbeer-apikey-input'), {
          target: { value: 'brandnewcatalogbeerkey9999' },
        });
        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-save'));
        await flush();

        expect(patchSettings).toHaveBeenCalledWith({ catalogBeer: { apiKey: 'brandnewcatalogbeerkey9999' } });
        const call = (patchSettings as Mock).mock.calls[0]![0];
        expect(JSON.stringify(call)).not.toContain('••••');
      });

      it('canceling a Replace goes back to the masked display without sending anything', async () => {
        (getSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ catalogBeer: { apiKey: '••••-key' } }),
        });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');
        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-apikey-replace'));
        fireEvent.change(screen.getByTestId('settings-integrations-catalogbeer-apikey-input'), {
          target: { value: 'typedbutcanceled' },
        });
        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-apikey-cancel'));

        expect(screen.getByTestId('settings-integrations-catalogbeer-apikey-masked')).toHaveTextContent('••••-key');
        expect(screen.getByTestId('settings-integrations-catalogbeer-save')).toBeDisabled();
        expect(patchSettings).not.toHaveBeenCalled();
      });

      it('does NOT show the "Sources restarted" notice — catalog.beer backs no ingest source', async () => {
        (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
        (patchSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ catalogBeer: { apiKey: '••••9999' } }),
        });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');
        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-apikey-replace'));
        fireEvent.change(screen.getByTestId('settings-integrations-catalogbeer-apikey-input'), {
          target: { value: 'brandnewcatalogbeerkey9999' },
        });
        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-save'));
        await flush();

        expect(screen.queryByTestId('settings-restart-notice')).not.toBeInTheDocument();
        expect(screen.getByTestId('settings-saved-notice')).toBeInTheDocument();
      });

      it("saving Catalog.beer doesn't wipe an unsaved MQTT draft mid-edit in the Sources group", async () => {
        (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
        (patchSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ catalogBeer: { apiKey: '••••9999' } }),
        });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-sources');

        fireEvent.change(screen.getByTestId('settings-sources-mqtt-url'), { target: { value: 'mqtt://half-typed:1883' } });

        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-apikey-replace'));
        fireEvent.change(screen.getByTestId('settings-integrations-catalogbeer-apikey-input'), {
          target: { value: 'brandnewcatalogbeerkey9999' },
        });
        fireEvent.click(screen.getByTestId('settings-integrations-catalogbeer-save'));
        await flush();

        expect(screen.getByTestId('settings-sources-mqtt-url')).toHaveValue('mqtt://half-typed:1883');
      });
    });

    // Displays & Presence hub Task 5: the Presence card's masked-token/Generate/"Wake all
    // screens" mechanics (Task 12) MOVED to `/admin/presence`'s Webhook & agent panel
    // (see PresencePage.test.tsx) — this card is now just a pointer link, so this is the
    // only assertion left about it here.
    describe('Presence block', () => {
      it('is a pointer card linking to the Displays & Presence hub, with no token/wake UI of its own', async () => {
        (getSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ presenceWebhookToken: 'a-real-token' }),
        });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');

        const link = screen.getByTestId('presence-hub-link');
        expect(link).toHaveAttribute('href', '/admin/presence');
        expect(screen.queryByTestId('settings-integrations-presence-token-masked')).not.toBeInTheDocument();
        expect(screen.queryByTestId('settings-integrations-presence-generate')).not.toBeInTheDocument();
        expect(screen.queryByTestId('settings-integrations-presence-wake-all')).not.toBeInTheDocument();
        // The real token itself is never rendered anywhere on this page anymore either.
        expect(screen.queryByText('a-real-token')).not.toBeInTheDocument();
      });
    });

    // Task 9 (Plan B): the Face sign-in card — global enabled gate + match threshold,
    // both plain fields (not a secret), saved through the normal patchSettings path. Same
    // "own independent key, own counter" block shape as PresenceBlock/CatalogBeerBlock
    // above — faceSignIn shares nothing with mqtt/catalogBeer/presenceWebhookToken.
    describe('Face sign-in block', () => {
      it('save is disabled until a field changes', async () => {
        (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');

        expect(screen.getByTestId('settings-integrations-facesignin-save')).toBeDisabled();
      });

      it('saves the face sign-in toggle and threshold', async () => {
        (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
        (patchSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ faceSignIn: { enabled: true, threshold: 0.7 } }),
        });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');

        fireEvent.click(await screen.findByLabelText(/enable face sign-in/i));
        fireEvent.change(screen.getByLabelText(/match threshold/i), { target: { value: '0.7' } });
        fireEvent.click(screen.getByTestId('settings-integrations-facesignin-save'));
        await flush();

        expect(patchSettings).toHaveBeenCalledWith(
          expect.objectContaining({ faceSignIn: { enabled: true, threshold: 0.7 } }),
        );
      });

      it('rejects a threshold outside 0.3-0.95 without submitting', async () => {
        (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');

        fireEvent.change(screen.getByLabelText(/match threshold/i), { target: { value: '0.99' } });
        fireEvent.click(screen.getByTestId('settings-integrations-facesignin-save'));
        await flush();

        expect(screen.getByTestId('settings-integrations-facesignin-error')).toHaveTextContent(/threshold/i);
        expect(patchSettings).not.toHaveBeenCalled();
      });

      it('does NOT show the "Sources restarted" notice — faceSignIn backs no ingest source', async () => {
        (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
        (patchSettings as Mock).mockResolvedValue({
          ok: true, data: baseSettings({ faceSignIn: { enabled: true, threshold: 0.6 } }),
        });
        render(<SettingsPage />);
        await screen.findByTestId('settings-group-integrations');

        fireEvent.click(screen.getByLabelText(/enable face sign-in/i));
        fireEvent.click(screen.getByTestId('settings-integrations-facesignin-save'));
        await flush();

        expect(screen.queryByTestId('settings-restart-notice')).not.toBeInTheDocument();
        expect(screen.getByTestId('settings-saved-notice')).toBeInTheDocument();
      });
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

  describe('System group (in-app updates)', () => {
    it('renders the card with the version, off-mode hint, and a disabled Update button', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-system');
      await flush();

      expect(screen.getByTestId('settings-system-version')).toHaveTextContent('v0.0.0-test');
      expect(screen.getByTestId('settings-system-off-hint')).toBeInTheDocument();
      expect(screen.getByTestId('settings-system-update')).toBeDisabled();
      // Watchtower fields hidden while mode is off.
      expect(screen.queryByTestId('settings-system-watchtower-url')).not.toBeInTheDocument();
    });

    it('watchtower mode reveals url + masked token, and saving PATCHes the updates key', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      (patchSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          updates: { mode: 'watchtower', watchtowerUrl: 'http://127.0.0.1:8090', watchtowerToken: '••••cdef' },
        }),
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-system');

      fireEvent.change(screen.getByTestId('settings-system-mode'), { target: { value: 'watchtower' } });
      fireEvent.change(screen.getByTestId('settings-system-watchtower-url'), {
        target: { value: 'http://127.0.0.1:8090' },
      });
      fireEvent.click(screen.getByTestId('settings-system-watchtower-token-replace'));
      fireEvent.change(screen.getByTestId('settings-system-watchtower-token-input'), {
        target: { value: 'abcdef' },
      });
      fireEvent.click(screen.getByTestId('settings-system-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({
        updates: { mode: 'watchtower', watchtowerUrl: 'http://127.0.0.1:8090', watchtowerToken: 'abcdef' },
      });
    });

    it('check-for-updates runs and shows the available-version line with a notes link', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true, data: baseSettings({ updates: { mode: 'native' } }),
      });
      (checkForUpdates as Mock).mockResolvedValue({
        ok: true,
        data: { ok: true, current: '0.0.0-test', latest: '9.0.0', updateAvailable: true, notesUrl: 'https://x/releases/v9.0.0' },
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-system');
      // Role queries respect the hidden attribute — reveal the System tab first.
      fireEvent.click(screen.getByTestId('settings-tab-system'));

      fireEvent.click(screen.getByTestId('settings-system-check'));
      await flush();

      expect(screen.getByTestId('settings-system-check-result')).toHaveTextContent('v9.0.0 available');
      expect(screen.getByRole('link', { name: /release notes/i })).toHaveAttribute('href', 'https://x/releases/v9.0.0');
    });

    it('Update now needs the two-step confirm, then triggers and shows the updating banner', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true, data: baseSettings({ updates: { mode: 'native' } }),
      });
      (triggerUpdate as Mock).mockResolvedValue({ ok: true, data: { mode: 'native' } });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-system');
      await flush();

      fireEvent.click(screen.getByTestId('settings-system-update'));
      expect(triggerUpdate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('settings-system-update-confirm'));
      await flush();

      expect(triggerUpdate).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('settings-system-updating')).toBeInTheDocument();
    });

    it('a trigger failure (e.g. mode not configured server-side) surfaces the message', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true, data: baseSettings({ updates: { mode: 'native' } }),
      });
      (triggerUpdate as Mock).mockResolvedValue({ ok: false, status: 409, message: 'pick a mode first' });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-system');
      await flush();

      fireEvent.click(screen.getByTestId('settings-system-update'));
      fireEvent.click(screen.getByTestId('settings-system-update-confirm'));
      await flush();

      expect(screen.getByTestId('settings-system-update-error')).toHaveTextContent('pick a mode first');
    });
  });

  describe('tabs', () => {
    it('defaults to General, hides the other panels, and switching reveals them', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-tabs');

      expect(screen.getByTestId('settings-panel-general')).toBeVisible();
      expect(screen.getByTestId('settings-panel-system')).not.toBeVisible();
      // Hidden, but still MOUNTED — drafts and version-counter keys survive.
      expect(screen.getByTestId('settings-group-system')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('settings-tab-system'));
      expect(screen.getByTestId('settings-panel-system')).toBeVisible();
      expect(screen.getByTestId('settings-panel-general')).not.toBeVisible();
      expect(screen.getByTestId('settings-tab-system')).toHaveAttribute('aria-selected', 'true');
    });

    it('writes ?tab= into the URL and honors it as the initial tab', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      const { unmount } = render(<SettingsPage />);
      await screen.findByTestId('settings-tabs');
      fireEvent.click(screen.getByTestId('settings-tab-sources'));
      expect(window.location.search).toContain('tab=sources');
      unmount();

      // Fresh mount with the param present → starts on that tab.
      render(<SettingsPage />);
      await screen.findByTestId('settings-tabs');
      expect(screen.getByTestId('settings-panel-sources')).toBeVisible();
      expect(screen.getByTestId('settings-panel-general')).not.toBeVisible();
      window.history.replaceState(null, '', window.location.pathname);
    });
  });

  describe('System group (OS updates block)', () => {
    it('is hidden entirely unless the SAVED update mode is native', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
      render(<SettingsPage />);
      await screen.findByTestId('settings-group-system');
      await flush();
      expect(screen.queryByTestId('settings-system-os')).not.toBeInTheDocument();

      // Flipping the (unsaved) select must NOT reveal it.
      fireEvent.change(screen.getByTestId('settings-system-mode'), { target: { value: 'native' } });
      expect(screen.queryByTestId('settings-system-os')).not.toBeInTheDocument();
    });

    it('saving PATCHes only the osUpdates key', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true, data: baseSettings({ updates: { mode: 'native' } }),
      });
      (patchSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          updates: { mode: 'native' },
          osUpdates: { mode: 'manual', autoReboot: true },
        }),
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-system-os');

      fireEvent.change(screen.getByTestId('settings-system-os-mode'), { target: { value: 'manual' } });
      fireEvent.click(screen.getByTestId('settings-system-os-autoreboot'));
      fireEvent.click(screen.getByTestId('settings-system-os-save'));
      await flush();

      expect(patchSettings).toHaveBeenCalledWith({ osUpdates: { mode: 'manual', autoReboot: true } });
    });

    it('Update OS now: disabled while off/dirty, two-step confirm calls triggerOsUpdate', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true,
        data: baseSettings({
          updates: { mode: 'native' },
          osUpdates: { mode: 'manual', autoReboot: false },
        }),
      });
      (triggerOsUpdate as Mock).mockResolvedValue({
        ok: true, data: { message: 'OS update started in the background' },
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-system-os');
      await flush();

      fireEvent.click(screen.getByTestId('settings-system-os-update'));
      expect(triggerOsUpdate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('settings-system-os-update-confirm'));
      await flush();

      expect(triggerOsUpdate).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('settings-system-os-started')).toHaveTextContent('background');
    });

    it('shows the unattended-upgrades hint only in auto mode', async () => {
      (getSettings as Mock).mockResolvedValue({
        ok: true, data: baseSettings({ updates: { mode: 'native' } }),
      });
      render(<SettingsPage />);
      await screen.findByTestId('settings-system-os');
      expect(screen.queryByTestId('settings-system-os-auto-hint')).not.toBeInTheDocument();
      fireEvent.change(screen.getByTestId('settings-system-os-mode'), { target: { value: 'auto' } });
      expect(screen.getByTestId('settings-system-os-auto-hint')).toBeInTheDocument();
    });
  });
});
