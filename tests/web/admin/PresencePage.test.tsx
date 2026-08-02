import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, screen, waitFor,
} from '@testing-library/react';
import { PresencePage } from '../../../src/web/routes/admin/PresencePage';
import {
  listWalls, getPresenceSources, setPresenceState, updateWall, type Wall,
} from '../../../src/web/lib/adminApi';
import { useTapStates } from '../../../src/web/lib/useTapStates';
import { wallConfigSchema } from '../../../src/server/core/wallConfig';
import { renderAdminPage } from './renderAdminPage';

// ---------------------------------------------------------------------------
// Displays & Presence hub Task 4: `/admin/presence` — Zones + Display power panels
// (panels 3-4, motion sources + webhook, land in Task 5). `useTapStates` is mocked the
// same way DashboardPage.test.tsx mocks it (this page opens the SAME public `/ws` feed,
// just to ride its `onMessage` escape hatch for `display_power` frames — no taps/
// snapshot state needed here), and `pushWsFrame` below captures whatever `onMessage`
// the page last handed to the mocked hook, mirroring useWallData.test.tsx/
// WallPage.test.tsx's own "capture then call directly" idiom for simulating a pushed
// WS frame without standing up a real socket.
// ---------------------------------------------------------------------------

vi.mock('../../../src/web/lib/useTapStates', () => ({ useTapStates: vi.fn() }));
vi.mock('../../../src/web/lib/adminApi', () => ({
  listWalls: vi.fn(),
  getPresenceSources: vi.fn(),
  setPresenceState: vi.fn(),
  updateWall: vi.fn(),
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
});
