import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { WallPage } from '../../src/web/routes/WallPage';
import { useWallData } from '../../src/web/lib/useWallData';
import { usePrefersReducedMotion } from '../../src/web/lib/usePrefersReducedMotion';
import { getLeaderboard, getDisplayView } from '../../src/web/lib/api';
import { wallConfigSchema } from '../../src/server/core/wallConfig';
import type { TapState } from '../../src/server/core/state';

vi.mock('../../src/web/lib/useWallData', () => ({ useWallData: vi.fn() }));
vi.mock('../../src/web/lib/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: vi.fn() }));
vi.mock('../../src/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/api')>()),
  getLeaderboard: vi.fn(),
  getDisplayView: vi.fn(),
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
    nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
    ...overrides,
  };
}

const BOARD = {
  window: 'month' as const,
  entries: [{
    drinkerId: 1, displayName: 'Sam', avatarColor: null, pourCount: 3, volumeMl: 1200, avgQuality: 90, qualityCount: 3,
  }],
  superlatives: { mostPours: null, smoothest: null, biggestPour: null },
};

function mockWall(configOverrides: Record<string, unknown>, taps: TapState[] = []) {
  (useWallData as Mock).mockReturnValue({
    wall: { slug: 'main', name: 'Main', config: wallConfigSchema.parse(configOverrides) },
    taps,
    units: 'us',
    stale: false,
    connected: true,
    loading: false,
    error: null,
    notFound: false,
  });
}

function renderWall(path = '/wall/main') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/wall/:slug" element={<WallPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ROTATION = {
  viewRotation: {
    enabled: true,
    views: [
      { kind: 'wall', seconds: 15, enabled: true },
      { kind: 'leaderboard', seconds: 10, enabled: true },
    ],
  },
};

describe('WallPage view rotation (design 4a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (usePrefersReducedMotion as Mock).mockReturnValue(false);
    (getLeaderboard as Mock).mockResolvedValue({ ok: true, data: BOARD });
    (getDisplayView as Mock).mockResolvedValue({ ok: false, status: 404, message: 'no' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the playlist bar with the active chip while rotating', async () => {
    mockWall(ROTATION);
    renderWall();
    await act(async () => { await Promise.resolve(); });
    const chips = screen.getAllByTestId('playlist-bar-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]!.className).toContain('playlist-bar__chip--active');
    expect(chips[0]).toHaveTextContent('KEGWALL');
    expect(chips[1]).toHaveTextContent('LEADERBOARD');
  });

  it('rotates to the leaderboard view on the wall view timer', async () => {
    vi.useFakeTimers();
    mockWall(ROTATION);
    renderWall();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.queryByTestId('leaderboard-board')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_100); });
    expect(screen.getByTestId('leaderboard-board')).toBeInTheDocument();
  });

  it('a live pour interrupts the leaderboard back to the wall', async () => {
    vi.useFakeTimers();
    const pouring = makeTap(1, { pouring: true, curServMl: 200 });
    mockWall(ROTATION, [pouring]);
    renderWall();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    // With a pour live the leaderboard view never takes the screen.
    expect(screen.queryByTestId('leaderboard-board')).toBeNull();
  });

  it('no playlist bar when rotation is disabled', async () => {
    mockWall({});
    renderWall();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('playlist-bar')).toBeNull();
  });

  it('applies display overrides from ?display= (look + takeover style)', async () => {
    (getDisplayView as Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 4, name: 'TV', wallSlug: 'main', overrides: { look: 'ledger' },
      },
    });
    mockWall({}, [makeTap(1)]);
    renderWall('/wall/main?display=4');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getDisplayView).toHaveBeenCalledWith(4);
    expect(screen.getByTestId('look-ledger')).toBeInTheDocument();
    expect(screen.queryByTestId('look-classic')).toBeNull();
  });

  it('auto-chunks taps into pages by the look\'s own capacity (Columns holds 8)', async () => {
    const taps = Array.from({ length: 10 }, (_, i) => makeTap(i + 1));
    mockWall({ look: 'columns' }, taps);
    renderWall();
    await act(async () => { await Promise.resolve(); });
    // Page 1 shows 8 columns; the header announces 2 pages.
    expect(screen.getAllByTestId('columns-col')).toHaveLength(8);
    expect(screen.getByTestId('look-meta')).toHaveTextContent('page 1 of 2');
  });
});
