import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WallPage } from '../../src/web/routes/WallPage';
import { useWallData, type UseWallDataResult } from '../../src/web/lib/useWallData';
import { usePrefersReducedMotion } from '../../src/web/lib/usePrefersReducedMotion';
import type { TapState } from '../../src/server/core/state';
import type { WallConfig } from '../../src/server/core/wallConfig';

vi.mock('../../src/web/lib/useWallData', () => ({ useWallData: vi.fn() }));
vi.mock('../../src/web/lib/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: vi.fn() }));

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
    monitorOnline: true,
    temp: null,
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
          dateTapped: null, status: 'on_tap', createdAt: '', levelPct: 100, remainingMl: 19000,
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
});

// Note: the actual "60s of WS silence -> stale=true" state transition is exhaustively
// covered with fake timers in tests/web/useTapStates.test.tsx (the hook WallPage's data
// layer is built on) — including the exact 59s/60s boundary and clearing on the next
// message. Re-deriving that transition here (through a real socket + WallPage's full
// hook chain) would duplicate that coverage without testing anything WallPage itself is
// responsible for; the "stale pill appears" test above is what actually verifies
// WallPage's own contribution — that it renders the pill purely as a function of the
// `stale` flag it's handed.
