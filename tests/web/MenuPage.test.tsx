import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
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
    monitorOnline: true, hidden: false,
    temp: null,
    avgRating: null,
    nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
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

  it('shows a discreet admin link in the footer', async () => {
    (getMenu as Mock).mockResolvedValue({
      ok: true, data: { siteName: 'The Keg Cave', taps: [], units: 'us' },
    });
    renderMenu();
    const link = await screen.findByTestId('menu-admin-link');
    expect(link).toHaveTextContent('Staff sign-in');
    expect(link).toHaveAttribute('href', '/admin');
  });

  it('never renders a hidden tap on the public menu', async () => {
    (getMenu as Mock).mockResolvedValue({
      ok: true, data: { siteName: 'The Keg Cave', taps: [], units: 'us' },
    });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1), { ...makeTap(2), hidden: true }],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderMenu();
    const cards = await screen.findAllByTestId('menu-tap');
    expect(cards).toHaveLength(1);
  });

  it('shows the on-tap count pill and filters by New / Almost gone (redesign 2b)', async () => {
    const keg = (over: Partial<NonNullable<TapState['keg']>>): TapState['keg'] => ({
      id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null,
      status: 'on_tap', createdAt: '', kegType: null, costCents: null, depositCents: null, supplierId: null,
      purchasedAt: null, levelPct: 60, remainingMl: 11000, ...over,
    });
    const beer = { id: 1, name: 'Beer', brewery: null, style: null, abv: null, ibu: null, srm: 5, description: null, labelImage: null, createdAt: '', markupOverridePct: null, exclusiveSupplierId: null };
    (getMenu as Mock).mockResolvedValue({ ok: true, data: { siteName: 'X', taps: [], units: 'us' } });
    (useTapStates as Mock).mockReturnValue({
      taps: [
        makeTap(1, { beer, keg: keg({ dateTapped: new Date(Date.now() - 2 * 86400000).toISOString(), levelPct: 80 }) }),
        makeTap(2, { beer, keg: keg({ dateTapped: '2026-01-01T00:00:00Z', levelPct: 9 }) }),
      ],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderMenu();
    expect(await screen.findByTestId('menu-page-count')).toHaveTextContent('2 on tap');
    expect(screen.getAllByTestId('menu-tap')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('menu-filter-new'));
    expect(screen.getAllByTestId('menu-tap')).toHaveLength(1); // only the freshly tapped keg

    fireEvent.click(screen.getByTestId('menu-filter-low'));
    expect(screen.getAllByTestId('menu-tap')).toHaveLength(1); // only the 9% keg

    fireEvent.click(screen.getByTestId('menu-filter-all'));
    expect(screen.getAllByTestId('menu-tap')).toHaveLength(2);
  });

  it('renders one row per tap, seeded from getMenu', async () => {
    (getMenu as Mock).mockResolvedValue({
      ok: true, data: { siteName: 'The Keg Cave', taps: [makeTap(1), makeTap(2)], units: 'us' },
    });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(1), makeTap(2)], stale: false, connected: true, reconnectCount: 0,
    });
    renderMenu();
    const cards = await screen.findAllByTestId('menu-tap');
    expect(cards).toHaveLength(2);
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
          id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 4000, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 80, remainingMl: 15000,
        },
      })],
      stale: false,
      connected: true,
      reconnectCount: 0,
    });
    renderMenu();
    expect(await screen.findByTestId('menu-tap-pouring')).toHaveTextContent('200 mL');
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

  describe('Kegwall V2 phone menu', () => {
    const beer = (id: number, name: string, style: string, srm = 6) => ({
      id, name, brewery: 'Halfmoon', style, abv: 5.5, ibu: 30, srm, description: `${name} notes`, labelImage: null, createdAt: '',
    });
    const keg = (tapId: number): TapState['keg'] => ({
      id: tapId, beerId: tapId, tapId, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 4000, dateTapped: '2026-01-01T00:00:00Z',
      status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 80, remainingMl: 15000,
    });
    function live() {
      (getMenu as Mock).mockResolvedValue({ ok: true, data: { siteName: 'X', taps: [], units: 'us', servingSizeMl: 473 } });
      (useTapStates as Mock).mockReturnValue({
        taps: [
          makeTap(1, { beer: beer(1, 'Citra Haze', 'Hazy IPA'), keg: keg(1) }),
          makeTap(2, { beer: beer(2, 'Midnight Oats', 'Oatmeal Stout', 40), keg: keg(2) }),
        ],
        stale: false, connected: true, reconnectCount: 0,
      });
    }

    it('shows the name on its own line, then tap · style · ABV · IBU and pints left', async () => {
      live();
      renderMenu();
      const [first] = await screen.findAllByTestId('menu-tap');
      expect(first).toHaveTextContent('Citra Haze');
      expect(first).toHaveTextContent('Tap 1 · Hazy IPA · 5.5% · 30 IBU');
      expect(first).toHaveTextContent('32pints left');
    });

    it('offers only the style families on tap, and filters by them', async () => {
      live();
      renderMenu();
      await screen.findAllByTestId('menu-tap');
      expect(screen.getByTestId('menu-filter-hoppy')).toBeInTheDocument();
      expect(screen.getByTestId('menu-filter-dark')).toBeInTheDocument();
      expect(screen.queryByTestId('menu-filter-sour')).toBeNull();
      fireEvent.click(screen.getByTestId('menu-filter-dark'));
      expect(screen.getAllByTestId('menu-tap')).toHaveLength(1);
      expect(screen.getByTestId('menu-tap')).toHaveTextContent('Midnight Oats');
    });

    it('search narrows the list by name, brewery or style', async () => {
      live();
      renderMenu();
      await screen.findAllByTestId('menu-tap');
      fireEvent.change(screen.getByTestId('menu-search'), { target: { value: 'stout' } });
      expect(screen.getAllByTestId('menu-tap')).toHaveLength(1);
      fireEvent.change(screen.getByTestId('menu-search'), { target: { value: 'zzz' } });
      expect(screen.getByTestId('menu-page-empty')).toHaveTextContent('Nothing matches');
    });

    it('a row opens an opaque beer sheet with the description; Escape closes it', async () => {
      live();
      renderMenu();
      const [first] = await screen.findAllByTestId('menu-tap');
      fireEvent.click(first!);
      const sheet = screen.getByTestId('beer-sheet');
      expect(sheet).toHaveAttribute('role', 'dialog');
      expect(screen.getByTestId('beer-sheet-description')).toHaveTextContent('Citra Haze notes');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('beer-sheet')).toBeNull();
    });
  });
});
