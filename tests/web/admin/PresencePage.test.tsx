import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, screen, waitFor,
} from '@testing-library/react';
import { PresencePage, parseEqualsInput } from '../../../src/web/routes/admin/PresencePage';
import {
  listWalls, getPresenceSources, setPresenceState, updateWall,
  createPresenceSource, updatePresenceSource, deletePresenceSource,
  getSettings, patchSettings, type Wall,
} from '../../../src/web/lib/adminApi';
import { useTapStates } from '../../../src/web/lib/useTapStates';
import { wallConfigSchema } from '../../../src/server/core/wallConfig';
import type { MotionSource, Settings } from '../../../src/server/db/settings';
import { renderAdminPage } from './renderAdminPage';

// ---------------------------------------------------------------------------
// Displays & Presence hub Task 4/5: `/admin/presence` — all four panels (Task 4: Zones +
// Display power; Task 5: Motion sources + Webhook & agent, plus old-UI removal from
// SettingsPage, covered separately in SettingsPage.test.tsx). `useTapStates` is mocked
// the same way DashboardPage.test.tsx mocks it (this page opens the SAME public `/ws`
// feed, just to ride its `onMessage` escape hatch for `display_power`/`motion` frames —
// no taps/snapshot state needed here), and `pushWsFrame` below captures whatever
// `onMessage` the page last handed to the mocked hook, mirroring useWallData.test.tsx/
// WallPage.test.tsx's own "capture then call directly" idiom for simulating a pushed
// WS frame without standing up a real socket.
// ---------------------------------------------------------------------------

vi.mock('../../../src/web/lib/useTapStates', () => ({ useTapStates: vi.fn() }));
vi.mock('../../../src/web/lib/adminApi', () => ({
  listWalls: vi.fn(),
  getPresenceSources: vi.fn(),
  setPresenceState: vi.fn(),
  updateWall: vi.fn(),
  createPresenceSource: vi.fn(),
  updatePresenceSource: vi.fn(),
  deletePresenceSource: vi.fn(),
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
}));

function makeWall(overrides: Partial<Wall> = {}): Wall {
  return {
    id: 1,
    slug: 'main',
    name: 'Main',
    config: wallConfigSchema.parse({
      displayPower: { screensaverAfterMinutes: 30, offAfterMinutes: null, cameraMotion: false },
    }),
    ...overrides,
  };
}

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    siteName: 'My Taproom',
    siteLogo: null,
    displayUnits: 'us',
    servingSizeMl: 473,
    logRetentionDays: 30,
    autoImportBeers: true,
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
    alertChannels: {},
    ...overrides,
  };
}

/** A configured mqtt motion source fixture (Task 5's given brief tests use `id:
 * 'abc-123'` throughout). */
const SRC: MotionSource = {
  id: 'abc-123',
  name: 'Kitchen PIR',
  type: 'mqtt',
  enabled: true,
  wallSlug: 'main',
  config: { topic: 'home/kitchen/pir', match: { mode: 'any' } },
};

function pushWsFrame(msg: unknown) {
  const lastCall = (useTapStates as Mock).mock.calls.at(-1) as
    [unknown, { onMessage?: (m: unknown) => void }] | undefined;
  act(() => { lastCall?.[1]?.onMessage?.(msg); });
}

function renderPresencePage() {
  return renderAdminPage(<PresencePage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  (useTapStates as Mock).mockReturnValue({
    taps: [], stale: false, connected: true, reconnectCount: 0,
  });
  (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall()] });
  (getPresenceSources as Mock).mockResolvedValue({
    ok: true, data: { sources: [], camera: [], agents: [] },
  });
  (setPresenceState as Mock).mockResolvedValue({ ok: true, data: { ok: true } });
  (updateWall as Mock).mockResolvedValue({ ok: true, data: makeWall() });
  (createPresenceSource as Mock).mockResolvedValue({ ok: true, data: SRC });
  (updatePresenceSource as Mock).mockResolvedValue({ ok: true, data: SRC });
  (deletePresenceSource as Mock).mockResolvedValue({ ok: true, data: null });
  (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings() });
  (patchSettings as Mock).mockResolvedValue({
    ok: true, data: baseSettings({ presenceWebhookToken: 'a-fresh-token' }),
  });
});

describe('PresencePage', () => {
  it('renders zone rows with live state and wakes/sleeps via the admin route', async () => {
    renderPresencePage();
    expect(await screen.findByTestId('zone-row-main')).toBeInTheDocument();
    pushWsFrame({
      type: 'display_power', wallSlug: 'main', state: 'off', wallId: 1, ts: 'now',
    });
    await waitFor(() => expect(screen.getByTestId('zone-state-main')).toHaveTextContent(/off/i));
    fireEvent.click(screen.getByTestId('zone-wake-main'));
    await waitFor(() => expect(setPresenceState).toHaveBeenCalledWith('main', 'active'));
    fireEvent.click(screen.getByTestId('zone-sleep-main'));
    await waitFor(() => expect(setPresenceState).toHaveBeenCalledWith('main', 'off'));
  });

  it('display-power row saves through the wall api with blank = null', async () => {
    renderPresencePage();
    fireEvent.change(await screen.findByTestId('dp-saver-main'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('dp-off-main'), { target: { value: '120' } });
    fireEvent.click(screen.getByTestId('dp-save-main'));
    await waitFor(() => expect(updateWall).toHaveBeenCalledWith(1, expect.objectContaining({
      config: expect.objectContaining({
        displayPower: expect.objectContaining({
          screensaverAfterMinutes: null, offAfterMinutes: 120,
        }),
      }),
    })));
  });

  it('defaults an unseen zone to "active" before any display_power frame arrives', async () => {
    renderPresencePage();
    expect(await screen.findByTestId('zone-state-main')).toHaveTextContent(/active/i);
  });

  it('ignores a display_power frame for a different wall slug', async () => {
    renderPresencePage();
    await screen.findByTestId('zone-row-main');
    pushWsFrame({
      type: 'display_power', wallSlug: 'patio', state: 'off', wallId: 99, ts: 'now',
    });
    expect(screen.getByTestId('zone-state-main')).toHaveTextContent(/active/i);
  });

  it('"Wake all" calls setPresenceState with no wall, targeting every zone', async () => {
    renderPresencePage();
    await screen.findByTestId('zone-row-main');
    fireEvent.click(screen.getByTestId('zone-wake-all'));
    await waitFor(() => expect(setPresenceState).toHaveBeenCalledWith(undefined, 'active'));
  });

  it('shows "no agent" when a zone has no open agent stream', async () => {
    renderPresencePage();
    const row = await screen.findByTestId('zone-row-main');
    expect(row).toHaveTextContent('no agent');
  });

  it('shows a singular agent count', async () => {
    (getPresenceSources as Mock).mockResolvedValue({
      ok: true, data: { sources: [], camera: [], agents: [{ wall: 'main', connections: 1 }] },
    });
    renderPresencePage();
    const row = await screen.findByTestId('zone-row-main');
    await waitFor(() => expect(row).toHaveTextContent('1 agent connected'));
  });

  it('shows a plural agent count', async () => {
    (getPresenceSources as Mock).mockResolvedValue({
      ok: true, data: { sources: [], camera: [], agents: [{ wall: 'main', connections: 3 }] },
    });
    renderPresencePage();
    const row = await screen.findByTestId('zone-row-main');
    await waitFor(() => expect(row).toHaveTextContent('3 agents connected'));
  });

  it('loads the wall\'s existing displayPower into the three inputs', async () => {
    renderPresencePage();
    expect(await screen.findByTestId('dp-saver-main')).toHaveValue(30);
    expect(screen.getByTestId('dp-off-main')).toHaveValue(null);
    expect(screen.getByTestId('dp-camera-main')).not.toBeChecked();
  });

  it('toggling camera motion and saving includes it in the write, leaving other fields untouched', async () => {
    renderPresencePage();
    fireEvent.click(await screen.findByTestId('dp-camera-main'));
    fireEvent.click(screen.getByTestId('dp-save-main'));
    await waitFor(() => expect(updateWall).toHaveBeenCalledWith(1, expect.objectContaining({
      config: expect.objectContaining({
        displayPower: { screensaverAfterMinutes: 30, offAfterMinutes: null, cameraMotion: true },
      }),
    })));
  });

  it('surfaces the off > saver validation error instead of saving', async () => {
    renderPresencePage();
    fireEvent.change(await screen.findByTestId('dp-saver-main'), { target: { value: '30' } });
    fireEvent.change(screen.getByTestId('dp-off-main'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('dp-save-main'));
    await waitFor(() => expect(screen.getByTestId('dp-errors-main')).toHaveTextContent(/offAfterMinutes/i));
    expect(updateWall).not.toHaveBeenCalled();
  });

  it('shows a quiet empty state in both panels when there are no walls yet', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [] });
    renderPresencePage();
    expect(await screen.findByTestId('zones-empty')).toBeInTheDocument();
    expect(screen.getByTestId('display-power-empty')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------------------
  // Displays & Presence hub Task 5: Motion sources panel
  // -------------------------------------------------------------------------------------
  describe('Motion sources panel', () => {
    it('lists sources with health + last-trigger and blinks on a ws motion frame', async () => {
      (getPresenceSources as Mock).mockResolvedValue({
        ok: true,
        data: {
          sources: [{ source: SRC, status: { lastTriggeredAt: null, healthy: false, detail: 'broker down' } }],
          camera: [], agents: [],
        },
      });
      renderPresencePage();
      const row = await screen.findByTestId('source-row-abc-123');
      expect(screen.getByTestId('source-health-abc-123')).toHaveAttribute('data-healthy', 'false');
      expect(screen.getByTestId('source-last-abc-123')).toHaveTextContent(/never/i);
      pushWsFrame({ type: 'motion', sourceId: 'abc-123', wallSlug: 'main', ts: 'now' });
      await waitFor(() => expect(row).toHaveAttribute('data-blink', 'true'));
    });

    it('creates an mqtt source with a json match rule through the modal', async () => {
      renderPresencePage();
      fireEvent.click(await screen.findByTestId('source-add'));
      fireEvent.change(screen.getByTestId('source-type-select'), { target: { value: 'mqtt' } });
      fireEvent.change(screen.getByTestId('source-mqtt-topic'), { target: { value: 'zigbee2mqtt/hall' } });
      fireEvent.change(screen.getByTestId('source-mqtt-match-mode'), { target: { value: 'json' } });
      fireEvent.change(screen.getByTestId('source-mqtt-json-field'), { target: { value: 'occupancy' } });
      fireEvent.change(screen.getByTestId('source-mqtt-json-equals'), { target: { value: 'true' } });
      fireEvent.click(screen.getByTestId('source-save'));
      await waitFor(() => expect(createPresenceSource).toHaveBeenCalledWith(expect.objectContaining({
        type: 'mqtt', config: expect.objectContaining({
          topic: 'zigbee2mqtt/hall', match: { mode: 'json', field: 'occupancy', equals: true },
        }),
      })));
    });

    it('the blink clears itself after ~2s (fake-timer-safe)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        (getPresenceSources as Mock).mockResolvedValue({
          ok: true,
          data: {
            sources: [{ source: SRC, status: { lastTriggeredAt: null, healthy: true, detail: '' } }],
            camera: [], agents: [],
          },
        });
        renderPresencePage();
        const row = await screen.findByTestId('source-row-abc-123');
        pushWsFrame({ type: 'motion', sourceId: 'abc-123', wallSlug: 'main', ts: 'now' });
        await waitFor(() => expect(row).toHaveAttribute('data-blink', 'true'));
        await act(async () => { vi.advanceTimersByTime(2000); });
        expect(row).toHaveAttribute('data-blink', 'false');
      } finally {
        vi.useRealTimers();
      }
    });

    it('renders a "never" last-triggered camera row labeled "Tablet camera — <wall>" with a working toggle', async () => {
      (getPresenceSources as Mock).mockResolvedValue({
        ok: true,
        data: { sources: [], camera: [{ wallSlug: 'main', enabled: true, lastTriggeredAt: null }], agents: [] },
      });
      renderPresencePage();
      const row = await screen.findByTestId('source-row-camera:main');
      expect(row).toHaveTextContent('Tablet camera — Main');
      expect(screen.getByTestId('source-last-camera:main')).toHaveTextContent(/never/i);
      fireEvent.click(screen.getByTestId('source-camera-toggle-main'));
      await waitFor(() => expect(updateWall).toHaveBeenCalledWith(1, expect.objectContaining({
        config: expect.objectContaining({
          displayPower: expect.objectContaining({ cameraMotion: false }),
        }),
      })));
    });

    it('editing an existing source pre-fills the modal and PATCHes via updatePresenceSource', async () => {
      (getPresenceSources as Mock).mockResolvedValue({
        ok: true,
        data: {
          sources: [{ source: SRC, status: { lastTriggeredAt: null, healthy: true, detail: '' } }],
          camera: [], agents: [],
        },
      });
      renderPresencePage();
      await screen.findByTestId('source-row-abc-123');
      fireEvent.click(screen.getByTestId('source-edit-abc-123'));
      expect(screen.getByTestId('source-mqtt-topic')).toHaveValue('home/kitchen/pir');
      fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'Kitchen PIR v2' } });
      fireEvent.click(screen.getByTestId('source-save'));
      await waitFor(() => expect(updatePresenceSource).toHaveBeenCalledWith('abc-123', expect.objectContaining({
        name: 'Kitchen PIR v2',
      })));
    });

    // Review fix F1: delete goes through an `.admin-confirm` dialog (spec's "delete with
    // confirm") — clicking the row button alone must never call the api.
    describe('delete confirmation', () => {
      it('clicking Delete opens a confirm dialog naming the source, without calling the api yet', async () => {
        (getPresenceSources as Mock).mockResolvedValue({
          ok: true,
          data: {
            sources: [{ source: SRC, status: { lastTriggeredAt: null, healthy: true, detail: '' } }],
            camera: [], agents: [],
          },
        });
        renderPresencePage();
        await screen.findByTestId('source-row-abc-123');
        fireEvent.click(screen.getByTestId('source-delete-abc-123'));
        expect(await screen.findByTestId('source-delete-confirm')).toBeInTheDocument();
        expect(screen.getByTestId('source-delete-confirm-backdrop')).toHaveTextContent(SRC.name);
        expect(deletePresenceSource).not.toHaveBeenCalled();
      });

      it('cancel closes the dialog without calling the api — the row remains', async () => {
        (getPresenceSources as Mock).mockResolvedValue({
          ok: true,
          data: {
            sources: [{ source: SRC, status: { lastTriggeredAt: null, healthy: true, detail: '' } }],
            camera: [], agents: [],
          },
        });
        renderPresencePage();
        await screen.findByTestId('source-row-abc-123');
        fireEvent.click(screen.getByTestId('source-delete-abc-123'));
        await screen.findByTestId('source-delete-confirm');
        fireEvent.click(screen.getByTestId('source-delete-cancel'));
        await waitFor(() => expect(screen.queryByTestId('source-delete-confirm')).not.toBeInTheDocument());
        expect(deletePresenceSource).not.toHaveBeenCalled();
        expect(screen.getByTestId('source-row-abc-123')).toBeInTheDocument();
      });

      it('confirm calls deletePresenceSource and refreshes the table', async () => {
        (getPresenceSources as Mock).mockResolvedValueOnce({
          ok: true,
          data: {
            sources: [{ source: SRC, status: { lastTriggeredAt: null, healthy: true, detail: '' } }],
            camera: [], agents: [],
          },
        }).mockResolvedValue({ ok: true, data: { sources: [], camera: [], agents: [] } });
        renderPresencePage();
        await screen.findByTestId('source-row-abc-123');
        fireEvent.click(screen.getByTestId('source-delete-abc-123'));
        fireEvent.click(await screen.findByTestId('source-delete-confirm'));
        await waitFor(() => expect(deletePresenceSource).toHaveBeenCalledWith('abc-123'));
        await waitFor(() => expect(screen.getByTestId('sources-empty')).toBeInTheDocument());
        expect(screen.queryByTestId('source-delete-confirm')).not.toBeInTheDocument();
      });
    });

    it('switching the modal type select swaps the visible field set', async () => {
      renderPresencePage();
      fireEvent.click(await screen.findByTestId('source-add'));
      expect(screen.getByTestId('source-mqtt-topic')).toBeInTheDocument();
      fireEvent.change(screen.getByTestId('source-type-select'), { target: { value: 'gpio' } });
      expect(screen.queryByTestId('source-mqtt-topic')).not.toBeInTheDocument();
      expect(screen.getByTestId('source-gpio-line')).toBeInTheDocument();
      expect(screen.getByTestId('source-gpio-active-low')).toBeInTheDocument();
      fireEvent.change(screen.getByTestId('source-type-select'), { target: { value: 'ble' } });
      expect(screen.queryByTestId('source-gpio-line')).not.toBeInTheDocument();
      expect(screen.getByTestId('source-ble-mac')).toBeInTheDocument();
    });

    it('a webhook-type source row shows its full copy-paste URL with the real token and its id', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ presenceWebhookToken: 'tok-1' }) });
      (getPresenceSources as Mock).mockResolvedValue({
        ok: true,
        data: {
          sources: [{
            source: { ...SRC, id: 'wh-1', type: 'webhook', config: {} },
            status: { lastTriggeredAt: null, healthy: true, detail: '' },
          }],
          camera: [], agents: [],
        },
      });
      renderPresencePage();
      const url = await screen.findByTestId('source-webhook-url-wh-1');
      expect(url).toHaveTextContent(`${window.location.origin}/api/presence/motion?token=tok-1&source=wh-1`);
    });

    // Review fix F2: a webhook-type row's own HA snippet is attributed (`&source=<id>`),
    // not the generic panel-level one.
    it('a webhook-type source row has its own attributed HA snippet with &source=<id>', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ presenceWebhookToken: 'tok-1' }) });
      (getPresenceSources as Mock).mockResolvedValue({
        ok: true,
        data: {
          sources: [{
            source: { ...SRC, id: 'wh-1', type: 'webhook', config: {} },
            status: { lastTriggeredAt: null, healthy: true, detail: '' },
          }],
          camera: [], agents: [],
        },
      });
      renderPresencePage();
      const snippet = await screen.findByTestId('ha-snippet-wh-1');
      expect(snippet).toHaveTextContent(`${window.location.origin}/api/presence/motion?token=tok-1&source=wh-1`);
    });

    // Review fix F3: the modal validates client-side before ever calling the api.
    describe('modal pre-flight validation', () => {
      it('an empty mqtt topic shows an inline error and never calls createPresenceSource', async () => {
        renderPresencePage();
        fireEvent.click(await screen.findByTestId('source-add'));
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'Kitchen PIR' } });
        // source-mqtt-topic is left blank.
        fireEvent.click(screen.getByTestId('source-save'));
        await waitFor(() => expect(screen.getByTestId('source-form-error')).toBeInTheDocument());
        expect(createPresenceSource).not.toHaveBeenCalled();
      });

      it('a valid mqtt save is unaffected by the pre-flight check', async () => {
        renderPresencePage();
        fireEvent.click(await screen.findByTestId('source-add'));
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'Kitchen PIR' } });
        fireEvent.change(screen.getByTestId('source-mqtt-topic'), { target: { value: 'home/kitchen/pir' } });
        fireEvent.click(screen.getByTestId('source-save'));
        await waitFor(() => expect(createPresenceSource).toHaveBeenCalledWith(expect.objectContaining({
          name: 'Kitchen PIR', type: 'mqtt',
        })));
        expect(screen.queryByTestId('source-form-error')).not.toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------------------
  // Displays & Presence hub Task 5: Webhook & agent panel — the token display/generate
  // mechanics MOVED here from SettingsPage's PresenceBlock (not duplicated).
  // -------------------------------------------------------------------------------------
  describe('Webhook & agent panel', () => {
    it('shows "Not set" when no token has ever been generated, and no URL/snippet yet', async () => {
      renderPresencePage();
      expect(await screen.findByTestId('webhook-token-masked')).toHaveTextContent('Not set');
      expect(screen.queryByTestId('ha-snippet')).not.toBeInTheDocument();
    });

    it('shows the loaded token and the interpolated base URL + HA snippet', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ presenceWebhookToken: 'tok-2' }) });
      renderPresencePage();
      expect(await screen.findByTestId('webhook-token-masked')).toHaveTextContent('tok-2');
      const expectedUrl = `${window.location.origin}/api/presence/motion?token=tok-2`;
      expect(screen.getByTestId('webhook-base-url')).toHaveTextContent(expectedUrl);
      expect(screen.getByTestId('ha-snippet')).toHaveTextContent(expectedUrl);
    });

    it('Generate PATCHes a fresh crypto.randomUUID() token and shows the fresh value', async () => {
      renderPresencePage();
      await screen.findByTestId('webhook-token-masked');
      fireEvent.click(screen.getByTestId('webhook-token-generate'));
      await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
      const call = (patchSettings as Mock).mock.calls[0]![0];
      expect(typeof call.presenceWebhookToken).toBe('string');
      await waitFor(() => expect(screen.getByTestId('webhook-token-masked')).toHaveTextContent('a-fresh-token'));
    });

    // Review fix F2: the panel-level fallback `ha-snippet` is only for the "no webhook
    // source configured yet" case — once one exists, its own row's `ha-snippet-<id>` is
    // the promoted, attributed path and the generic fallback must not also render.
    it('hides the panel-level fallback ha-snippet once a webhook-type source exists', async () => {
      (getSettings as Mock).mockResolvedValue({ ok: true, data: baseSettings({ presenceWebhookToken: 'tok-3' }) });
      (getPresenceSources as Mock).mockResolvedValue({
        ok: true,
        data: {
          sources: [{
            source: { ...SRC, id: 'wh-2', type: 'webhook', config: {} },
            status: { lastTriggeredAt: null, healthy: true, detail: '' },
          }],
          camera: [], agents: [],
        },
      });
      renderPresencePage();
      await screen.findByTestId('webhook-base-url');
      await waitFor(() => expect(screen.queryByTestId('ha-snippet')).not.toBeInTheDocument());
      expect(screen.getByTestId('presence-panel-webhook')).toHaveTextContent(/webhook-type row/i);
    });
  });
});

describe('parseEqualsInput', () => {
  it("parses 'true' as the boolean true", () => {
    expect(parseEqualsInput('true')).toBe(true);
  });

  it("parses '1' as the number 1", () => {
    expect(parseEqualsInput('1')).toBe(1);
  });

  it("leaves a non-boolean, non-numeric string like 'x' as-is", () => {
    expect(parseEqualsInput('x')).toBe('x');
  });
});
