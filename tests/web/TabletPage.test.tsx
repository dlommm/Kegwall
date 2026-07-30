import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TabletPage, POURER_COLORS } from '../../src/web/routes/TabletPage';
import { useWallData, type UseWallDataResult } from '../../src/web/lib/useWallData';
import {
  armTablet, createPourer, disarmTablet, getPourers,
} from '../../src/web/lib/api';
import { wallConfigSchema } from '../../src/server/core/wallConfig';
import type { TapState } from '../../src/server/core/state';

vi.mock('../../src/web/lib/useWallData', () => ({ useWallData: vi.fn() }));
vi.mock('../../src/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/api')>()),
  getPourers: vi.fn(),
  createPourer: vi.fn(),
  armTablet: vi.fn(),
  disarmTablet: vi.fn(),
}));

function makeTap(tapId: number, overrides: Partial<TapState> = {}): TapState {
  return {
    tapId,
    tapNumber: tapId,
    tapName: null,
    beer: {
      id: tapId, name: 'Morning Line', brewery: null, style: 'Pilsner', abv: 4.9, ibu: 32, srm: 3, description: null, labelImage: null, createdAt: '',
    },
    keg: {
      id: tapId, beerId: tapId, tapId, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 100, remainingMl: 19000,
    },
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

const wall = {
  slug: 'main',
  name: 'Main',
  config: wallConfigSchema.parse({}),
};

function mockWallData(overrides: Partial<UseWallDataResult> = {}): { onMessage?: (msg: unknown) => void } {
  const captured: { onMessage?: (msg: unknown) => void } = {};
  (useWallData as Mock).mockImplementation((_slug: string, options?: { onMessage?: (msg: unknown) => void }) => {
    captured.onMessage = options?.onMessage;
    return {
      wall, taps: [], units: 'us', stale: false, connected: true, loading: false, error: null, notFound: false, ...overrides,
    };
  });
  return captured;
}

function renderTablet() {
  return render(
    <MemoryRouter initialEntries={['/tablet/main']}>
      <Routes>
        <Route path="/tablet/:slug" element={<TabletPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TabletPage (design 3a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getPourers as Mock).mockResolvedValue({
      ok: true,
      data: [
        { id: 1, displayName: 'Sam', avatarColor: '#D08C4C', pourCount: 127 },
        { id: 2, displayName: 'JT', avatarColor: '#5FD9BC', pourCount: 94 },
      ],
    });
    (armTablet as Mock).mockResolvedValue({ ok: true, data: { armed: true, drinkerId: 1 } });
    (disarmTablet as Mock).mockResolvedValue({ ok: true, data: { armed: false } });
    (createPourer as Mock).mockResolvedValue({
      ok: true, data: { id: 9, displayName: 'Drew', avatarColor: '#94C25C' },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('screen 1: shows the avatar grid with pour counts and the sign-up CTA', async () => {
    mockWallData();
    renderTablet();
    await flush();
    expect(screen.getByText('Who’s pouring?')).toBeInTheDocument();
    const avatars = screen.getAllByTestId('tablet-avatar');
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toHaveTextContent('Sam');
    expect(avatars[0]).toHaveTextContent('127 pours');
    expect(screen.getByTestId('tablet-signup-button')).toHaveTextContent('I’M NEW — SIGN ME UP');
  });

  it('tapping an avatar arms the pourer and shows the armed screen', async () => {
    mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    expect(armTablet).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('tablet-armed')).toHaveTextContent('You’re up, Sam — pour from any tap');
    expect(screen.getByTestId('tablet-waiting')).toBeInTheDocument();
  });

  it('screen 2: signup takes a name + color only, then arms the new pourer', async () => {
    mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getByTestId('tablet-signup-button'));
    expect(screen.getByTestId('tablet-signup')).toHaveTextContent('Just a name — no email, no password.');
    expect(screen.getAllByTestId('tablet-signup-color')).toHaveLength(POURER_COLORS.length);

    fireEvent.change(screen.getByTestId('tablet-signup-name'), { target: { value: 'Drew' } });
    fireEvent.click(screen.getAllByTestId('tablet-signup-color')[4]!);
    fireEvent.click(screen.getByTestId('tablet-signup-submit'));
    await flush();
    expect(createPourer).toHaveBeenCalledWith('Drew', POURER_COLORS[4]);
    expect(armTablet).toHaveBeenCalledWith(9);
    expect(screen.getByTestId('tablet-armed')).toHaveTextContent('Drew');
  });

  it('screen 3: shows the auto-detected tap and live counter while pouring', async () => {
    mockWallData({ taps: [makeTap(2, { pouring: true, curServMl: 250 })] });
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    expect(screen.getByTestId('tablet-detected')).toHaveTextContent('DETECTED · TAP 2 · MORNING LINE');
    expect(screen.getByTestId('tablet-counter')).toHaveTextContent('8.5');
  });

  it('screen 4: a pour_attributed WS message flips to the done screen; countdown signs out', async () => {
    vi.useFakeTimers();
    const captured = mockWallData();
    renderTablet();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    act(() => {
      captured.onMessage?.({
        type: 'pour_attributed', drinkerId: 1, pourId: 5, tapId: 2, tapNumber: 2, beerName: 'Morning Line', volumeMl: 372.6, pourCount: 128, ts: 'now',
      });
    });
    const done = screen.getByTestId('tablet-done');
    expect(done).toHaveTextContent('Cheers, Sam');
    expect(done).toHaveTextContent('12.6 oz of Morning Line');
    expect(done).toHaveTextContent('pour #128');
    expect(screen.getByTestId('tablet-countdown')).toHaveTextContent('Signing out in 5s — tap to stay');

    await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
    expect(disarmTablet).toHaveBeenCalled();
    expect(screen.getByTestId('tablet-grid')).toBeInTheDocument();
  });

  it("ignores pour_attributed for a different pourer's drinkerId", async () => {
    const captured = mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    act(() => {
      captured.onMessage?.({
        type: 'pour_attributed', drinkerId: 99, pourId: 5, tapId: 2, tapNumber: 2, beerName: 'X', volumeMl: 100, pourCount: 1, ts: 'now',
      });
    });
    expect(screen.getByTestId('tablet-armed')).toBeInTheDocument();
    expect(screen.queryByTestId('tablet-done')).toBeNull();
  });

  it('tap-to-stay on the done screen re-arms instead of signing out', async () => {
    const captured = mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    act(() => {
      captured.onMessage?.({
        type: 'pour_attributed', drinkerId: 1, pourId: 5, tapId: 2, tapNumber: 2, beerName: 'Morning Line', volumeMl: 372.6, pourCount: 128, ts: 'now',
      });
    });
    (armTablet as Mock).mockClear();
    fireEvent.click(screen.getByTestId('tablet-done'));
    await flush();
    expect(armTablet).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('tablet-armed')).toBeInTheDocument();
  });

  it('sign out disarms and returns to the grid', async () => {
    mockWallData();
    renderTablet();
    await flush();
    fireEvent.click(screen.getAllByTestId('tablet-avatar')[0]!);
    await flush();
    fireEvent.click(screen.getByTestId('tablet-signout'));
    await flush();
    expect(disarmTablet).toHaveBeenCalled();
    expect(screen.getByTestId('tablet-grid')).toBeInTheDocument();
  });
});
