import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { BeersPage } from '../../../src/web/routes/admin/BeersPage';
import {
  listBeers, deleteBeer, listKegs, getLookupConfig,
} from '../../../src/web/lib/adminApi';
import { getMenu } from '../../../src/web/lib/api';
import type { Beer } from '../../../src/server/db/beers';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listBeers: vi.fn(),
  deleteBeer: vi.fn(),
  listKegs: vi.fn(),
  getLookupConfig: vi.fn(),
}));

vi.mock('../../../src/web/lib/api', () => ({ getMenu: vi.fn() }));

vi.mock('../../../src/web/routes/admin/BeerForm', () => ({
  BeerForm: (props: { mode: string; beer: Beer | null; onSaved: (b: Beer) => void; onCancel: () => void }) => (
    <div data-testid="mock-beer-form">
      <span data-testid="mock-beer-form-mode">{props.mode}</span>
      <span data-testid="mock-beer-form-target">{props.beer?.name ?? ''}</span>
      <button
        type="button"
        data-testid="mock-beer-form-save"
        onClick={() => props.onSaved({
          id: 99, name: 'Saved Beer', brewery: null, style: null, abv: null, ibu: null,
          srm: null, description: null, labelImage: null, createdAt: '',
        })}
      >
        Save
      </button>
      <button type="button" data-testid="mock-beer-form-cancel" onClick={props.onCancel}>Cancel</button>
    </div>
  ),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeBeer(overrides: Partial<Beer> = {}): Beer {
  return {
    id: 1, name: 'Citra IPA', brewery: 'Test Brewery', style: 'IPA', abv: 6.5, ibu: 60,
    srm: 6, description: null, labelImage: '/labels/citra.png', createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listBeers as Mock).mockResolvedValue({ ok: true, data: [] });
  (listKegs as Mock).mockResolvedValue({ ok: true, data: [] });
  (getLookupConfig as Mock).mockResolvedValue({ ok: true, data: { catalogBeerConfigured: false, autoImportBeers: true } });
  (getMenu as Mock).mockResolvedValue({ ok: true, data: { siteName: 'X', taps: [], units: 'us' } });
});

describe('BeersPage', () => {
  it('renders one row per beer with name/brewery/style/abv/ibu/srm-chip/thumb from fixtures', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer(), makeBeer({ id: 2, name: 'Pilsner', brewery: null, abv: null, ibu: null, srm: null, labelImage: null })] });
    renderAdminPage(<BeersPage />);
    const rows = await screen.findAllByTestId('beers-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toHaveTextContent('Citra IPA');
    expect(rows[0]!).toHaveTextContent('Test Brewery');
    expect(rows[0]!).toHaveTextContent('IPA');
    expect(rows[0]!).toHaveTextContent('6.5%');
    expect(rows[0]!).toHaveTextContent('60');
    expect(rows[0]!.querySelector('[data-testid="beers-row-thumb"]')).toHaveAttribute('src', '/labels/citra.png');
    expect(rows[0]!.querySelector('[data-testid="beers-row-srm-chip"]')).toBeInTheDocument();
    expect(rows[1]!).toHaveTextContent('Pilsner');
    expect(rows[1]!).toHaveTextContent('—'); // brewery/abv/ibu all blank
  });

  it('shows a quiet empty state when there are no beers', async () => {
    renderAdminPage(<BeersPage />);
    expect(await screen.findByTestId('beers-empty')).toHaveTextContent('No beers yet.');
  });

  it('shows a count summary of total / on tap / missing label art', async () => {
    (listBeers as Mock).mockResolvedValue({
      ok: true,
      data: [makeBeer({ id: 1 }), makeBeer({ id: 2, labelImage: null }), makeBeer({ id: 3, labelImage: null })],
    });
    (getMenu as Mock).mockResolvedValue({
      ok: true,
      data: {
        siteName: 'X',
        units: 'us',
        taps: [{
          tapId: 1, tapNumber: 1, tapName: null,
          beer: { ...makeBeer({ id: 1 }) },
          keg: {
            id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 5000, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 72, remainingMl: 14000,
          },
          lastPour: null, pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null, avgRating: null, nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
        }],
      },
    });
    renderAdminPage(<BeersPage />);
    expect(await screen.findByTestId('beers-summary')).toHaveTextContent('3 total · 1 on tap · 2 missing label art');
  });

  it('renders the LOOKUP chip row — catalog.beer dashed until keyed, auto-import on', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer()] });
    renderAdminPage(<BeersPage />);
    await screen.findAllByTestId('beers-row');
    expect(screen.getByTestId('beers-chip-catalog')).toHaveTextContent('add API key');
    expect(screen.getByTestId('beers-chip-catalog').className).toContain('dashed');
    expect(screen.getByTestId('beers-chip-autoimport')).toHaveTextContent('Auto-import from Kegtron: on');
  });

  it('shows a STATUS pill per beer: TAP+level on tap, ON DECK when queued, — otherwise', async () => {
    (listBeers as Mock).mockResolvedValue({
      ok: true, data: [makeBeer({ id: 1 }), makeBeer({ id: 2 }), makeBeer({ id: 3 })],
    });
    (getMenu as Mock).mockResolvedValue({
      ok: true,
      data: {
        siteName: 'X', units: 'us',
        taps: [{
          tapId: 2, tapNumber: 2, tapName: null,
          beer: { ...makeBeer({ id: 1 }) },
          keg: {
            id: 1, beerId: 1, tapId: 2, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 5300, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 72, remainingMl: 14000,
          },
          lastPour: null, pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null, avgRating: null, nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
        }],
      },
    });
    (listKegs as Mock).mockResolvedValue({
      ok: true, data: [{ id: 9, beerId: 2, tapId: null, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status: 'on_deck', createdAt: '', kegType: null, costCents: null }],
    });
    renderAdminPage(<BeersPage />);
    const rows = await screen.findAllByTestId('beers-row');
    expect(rows[0]!.querySelector('[data-testid="beers-row-status"]')).toHaveTextContent('TAP 2 · 72%');
    expect(rows[1]!.querySelector('[data-testid="beers-row-status"]')).toHaveTextContent('ON DECK');
    expect(rows[2]!.querySelector('[data-testid="beers-row-status"]')).toHaveTextContent('—');
  });

  it('filters the table by the search box', async () => {
    (listBeers as Mock).mockResolvedValue({
      ok: true, data: [makeBeer({ id: 1, name: 'Citra IPA' }), makeBeer({ id: 2, name: 'Dark Stout', brewery: 'Night Co' })],
    });
    renderAdminPage(<BeersPage />);
    expect(await screen.findAllByTestId('beers-row')).toHaveLength(2);
    fireEvent.change(screen.getByTestId('beers-search'), { target: { value: 'stout' } });
    await flush();
    const rows = screen.getAllByTestId('beers-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toHaveTextContent('Dark Stout');
  });

  it('offers a dashed "add art" chip on a beer missing label art (opens its edit form)', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer({ name: 'No Art', labelImage: null })] });
    renderAdminPage(<BeersPage />);
    const addArt = await screen.findByTestId('beers-row-add-art');
    fireEvent.click(addArt);
    expect(screen.getByTestId('mock-beer-form-mode')).toHaveTextContent('edit');
    expect(screen.getByTestId('mock-beer-form-target')).toHaveTextContent('No Art');
  });

  it('a viewer sees a read-only table: no Add button, no Edit/Delete controls', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer()] });
    renderAdminPage(<BeersPage />, adminContext('viewer'));
    await screen.findAllByTestId('beers-row');
    expect(screen.queryByTestId('beers-add-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('beers-row-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('beers-row-delete')).not.toBeInTheDocument();
  });

  it('an editor sees "Add beer", which opens the create form', async () => {
    renderAdminPage(<BeersPage />);
    await flush();
    fireEvent.click(screen.getByTestId('beers-add-button'));
    expect(screen.getByTestId('mock-beer-form-mode')).toHaveTextContent('create');
  });

  it('clicking Edit on a row opens the edit form for that beer', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer({ name: 'Stout' })] });
    renderAdminPage(<BeersPage />);
    await screen.findAllByTestId('beers-row');
    fireEvent.click(screen.getByTestId('beers-row-edit'));
    expect(screen.getByTestId('mock-beer-form-mode')).toHaveTextContent('edit');
    expect(screen.getByTestId('mock-beer-form-target')).toHaveTextContent('Stout');
  });

  it('saving the form closes it and reloads the beers list', async () => {
    renderAdminPage(<BeersPage />);
    await flush();
    fireEvent.click(screen.getByTestId('beers-add-button'));
    expect(listBeers).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('mock-beer-form-save'));
    expect(screen.queryByTestId('mock-beer-form')).not.toBeInTheDocument();
    expect(listBeers).toHaveBeenCalledTimes(2);
  });

  it('canceling the form closes it without reloading', async () => {
    renderAdminPage(<BeersPage />);
    await flush();
    fireEvent.click(screen.getByTestId('beers-add-button'));
    fireEvent.click(screen.getByTestId('mock-beer-form-cancel'));
    expect(screen.queryByTestId('mock-beer-form')).not.toBeInTheDocument();
    expect(listBeers).toHaveBeenCalledTimes(1);
  });

  it('deleting shows a full consequence sentence (never a bare "are you sure")', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer({ name: 'Stout' })] });
    renderAdminPage(<BeersPage />);
    await screen.findAllByTestId('beers-row');
    fireEvent.click(screen.getByTestId('beers-row-delete'));
    const confirm = screen.getByTestId('beers-delete-confirm');
    expect(confirm).toHaveTextContent('This will permanently delete');
    expect(confirm).toHaveTextContent('Stout');
    expect(confirm).toHaveTextContent("can’t be undone");
    expect(confirm.textContent).not.toMatch(/^Are you sure\?$/);
  });

  it('a successful delete closes the confirmation and reloads the list', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer()] });
    (deleteBeer as Mock).mockResolvedValue({ ok: true, data: null });
    renderAdminPage(<BeersPage />);
    await screen.findAllByTestId('beers-row');
    fireEvent.click(screen.getByTestId('beers-row-delete'));
    fireEvent.click(screen.getByTestId('beers-delete-confirm-button'));
    await flush();
    expect(deleteBeer).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('beers-delete-confirm')).not.toBeInTheDocument();
    expect(listBeers).toHaveBeenCalledTimes(2);
  });

  it('a 409 delete conflict explains the beer is in use by a keg, and keeps the dialog open', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer({ name: 'Stout' })] });
    (deleteBeer as Mock).mockResolvedValue({ ok: false, status: 409, message: 'beer 1 is referenced by 1 keg(s)' });
    renderAdminPage(<BeersPage />);
    await screen.findAllByTestId('beers-row');
    fireEvent.click(screen.getByTestId('beers-row-delete'));
    fireEvent.click(screen.getByTestId('beers-delete-confirm-button'));
    await flush();
    expect(screen.getByTestId('beers-delete-error')).toHaveTextContent('in use by a keg');
    expect(screen.getByTestId('beers-delete-confirm')).toBeInTheDocument();
  });

  it('a non-409 delete failure shows a generic retry message', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer()] });
    (deleteBeer as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Something went wrong' });
    renderAdminPage(<BeersPage />);
    await screen.findAllByTestId('beers-row');
    fireEvent.click(screen.getByTestId('beers-row-delete'));
    fireEvent.click(screen.getByTestId('beers-delete-confirm-button'));
    await flush();
    expect(screen.getByTestId('beers-delete-error')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('canceling the delete dialog leaves the beer intact', async () => {
    (listBeers as Mock).mockResolvedValue({ ok: true, data: [makeBeer()] });
    renderAdminPage(<BeersPage />);
    await screen.findAllByTestId('beers-row');
    fireEvent.click(screen.getByTestId('beers-row-delete'));
    fireEvent.click(screen.getByTestId('beers-delete-cancel-button'));
    expect(screen.queryByTestId('beers-delete-confirm')).not.toBeInTheDocument();
    expect(deleteBeer).not.toHaveBeenCalled();
  });
});
