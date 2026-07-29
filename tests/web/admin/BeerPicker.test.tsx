import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BeerPicker } from '../../../src/web/routes/admin/BeerPicker';
import { importKegtronBeer } from '../../../src/web/lib/adminApi';
import type { Beer } from '../../../src/server/db/beers';

vi.mock('../../../src/web/lib/adminApi', () => ({
  importKegtronBeer: vi.fn(),
  // BeerForm (mounted when "Add new beer" is clicked) pulls in the rest of adminApi —
  // stub every export it touches so that path doesn't crash the test.
  createBeer: vi.fn(),
  updateBeer: vi.fn(),
  uploadLabel: vi.fn(),
  lookupBreweries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  // BeerForm's mount-time catalog.beer probe (empty-query 501 == not configured) — stub
  // as "not configured" so the "Search catalog.beer" button never appears here; this
  // test's own coverage is BeerForm.test.tsx's dedicated describe block.
  lookupBeers: vi.fn().mockResolvedValue({ ok: false, status: 501, message: 'not configured' }),
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
    srm: 6, description: null, labelImage: null, createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('BeerPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists every beer when the search box is empty', () => {
    render(<BeerPicker beers={[makeBeer(), makeBeer({ id: 2, name: 'Pilsner' })]} onPick={vi.fn()} />);
    expect(screen.getAllByTestId('beer-picker-option')).toHaveLength(2);
  });

  it('filters the list as the search box changes, case-insensitively', () => {
    render(<BeerPicker beers={[makeBeer(), makeBeer({ id: 2, name: 'Pilsner' })]} onPick={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-picker-search'), { target: { value: 'pils' } });
    const options = screen.getAllByTestId('beer-picker-option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Pilsner');
  });

  it('shows an empty-catalog message distinct from a no-match message', () => {
    const { rerender } = render(<BeerPicker beers={[]} onPick={vi.fn()} />);
    expect(screen.getByTestId('beer-picker-empty')).toHaveTextContent('No beers in the catalog yet.');
    rerender(<BeerPicker beers={[makeBeer()]} onPick={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-picker-search'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('beer-picker-empty')).toHaveTextContent('No beers match that search.');
  });

  it('picking an existing beer calls onPick with it', () => {
    const beer = makeBeer();
    const onPick = vi.fn();
    render(<BeerPicker beers={[beer]} onPick={onPick} />);
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    expect(onPick).toHaveBeenCalledWith(beer);
  });

  it('hides "Add new beer" and "Import from Kegtron" by default', () => {
    render(<BeerPicker beers={[]} onPick={vi.fn()} />);
    expect(screen.queryByTestId('beer-picker-create-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('beer-picker-import-button')).not.toBeInTheDocument();
  });

  it('"Add new beer" mounts BeerForm inline and picks whatever it saves', async () => {
    const onPick = vi.fn();
    render(<BeerPicker beers={[]} onPick={onPick} allowCreate />);
    fireEvent.click(screen.getByTestId('beer-picker-create-button'));
    expect(screen.getByTestId('beer-form')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('beer-form-name'), { target: { value: 'New Beer' } });
    const { createBeer } = await import('../../../src/web/lib/adminApi');
    (createBeer as Mock).mockResolvedValue({ ok: true, data: makeBeer({ id: 9, name: 'New Beer' }) });
    fireEvent.click(screen.getByTestId('beer-form-submit'));
    await flush();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 9, name: 'New Beer' }));
  });

  it('"Import from Kegtron" is hidden without a monitor id, shown with one', () => {
    const { rerender } = render(<BeerPicker beers={[]} onPick={vi.fn()} />);
    expect(screen.queryByTestId('beer-picker-import-button')).not.toBeInTheDocument();
    rerender(<BeerPicker beers={[]} onPick={vi.fn()} kegtronMonitorId={3} />);
    expect(screen.getByTestId('beer-picker-import-button')).toBeInTheDocument();
  });

  it('importing from Kegtron picks the created beer on success', async () => {
    const imported = makeBeer({ id: 7, name: 'King Cobra' });
    (importKegtronBeer as Mock).mockResolvedValue({ ok: true, data: imported });
    const onPick = vi.fn();
    render(<BeerPicker beers={[]} onPick={onPick} kegtronMonitorId={3} />);
    fireEvent.click(screen.getByTestId('beer-picker-import-button'));
    await flush();
    expect(importKegtronBeer).toHaveBeenCalledWith(3);
    expect(onPick).toHaveBeenCalledWith(imported);
  });

  it('a 502 from the Kegtron import is surfaced gently, without calling onPick', async () => {
    (importKegtronBeer as Mock).mockResolvedValue({
      ok: false, status: 502, message: 'Failed to read the device shadow via mdash.net (status 503)',
    });
    const onPick = vi.fn();
    render(<BeerPicker beers={[]} onPick={onPick} kegtronMonitorId={3} />);
    fireEvent.click(screen.getByTestId('beer-picker-import-button'));
    await flush();
    expect(screen.getByTestId('beer-picker-import-error')).toHaveTextContent("Couldn't reach the Kegtron device");
    expect(onPick).not.toHaveBeenCalled();
  });

  it('a non-502 import failure surfaces the server message directly', async () => {
    (importKegtronBeer as Mock).mockResolvedValue({
      ok: false, status: 400, message: 'monitor is not a Kegtron Pro device',
    });
    render(<BeerPicker beers={[]} onPick={vi.fn()} kegtronMonitorId={3} />);
    fireEvent.click(screen.getByTestId('beer-picker-import-button'));
    await flush();
    expect(screen.getByTestId('beer-picker-import-error')).toHaveTextContent('monitor is not a Kegtron Pro device');
  });
});
