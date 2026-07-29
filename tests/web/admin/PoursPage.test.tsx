import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { PoursPage } from '../../../src/web/routes/admin/PoursPage';
import {
  listRecentPours, listBeers, listKegs, listTaps, setPourDrinker,
} from '../../../src/web/lib/adminApi';
import { getDrinkers } from '../../../src/web/lib/api';
import type { Pour, Keg } from '../../../src/server/db/kegs';
import type { Beer } from '../../../src/server/db/beers';
import type { Tap } from '../../../src/server/db/taps';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listRecentPours: vi.fn(),
  listBeers: vi.fn(),
  listKegs: vi.fn(),
  listTaps: vi.fn(),
  setPourDrinker: vi.fn(),
}));

vi.mock('../../../src/web/lib/api', () => ({
  getDrinkers: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makePour(overrides: Partial<Pour> = {}): Pour {
  return {
    id: 1, kegId: 1, ts: '2026-07-28T11:55:00.000Z', volumeMl: 400,
    durationMs: 4000, source: 'cloud', drinkerId: null, quality: null, rating: null, ratingTags: null, ...overrides,
  };
}

function makeKeg(overrides: Partial<Keg> = {}): Keg {
  return {
    id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 400,
    dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, ...overrides,
  };
}

function makeBeer(overrides: Partial<Beer> = {}): Beer {
  return {
    id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null, srm: null,
    description: null, labelImage: null, createdAt: '', ...overrides,
  };
}

function makeTap(overrides: Partial<Tap> = {}): Tap {
  return {
    id: 1, number: 3, name: 'Left', defaultDrinkerId: null, locationId: null, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [] });
  (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer()] });
  (listKegs as Mock).mockResolvedValue({ ok: true, data: [makeKeg()] });
  (listTaps as Mock).mockResolvedValue({ ok: true, data: [makeTap()] });
  (getDrinkers as Mock).mockResolvedValue({
    ok: true,
    data: [
      { id: 10, displayName: 'Bob', avatarColor: null },
      { id: 11, displayName: 'Sam', avatarColor: null },
    ],
  });
});

describe('PoursPage', () => {
  it('shows a loading state, then a quiet empty state with no pours', async () => {
    renderAdminPage(<PoursPage />);
    expect(screen.getByTestId('pours-loading')).toBeInTheDocument();
    expect(await screen.findByTestId('pours-empty')).toBeInTheDocument();
  });

  it('shows an error state when any fetch fails', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: false, status: 500, message: 'nope' });
    renderAdminPage(<PoursPage />);
    expect(await screen.findByTestId('pours-error')).toBeInTheDocument();
  });

  it('renders one row per pour, joined against tap/beer/volume from the catalog data', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour()] });
    renderAdminPage(<PoursPage />);
    const row = await screen.findByTestId('pours-row');
    expect(row).toHaveTextContent('Citra IPA');
    expect(row).toHaveTextContent('Left');
    expect(row).toHaveTextContent('13.5 oz'); // 400mL in US units (default context)
  });

  it("shows 'Unknown'/'—' gracefully when a pour's keg/beer/tap can't be resolved", async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour({ kegId: 999 })] });
    renderAdminPage(<PoursPage />);
    const row = await screen.findByTestId('pours-row');
    expect(row).toHaveTextContent('Unknown');
    expect(row).toHaveTextContent('—');
  });

  it('shows "Unclaimed" for a pour with no drinker', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour({ drinkerId: null })] });
    renderAdminPage(<PoursPage />, adminContext('viewer'));
    const row = await screen.findByTestId('pours-row');
    expect(screen.getByTestId('pours-row-drinker-text')).toHaveTextContent('Unclaimed');
    expect(row).not.toHaveTextContent('undefined');
  });

  it('shows the claimed drinker\'s display name for a viewer (read-only, no select)', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour({ drinkerId: 10 })] });
    renderAdminPage(<PoursPage />, adminContext('viewer'));
    await screen.findByTestId('pours-row');
    expect(screen.getByTestId('pours-row-drinker-text')).toHaveTextContent('Bob');
    expect(screen.queryByTestId('pours-row-drinker-select')).not.toBeInTheDocument();
  });

  it('an editor sees a drinker picker offering Unclaimed + every drinker, pre-selected to the current claim', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour({ drinkerId: 10 })] });
    renderAdminPage(<PoursPage />, adminContext('editor'));
    await screen.findByTestId('pours-row');
    const select = screen.getByTestId('pours-row-drinker-select');
    expect(select).toHaveValue('10');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['Unclaimed', 'Bob', 'Sam']);
  });

  it('reassigning via the picker calls setPourDrinker and updates the row', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour({ drinkerId: 10 })] });
    (setPourDrinker as Mock).mockResolvedValue({ ok: true, data: makePour({ drinkerId: 11 }) });
    renderAdminPage(<PoursPage />, adminContext('editor'));
    await screen.findByTestId('pours-row');

    fireEvent.change(screen.getByTestId('pours-row-drinker-select'), { target: { value: '11' } });
    await flush();

    expect(setPourDrinker).toHaveBeenCalledWith(1, 11);
    expect(screen.getByTestId('pours-row-drinker-select')).toHaveValue('11');
  });

  it('selecting "Unclaimed" calls setPourDrinker with null', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour({ drinkerId: 10 })] });
    (setPourDrinker as Mock).mockResolvedValue({ ok: true, data: makePour({ drinkerId: null }) });
    renderAdminPage(<PoursPage />, adminContext('editor'));
    await screen.findByTestId('pours-row');

    fireEvent.change(screen.getByTestId('pours-row-drinker-select'), { target: { value: '' } });
    await flush();

    expect(setPourDrinker).toHaveBeenCalledWith(1, null);
  });

  it('a reassign failure shows a row-scoped error and leaves the selection reverted', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour({ drinkerId: 10 })] });
    (setPourDrinker as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Something went wrong' });
    renderAdminPage(<PoursPage />, adminContext('editor'));
    await screen.findByTestId('pours-row');

    fireEvent.change(screen.getByTestId('pours-row-drinker-select'), { target: { value: '11' } });
    await flush();

    expect(screen.getByTestId('pours-row-error')).toHaveTextContent('Something went wrong');
    // Controlled by `pour.drinkerId`, which the failed call never updated — reverts.
    expect(screen.getByTestId('pours-row-drinker-select')).toHaveValue('10');
  });
});
