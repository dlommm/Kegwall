import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import {
  PoursPage, POURS_PAGE_SIZE, formatPourTime, pourQueryFor,
} from '../../../src/web/routes/admin/PoursPage';
import {
  listRecentPours, listBeers, listKegs, listTaps, setPourDrinker, setPoursDrinker,
} from '../../../src/web/lib/adminApi';
import { getDrinkers } from '../../../src/web/lib/api';
import type { Pour, Keg } from '../../../src/server/db/kegs';
import type { Beer } from '../../../src/server/db/beers';
import type { Tap } from '../../../src/server/db/taps';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  getPoursSince: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  listRecentPours: vi.fn(),
  listBeers: vi.fn(),
  listKegs: vi.fn(),
  listTaps: vi.fn(),
  setPourDrinker: vi.fn(),
  setPoursDrinker: vi.fn(),
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
    id: 1, number: 3, name: 'Left', defaultDrinkerId: null, hidden: false, ...overrides,
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
  it('pages back with a keyset cursor and appends older pours', async () => {
    const firstPage = Array.from({ length: POURS_PAGE_SIZE }, (_, i) => makePour({ id: 500 - i }));
    (listRecentPours as Mock).mockResolvedValueOnce({ ok: true, data: firstPage });
    renderAdminPage(<PoursPage />, adminContext('viewer'));
    await screen.findByTestId('pours-table');
    expect(screen.getByTestId('pours-count')).toHaveTextContent(`Showing ${POURS_PAGE_SIZE} pours`);

    (listRecentPours as Mock).mockResolvedValueOnce({ ok: true, data: [makePour({ id: 3 }), makePour({ id: 2 })] });
    fireEvent.click(screen.getByTestId('pours-load-more'));
    await flush();

    expect(listRecentPours).toHaveBeenLastCalledWith({ beforeId: 401, limit: POURS_PAGE_SIZE });
    expect(screen.getAllByTestId('pours-row')).toHaveLength(POURS_PAGE_SIZE + 2);
    // A short page means the history is exhausted.
    expect(screen.queryByTestId('pours-load-more')).not.toBeInTheDocument();
  });

  it('hides "Load older pours" when the first page is not full', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour()] });
    renderAdminPage(<PoursPage />);
    await screen.findByTestId('pours-row');
    expect(screen.queryByTestId('pours-load-more')).not.toBeInTheDocument();
  });

  it('sends the drinker filter to the server and explains an empty filtered result', async () => {
    renderAdminPage(<PoursPage />);
    await screen.findByTestId('pours-empty');
    fireEvent.change(screen.getByTestId('pours-filter-drinker'), { target: { value: '11' } });
    await flush();
    expect(listRecentPours).toHaveBeenLastCalledWith({ drinkerId: 11, limit: POURS_PAGE_SIZE });
    expect(screen.getByTestId('pours-empty')).toHaveTextContent('No pours match these filters.');
    fireEvent.click(screen.getByTestId('pours-filter-clear'));
    await flush();
    expect(listRecentPours).toHaveBeenLastCalledWith({ limit: POURS_PAGE_SIZE });
  });

  it('bulk-assigns selected pours in one call and drops them from the unclaimed view', async () => {
    (listRecentPours as Mock).mockResolvedValue({
      ok: true, data: [makePour({ id: 1 }), makePour({ id: 2 }), makePour({ id: 3 })],
    });
    (setPoursDrinker as Mock).mockResolvedValue({
      ok: true, data: [makePour({ id: 1, drinkerId: 11 }), makePour({ id: 3, drinkerId: 11 })],
    });
    renderAdminPage(<PoursPage />, adminContext('editor'));
    await screen.findByTestId('pours-table');
    fireEvent.click(screen.getByLabelText('Unclaimed only'));
    await flush();
    expect(listRecentPours).toHaveBeenLastCalledWith({ unclaimed: true, limit: POURS_PAGE_SIZE });

    const boxes = screen.getAllByTestId('pours-row-select');
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[2]!);
    expect(screen.getByTestId('pours-bulk-count')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('pours-bulk-apply')).toBeDisabled();
    fireEvent.change(screen.getByTestId('pours-bulk-target'), { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('pours-bulk-apply'));
    await flush();

    expect(setPoursDrinker).toHaveBeenCalledWith([1, 3], 11);
    expect(screen.getAllByTestId('pours-row')).toHaveLength(1);
    expect(screen.getByTestId('pours-bulk-message')).toHaveTextContent('Assigned 2 pours to Sam.');
    expect(screen.queryByTestId('pours-bulk-bar')).not.toBeInTheDocument();
  });

  it('select-all plus "Unclaimed" bulk-unclaims; a failure keeps the selection and shows why', async () => {
    (listRecentPours as Mock).mockResolvedValue({
      ok: true, data: [makePour({ id: 1, drinkerId: 10 }), makePour({ id: 2, drinkerId: 10 })],
    });
    (setPoursDrinker as Mock).mockResolvedValue({ ok: false, status: 404, message: 'pour 2 not found' });
    renderAdminPage(<PoursPage />, adminContext('editor'));
    await screen.findByTestId('pours-table');
    fireEvent.click(screen.getByTestId('pours-select-all'));
    fireEvent.change(screen.getByTestId('pours-bulk-target'), { target: { value: 'unclaim' } });
    fireEvent.click(screen.getByTestId('pours-bulk-apply'));
    await flush();

    expect(setPoursDrinker).toHaveBeenCalledWith([1, 2], null);
    expect(screen.getByTestId('pours-bulk-message')).toHaveTextContent('pour 2 not found');
    expect(screen.getByTestId('pours-bulk-count')).toHaveTextContent('2 selected');
  });

  it('viewers get no selection checkboxes', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour()] });
    renderAdminPage(<PoursPage />, adminContext('viewer'));
    await screen.findByTestId('pours-row');
    expect(screen.queryByTestId('pours-row-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pours-select-all')).not.toBeInTheDocument();
  });

  it('shows a machine-readable timestamp with the full date on hover', async () => {
    (listRecentPours as Mock).mockResolvedValue({ ok: true, data: [makePour()] });
    renderAdminPage(<PoursPage />);
    const time = await screen.findByTestId('pours-row-time');
    expect(time).toHaveAttribute('dateTime', '2026-07-28T11:55:00.000Z');
    expect(time.getAttribute('title')).toBeTruthy();
  });
});

describe('formatPourTime', () => {
  const now = new Date('2026-09-26T12:00:00.000Z');
  it('is relative inside a day', () => {
    expect(formatPourTime('2026-09-26T11:48:00.000Z', now)).toBe('12 min ago');
  });
  it('is an absolute date after a day, adding the year only when it differs', () => {
    const lastWeek = formatPourTime('2026-09-19T12:00:00.000Z', now);
    expect(lastWeek).not.toMatch(/ago/);
    expect(lastWeek).not.toMatch(/2026/);
    expect(formatPourTime('2025-09-19T12:00:00.000Z', now)).toMatch(/2025/);
  });
  it('degrades to a dash for a bad timestamp', () => {
    expect(formatPourTime('nope', now)).toBe('—');
  });
});

describe('pourQueryFor', () => {
  it('turns local date bounds into inclusive UTC ISO bounds', () => {
    const q = pourQueryFor({ unclaimedOnly: false, drinkerId: '', from: '2026-09-01', to: '2026-09-02' });
    expect(q.since).toBe(new Date('2026-09-01T00:00:00').toISOString());
    expect(q.until).toBe(new Date('2026-09-02T23:59:59.999').toISOString());
  });
  it('lets "Unclaimed only" win over a drinker filter', () => {
    expect(pourQueryFor({ unclaimedOnly: true, drinkerId: '10', from: '', to: '' })).toEqual({ unclaimed: true });
  });
});
