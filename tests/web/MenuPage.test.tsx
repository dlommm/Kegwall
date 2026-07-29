import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MenuPage } from '../../src/web/routes/MenuPage';
import { getMenu } from '../../src/web/lib/api';
import { useTapStates } from '../../src/web/lib/useTapStates';
import type { TapState } from '../../src/server/core/state';

vi.mock('../../src/web/lib/api', () => ({
  getMenu: vi.fn(),
  getRecentPours: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getDrinkers: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  claimPour: vi.fn(),
}));
vi.mock('../../src/web/lib/useTapStates', () => ({ useTapStates: vi.fn() }));

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
    locationId: null,
    ...overrides,
  };
}

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/menu']}>
      <Routes>
        <Route path="/menu" element={<MenuPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MenuPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useTapStates as Mock).mockReturnValue({
      taps: [], stale: false, connected: true, reconnectCount: 0,
    });
  });

  it('shows a loading state before the menu resolves', () => {
    (getMenu as Mock).mockReturnValue(new Promise(() => {}));
    renderMenu();
    expect(screen.getByTestId('menu-page-loading')).toBeInTheDocument();
  });

  it('renders the site name header once the menu loads', async () => {
    (getMenu as Mock).mockResolvedValue({
      ok: true, data: { siteName: 'The Keg Cave', taps: [], units: 'us' },
    });
    renderMenu();
    expect(await screen.findByTestId('menu-page-site-name')).toHaveTextContent('The Keg Cave');
  });

  it('renders one compact tap card per tap, seeded from getMenu', async () => {
    (getMenu as Mock).mockResolvedValue({
      ok: true, data: { siteName: 'The Keg Cave', taps: [makeTap(1), makeTap(2)], units: 'us' },
    });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1), makeTap(2)], stale: false, connected: true, reconnectCount: 0,
    });
    renderMenu();
    const cards = await screen.findAllByTestId('tap-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-template', 'compact');
  });

  it('reflects live tap updates from useTapStates, with units threaded through', async () => {
    (getMenu as Mock).mockResolvedValue({
      ok: true, data: { siteName: 'The Keg Cave', taps: [], units: 'metric' },
    });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1, {
        pouring: true,
        curServMl: 200,
        beer: {
          id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null, srm: 6, description: null, labelImage: null, createdAt: '',
        },
        keg: {
          id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 4000, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, levelPct: 80, remainingMl: 15000,
        },
      })],
      stale: false,
      connected: true,
      reconnectCount: 0,
    });
    renderMenu();
    expect(await screen.findByTestId('liquid-readout')).toHaveTextContent('200 mL');
  });

  it('passes initial taps from getMenu into useTapStates', async () => {
    const initialTaps = [makeTap(1)];
    (getMenu as Mock).mockResolvedValue({
      ok: true, data: { siteName: 'The Keg Cave', taps: initialTaps, units: 'us' },
    });
    renderMenu();
    await screen.findByTestId('menu-page-site-name');
    expect(useTapStates).toHaveBeenCalledWith(initialTaps);
  });

  it('shows an error message when the menu fails to load', async () => {
    (getMenu as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Boom' });
    renderMenu();
    expect(await screen.findByTestId('menu-page-error')).toHaveTextContent('Boom');
  });

  it('renders the claim-your-pour section', async () => {
    (getMenu as Mock).mockResolvedValue({
      ok: true, data: { siteName: 'The Keg Cave', taps: [], units: 'us' },
    });
    renderMenu();
    expect(await screen.findByTestId('claim-sheet')).toBeInTheDocument();
  });
});
