import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { WallPage } from '../../src/web/routes/WallPage';
import { useWallData, type UseWallDataResult } from '../../src/web/lib/useWallData';
import { usePrefersReducedMotion } from '../../src/web/lib/usePrefersReducedMotion';
import { postPresenceWake } from '../../src/web/lib/api';
import type { TapState } from '../../src/server/core/state';
import type { WallConfig } from '../../src/server/core/wallConfig';

vi.mock('../../src/web/lib/useWallData', () => ({ useWallData: vi.fn() }));
vi.mock('../../src/web/lib/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: vi.fn() }));
vi.mock('../../src/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/api')>()),
  postPresenceWake: vi.fn(),
}));

function makeTap(tapId: number, overrides: Partial<TapState> = {}): TapState {
  return {
    tapId,
    tapNumber: tapId,
    tapName: null,
    beer: null,
    keg: null,
    lastPour: null,
    pouring: false,
    curServMl: null,
    monitorOnline: true, hidden: false,
    temp: null,
    avgRating: null,
    nextUpBeerName: null,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<WallConfig> = {}): WallConfig {
  return {
    columns: 2,
    cardTemplate: 'standard',
    theme: { id: 'taproom' },
    pages: [],
    rotationSeconds: 15,
    transition: 'crossfade',
    showQr: false,
    header: { showClock: false, showTemp: false },
    fields: {},
    screensaver: { enabled: false, startAfterMinutes: 10 },
    ...overrides,
  } as WallConfig;
}

function baseResult(overrides: Partial<UseWallDataResult> = {}): UseWallDataResult {
  return {
    wall: null,
    taps: [],
    units: 'us',
    stale: false,
    connected: true,
    loading: false,
    error: null,
    notFound: false,
    ...overrides,
  };
}

/** Captures the `onMessage` callback WallPage hands to (mocked) `useWallData`, so a test
 * can simulate a WS message arriving without a real socket -- see useWallData.test.tsx /
 * useTapStates.test.tsx for the corresponding lower-level coverage of the socket plumbing
 * itself; this file only tests WHAT WallPage does with a message once it arrives. */
function mockWallData(overrides: Partial<UseWallDataResult> = {}): { onMessage?: (msg: unknown) => void } {
  const captured: { onMessage?: (msg: unknown) => void } = {};
  (useWallData as Mock).mockImplementation((_slug: string, options?: { onMessage?: (msg: unknown) => void }) => {
    captured.onMessage = options?.onMessage;
    return baseResult(overrides);
  });
  return captured;
}

function renderWall(slug = 'main') {
  return render(
    <MemoryRouter initialEntries={[`/wall/${slug}`]}>
      <Routes>
        <Route path="/wall/:slug" element={<WallPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WallPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (usePrefersReducedMotion as Mock).mockReturnValue(false);
    (postPresenceWake as Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).__wall;
  });

  it('shows a fullscreen loading state before the wall config resolves', () => {
    (useWallData as Mock).mockReturnValue(baseResult({ loading: true }));
    renderWall();
    expect(screen.getByTestId('wall-page-loading')).toBeInTheDocument();
  });

  it('shows a friendly not-found page for a 404 slug', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      loading: false, error: 'No such wall', notFound: true,
    }));
    renderWall('nope');
    const errorPage = screen.getByTestId('wall-page-error');
    expect(errorPage).toHaveTextContent(/nope/i);
    expect(errorPage).not.toHaveTextContent('Boom');
  });

  it('shows a generic error page for a non-404 failure', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      loading: false, error: 'Boom', notFound: false,
    }));
    renderWall();
    expect(screen.getByTestId('wall-page-error')).toHaveTextContent('Boom');
  });

  it('renders the header title and the grid once the wall loads', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'The Keg Cave', config: makeConfig() },
      taps: [makeTap(1), makeTap(2)],
    }));
    renderWall();
    expect(screen.getByTestId('wall-header-title')).toHaveTextContent('The Keg Cave');
    expect(screen.getAllByTestId('tap-card')).toHaveLength(2);
  });

  it('hides the mouse cursor on the document root while mounted, and restores it on unmount', () => {
    document.documentElement.style.cursor = '';
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Bar', config: makeConfig() }, taps: [makeTap(1)],
    }));
    const { unmount } = renderWall();
    expect(document.documentElement.style.cursor).toBe('none');
    unmount();
    expect(document.documentElement.style.cursor).toBe('');
  });

  it('renders a non-classic look instead of the classic header/grid chrome', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'The Keg Cave', config: makeConfig({ look: 'ledger', showQr: true }) },
      taps: [makeTap(1)],
    }));
    renderWall();
    expect(screen.getByTestId('ledger-look')).toBeInTheDocument();
    // The look owns its whole frame: no classic header, grid, or corner QR overlay.
    expect(screen.queryByTestId('wall-header')).toBeNull();
    expect(screen.queryByTestId('wall-grid')).toBeNull();
    expect(screen.queryByTestId('qr-overlay')).toBeNull();
    // The look renders its own in-chrome QR instead.
    expect(screen.getByTestId('look-qr')).toBeInTheDocument();
  });

  it('renders a takeover overlay while a qualifying pour is live, and none when off', () => {
    const pouringTap = makeTap(1, {
      pouring: true,
      curServMl: 250,
      beer: {
        id: 1, name: 'Morning Line', brewery: null, style: 'Pilsner', abv: 4.9, ibu: 32, srm: 3, description: null, labelImage: null, createdAt: '',
      },
      keg: {
        id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 100, remainingMl: 19000,
      },
    });
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ takeover: { style: 'dock', minMl: 60 } }) },
      taps: [pouringTap],
    }));
    renderWall();
    expect(screen.getByTestId('takeover-dock')).toBeInTheDocument();
  });

  it('spotlight takeover dims the other cards instead of overlaying', () => {
    const beer = {
      id: 1, name: 'Morning Line', brewery: null, style: 'Pilsner', abv: 4.9, ibu: 32, srm: 3, description: null, labelImage: null, createdAt: '',
    };
    const keg = {
      id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status: 'on_tap' as const, createdAt: '', kegType: null, costCents: null, levelPct: 100, remainingMl: 19000,
    };
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ takeover: { style: 'spotlight', minMl: 60 } }) },
      taps: [
        makeTap(1, { pouring: true, curServMl: 250, beer, keg }),
        makeTap(2, { beer: { ...beer, id: 2 }, keg: { ...keg, id: 2, beerId: 2, tapId: 2 } }),
      ],
    }));
    renderWall();
    const cards = screen.getAllByTestId('tap-card');
    expect(cards[0]!.className).toContain('tap-card--spotlit');
    expect(cards[1]!.className).toContain('tap-card--spotlight-dimmed');
    expect(screen.queryByTestId('takeover-dock')).toBeNull();
    expect(screen.queryByTestId('takeover-full')).toBeNull();
  });

  it('a config.header.title overrides the wall name', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'The Keg Cave', config: makeConfig({ header: { title: 'Taproom Live', showClock: false, showTemp: false } }) },
      taps: [],
    }));
    renderWall();
    expect(screen.getByTestId('wall-header-title')).toHaveTextContent('Taproom Live');
  });

  it('rotates pages on the configured interval and wraps around', () => {
    vi.useFakeTimers();
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: {
        slug: 'main',
        name: 'Main',
        config: makeConfig({ pages: [{ tapIds: [1] }, { tapIds: [2] }], rotationSeconds: 10 }),
      },
      taps: [makeTap(1), makeTap(2)],
    }));
    renderWall();

    expect(screen.getByText('Tap 1 — nothing on tap')).toBeInTheDocument();
    expect(screen.queryByText('Tap 2 — nothing on tap')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Tap 2 — nothing on tap')).toBeInTheDocument();
    expect(screen.queryByText('Tap 1 — nothing on tap')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Tap 1 — nothing on tap')).toBeInTheDocument();
  });

  it('shows every tap on a single page when config.pages is empty', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ pages: [] }) },
      taps: [makeTap(1), makeTap(2), makeTap(3)],
    }));
    renderWall();
    expect(screen.getAllByTestId('tap-card')).toHaveLength(3);
  });

  it.each([
    ['crossfade', 'crossfade'],
    ['slide', 'slide'],
    ['none', 'none'],
  ])('applies the %s transition class from config', (configured, expected) => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ transition: configured as WallConfig['transition'] }) },
      taps: [],
    }));
    renderWall();
    const content = screen.getByTestId('wall-page-content');
    expect(content).toHaveAttribute('data-transition', expected);
  });

  it('forces the none transition when prefers-reduced-motion is set, regardless of config', () => {
    (usePrefersReducedMotion as Mock).mockReturnValue(true);
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ transition: 'crossfade' }) },
      taps: [],
    }));
    renderWall();
    expect(screen.getByTestId('wall-page-content')).toHaveAttribute('data-transition', 'none');
  });

  it('renders a QR overlay only when config.showQr is true', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ showQr: true }) },
      taps: [],
    }));
    renderWall();
    expect(screen.getByTestId('qr-overlay').querySelector('svg')).toBeTruthy();
  });

  it('omits the QR overlay when config.showQr is false', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ showQr: false }) },
      taps: [],
    }));
    renderWall();
    expect(screen.queryByTestId('qr-overlay')).not.toBeInTheDocument();
  });

  it('shows the reconnecting pill when stale, and hides it otherwise', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig() },
      taps: [],
      stale: true,
    }));
    const { rerender } = renderWall();
    expect(screen.getByTestId('wall-reconnecting-pill')).toBeInTheDocument();

    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig() },
      taps: [],
      stale: false,
    }));
    rerender(
      <MemoryRouter initialEntries={['/wall/main']}>
        <Routes>
          <Route path="/wall/:slug" element={<WallPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('wall-reconnecting-pill')).not.toBeInTheDocument();
  });

  it('exposes a dev-only window.__wall.banner hook that pushes into the BannerLane', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig() },
      taps: [],
    }));
    renderWall();

    expect(typeof window.__wall?.banner).toBe('function');
    act(() => { window.__wall!.banner('Free pours at 6pm'); });
    expect(screen.getByTestId('banner-lane-banner')).toHaveTextContent('Free pours at 6pm');
  });

  it('threads the configured units through to the rendered pour readout', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig() },
      taps: [makeTap(1, {
        pouring: true,
        curServMl: 473,
        beer: {
          id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null, srm: 6, description: null, labelImage: null, createdAt: '',
        },
        keg: {
          id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0,
          dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 100, remainingMl: 19000,
        },
      })],
      units: 'metric',
    }));
    renderWall();
    expect(screen.getByTestId('liquid-readout')).toHaveTextContent('473 mL');
  });

  it('shows the max temp across every tap on the wall when showTemp is enabled', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ header: { showClock: false, showTemp: true } }) },
      taps: [makeTap(1, { temp: 3.1 }), makeTap(2, { temp: 4.8 }), makeTap(3, { temp: null })],
      units: 'metric',
    }));
    renderWall();
    expect(screen.getByTestId('wall-header-temp')).toHaveTextContent('5°C');
  });

  it('hides the temp readout when no tap on the wall has a temp reading', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: { slug: 'main', name: 'Main', config: makeConfig({ header: { showClock: false, showTemp: true } }) },
      taps: [makeTap(1, { temp: null }), makeTap(2, { temp: null })],
    }));
    renderWall();
    expect(screen.queryByTestId('wall-header-temp')).not.toBeInTheDocument();
  });

  it('derives the wall max temp from all taps, not just the currently rotating page', () => {
    (useWallData as Mock).mockReturnValue(baseResult({
      wall: {
        slug: 'main',
        name: 'Main',
        config: makeConfig({
          header: { showClock: false, showTemp: true },
          pages: [{ tapIds: [1] }, { tapIds: [2] }],
        }),
      },
      taps: [makeTap(1, { temp: 2 }), makeTap(2, { temp: 9.6 })],
      units: 'metric',
    }));
    renderWall();
    // page 1 only shows tap 1, but the header temp is the wall-wide max (tap 2's 9.6°C).
    expect(screen.getByTestId('wall-header-temp')).toHaveTextContent('10°C');
  });

  // Phase 5 Task 4: the automation engine's wall_banner/party_mode actions relay over WS
  // (routes/ws.ts) as {type:'banner',...}/{type:'theme_override',...} -- WallPage
  // subscribes via the SAME socket useWallData/useTapStates already own (onMessage
  // option), not a second connection.
  describe('server-driven banners and party mode (WS messages)', () => {
    it('renders a banner pushed via a WS {type:"banner"} message, mapping kind "celebrate" to the success style', () => {
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall();

      act(() => { captured.onMessage?.({ type: 'banner', text: 'Free pours at 6pm', kind: 'celebrate' }); });

      const banner = screen.getByTestId('banner-lane-banner');
      expect(banner).toHaveTextContent('Free pours at 6pm');
      expect(banner).toHaveAttribute('data-kind', 'success');
    });

    it('maps WS banner kind "warning"/"info" straight through', () => {
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall();

      act(() => { captured.onMessage?.({ type: 'banner', text: 'Kicked', kind: 'warning' }); });
      expect(screen.getByTestId('banner-lane-banner')).toHaveAttribute('data-kind', 'warning');
    });

    it('a WS banner message’s durationMs overrides the default hold duration', () => {
      vi.useFakeTimers();
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall();

      act(() => { captured.onMessage?.({
        type: 'banner', text: 'Quick', kind: 'info', durationMs: 1000,
      }); });
      expect(screen.getByTestId('banner-lane-banner')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(999); });
      expect(screen.getByTestId('banner-lane-banner')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.queryByTestId('banner-lane-banner')).not.toBeInTheDocument();
    });

    it('applies a temporary theme override on a WS {type:"theme_override"} message, then reverts after the countdown', () => {
      vi.useFakeTimers();
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig({ theme: { id: 'taproom' } }) }, taps: [],
      });
      const { container } = renderWall();
      const scope = container.querySelector('.kegtron-theme-scope') as HTMLElement;
      const baseAccent = getComputedStyle(scope).getPropertyValue('--accent').trim();
      expect(baseAccent).toBeTruthy();

      act(() => { captured.onMessage?.({ type: 'theme_override', minutes: 10 }); });
      expect(getComputedStyle(scope).getPropertyValue('--accent').trim()).not.toBe(baseAccent);

      act(() => { vi.advanceTimersByTime(10 * 60_000 - 1); });
      expect(getComputedStyle(scope).getPropertyValue('--accent').trim()).not.toBe(baseAccent);

      act(() => { vi.advanceTimersByTime(1); });
      expect(getComputedStyle(scope).getPropertyValue('--accent').trim()).toBe(baseAccent);
    });

    it('a second theme_override message restarts the countdown instead of stacking', () => {
      vi.useFakeTimers();
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig({ theme: { id: 'taproom' } }) }, taps: [],
      });
      const { container } = renderWall();
      const scope = container.querySelector('.kegtron-theme-scope') as HTMLElement;
      const baseAccent = getComputedStyle(scope).getPropertyValue('--accent').trim();

      act(() => { captured.onMessage?.({ type: 'theme_override', minutes: 10 }); });
      act(() => { vi.advanceTimersByTime(9 * 60_000); }); // 9 of 10 minutes elapsed
      act(() => { captured.onMessage?.({ type: 'theme_override', minutes: 10 }); }); // restarts

      act(() => { vi.advanceTimersByTime(9 * 60_000); }); // would have expired the FIRST message
      expect(getComputedStyle(scope).getPropertyValue('--accent').trim()).not.toBe(baseAccent);

      act(() => { vi.advanceTimersByTime(60_000 + 1); }); // completes the SECOND message's 10 min
      expect(getComputedStyle(scope).getPropertyValue('--accent').trim()).toBe(baseAccent);
    });

    it('cleans up the theme-override timer on unmount without throwing', () => {
      vi.useFakeTimers();
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      const { unmount } = renderWall();
      act(() => { captured.onMessage?.({ type: 'theme_override', minutes: 5 }); });
      expect(() => unmount()).not.toThrow();
    });

    it('ignores WS messages of an unrecognized type (no crash, no banner)', () => {
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall();
      expect(() => act(() => { captured.onMessage?.({ type: 'ping', ts: 'x' }); })).not.toThrow();
      expect(screen.queryByTestId('banner-lane-banner')).not.toBeInTheDocument();
    });
  });

  // Task 9: ScreenCare's stage is now server-pushed over the SAME /ws socket
  // (useDisplayPower's onWsMessage is chained into the callback WallPage already hands
  // useWallData, right alongside the banner/party-mode handling above), and its off-stage
  // overlay wakes the wall via POST /api/presence/wake.
  describe('server-driven display power stage (WS messages)', () => {
    it('starts in the "active" stage: no screensaver or off overlay', () => {
      mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall();
      expect(screen.queryByTestId('screensaver-overlay')).not.toBeInTheDocument();
      expect(screen.queryByTestId('screen-off-overlay')).not.toBeInTheDocument();
    });

    it('shows the screensaver overlay on a WS {type:"display_power", state:"screensaver"} frame for this wall', () => {
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall('main');
      act(() => { captured.onMessage?.({ type: 'display_power', wallSlug: 'main', state: 'screensaver' }); });
      expect(screen.getByTestId('screensaver-overlay')).toBeInTheDocument();
    });

    it('shows the off overlay on a WS {type:"display_power", state:"off"} frame for this wall', () => {
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall('main');
      act(() => { captured.onMessage?.({ type: 'display_power', wallSlug: 'main', state: 'off' }); });
      expect(screen.getByTestId('screen-off-overlay')).toBeInTheDocument();
    });

    it('ignores a display_power frame for a different wall slug', () => {
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall('main');
      act(() => { captured.onMessage?.({ type: 'display_power', wallSlug: 'patio', state: 'off' }); });
      expect(screen.queryByTestId('screen-off-overlay')).not.toBeInTheDocument();
    });

    it('tapping the off overlay wakes this wall via POST /api/presence/wake', () => {
      const captured = mockWallData({
        wall: { slug: 'main', name: 'Main', config: makeConfig() }, taps: [],
      });
      renderWall('main');
      act(() => { captured.onMessage?.({ type: 'display_power', wallSlug: 'main', state: 'off' }); });

      act(() => { screen.getByTestId('screen-off-overlay').click(); });
      expect(postPresenceWake).toHaveBeenCalledWith('main', 'touch');
    });

    // F3 fix: a dead/unreachable server can't push a fresh display_power frame, so a
    // stale 'off' would otherwise leave the screen black forever (and the wake tap would
    // just POST into the same dead server). WallPage falls back to 'active' whenever the
    // connection goes stale or disconnects, regardless of the last pushed stage.
    it('falls back to active (overlay gone) when the connection goes stale after stage was pushed off', () => {
      const live = { stale: false, connected: true };
      const captured: { onMessage?: (msg: unknown) => void } = {};
      (useWallData as Mock).mockImplementation((_slug: string, options?: { onMessage?: (msg: unknown) => void }) => {
        captured.onMessage = options?.onMessage;
        return baseResult({
          wall: { slug: 'main', name: 'Main', config: makeConfig() },
          taps: [],
          stale: live.stale,
          connected: live.connected,
        });
      });
      const { rerender } = renderWall('main');
      act(() => { captured.onMessage?.({ type: 'display_power', wallSlug: 'main', state: 'off' }); });
      expect(screen.getByTestId('screen-off-overlay')).toBeInTheDocument();

      live.stale = true;
      rerender(
        <MemoryRouter initialEntries={['/wall/main']}>
          <Routes>
            <Route path="/wall/:slug" element={<WallPage />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('screen-off-overlay')).not.toBeInTheDocument();
    });

    it('falls back to active (overlay gone) when the connection disconnects after stage was pushed off', () => {
      const live = { stale: false, connected: true };
      const captured: { onMessage?: (msg: unknown) => void } = {};
      (useWallData as Mock).mockImplementation((_slug: string, options?: { onMessage?: (msg: unknown) => void }) => {
        captured.onMessage = options?.onMessage;
        return baseResult({
          wall: { slug: 'main', name: 'Main', config: makeConfig() },
          taps: [],
          stale: live.stale,
          connected: live.connected,
        });
      });
      const { rerender } = renderWall('main');
      act(() => { captured.onMessage?.({ type: 'display_power', wallSlug: 'main', state: 'off' }); });
      expect(screen.getByTestId('screen-off-overlay')).toBeInTheDocument();

      live.connected = false;
      rerender(
        <MemoryRouter initialEntries={['/wall/main']}>
          <Routes>
            <Route path="/wall/:slug" element={<WallPage />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('screen-off-overlay')).not.toBeInTheDocument();
    });
  });
});

// Note: the actual "60s of WS silence -> stale=true" state transition is exhaustively
// covered with fake timers in tests/web/useTapStates.test.tsx (the hook WallPage's data
// layer is built on) — including the exact 59s/60s boundary and clearing on the next
// message. Re-deriving that transition here (through a real socket + WallPage's full
// hook chain) would duplicate that coverage without testing anything WallPage itself is
// responsible for; the "stale pill appears" test above is what actually verifies
// WallPage's own contribution — that it renders the pill purely as a function of the
// `stale` flag it's handed.
