import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OnDeckQueue } from '../../../src/web/routes/admin/OnDeckQueue';
import { listOnDeck, createKeg, removeOnDeckKeg } from '../../../src/web/lib/adminApi';
import type { Beer } from '../../../src/server/db/beers';
import type { Keg } from '../../../src/server/db/kegs';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listOnDeck: vi.fn(),
  createKeg: vi.fn(),
  removeOnDeckKeg: vi.fn(),
  createBeer: vi.fn(),
  updateBeer: vi.fn(),
  uploadLabel: vi.fn(),
  lookupBreweries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeBeer(overrides: Partial<Beer> = {}): Beer {
  return {
    id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null,
    srm: 6, description: null, labelImage: null, createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

function makeKeg(overrides: Partial<Keg> = {}): Keg {
  return {
    id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0,
    dateTapped: null, status: 'on_deck', createdAt: '2026-07-28T00:00:00.000Z', kegType: null,
    ...overrides,
  };
}

describe('OnDeckQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listOnDeck as Mock).mockResolvedValue({ ok: true, data: [] });
  });

  it('shows an empty state when nothing is queued', async () => {
    render(
      <OnDeckQueue tapId={1} beers={[]} kegs={[]} units="us" canEdit onPromote={vi.fn()} refreshKey={0} />,
    );
    expect(await screen.findByTestId('on-deck-empty')).toHaveTextContent('Nothing queued.');
  });

  it('lists queued kegs with the beer name and formatted size', async () => {
    (listOnDeck as Mock).mockResolvedValue({
      ok: true, data: [makeKeg({ id: 2, beerId: 1, sizeMl: 19000 })],
    });
    render(
      <OnDeckQueue
        tapId={1} beers={[makeBeer({ id: 1, name: 'Pilsner' })]} kegs={[]} units="metric"
        canEdit onPromote={vi.fn()} refreshKey={0}
      />,
    );
    const row = await screen.findByTestId('on-deck-row');
    expect(row).toHaveTextContent('Pilsner');
    expect(row).toHaveTextContent('19000 mL');
  });

  it('refetches when refreshKey changes', async () => {
    const { rerender } = render(
      <OnDeckQueue tapId={1} beers={[]} kegs={[]} units="us" canEdit onPromote={vi.fn()} refreshKey={0} />,
    );
    await flush();
    expect(listOnDeck).toHaveBeenCalledTimes(1);
    rerender(
      <OnDeckQueue tapId={1} beers={[]} kegs={[]} units="us" canEdit onPromote={vi.fn()} refreshKey={1} />,
    );
    await flush();
    expect(listOnDeck).toHaveBeenCalledTimes(2);
  });

  it('a viewer (canEdit=false) sees the queue read-only: no promote/remove/add controls', async () => {
    (listOnDeck as Mock).mockResolvedValue({ ok: true, data: [makeKeg()] });
    render(
      <OnDeckQueue
        tapId={1} beers={[makeBeer()]} kegs={[]} units="us" canEdit={false}
        onPromote={vi.fn()} refreshKey={0}
      />,
    );
    await screen.findByTestId('on-deck-row');
    expect(screen.queryByTestId('on-deck-row-promote')).not.toBeInTheDocument();
    expect(screen.queryByTestId('on-deck-row-remove')).not.toBeInTheDocument();
    expect(screen.queryByTestId('on-deck-add-toggle')).not.toBeInTheDocument();
  });

  it('clicking Promote on a row calls onPromote with that keg', async () => {
    const keg = makeKeg({ id: 3 });
    (listOnDeck as Mock).mockResolvedValue({ ok: true, data: [keg] });
    const onPromote = vi.fn();
    render(
      <OnDeckQueue
        tapId={1} beers={[makeBeer()]} kegs={[]} units="us" canEdit
        onPromote={onPromote} refreshKey={0}
      />,
    );
    await screen.findByTestId('on-deck-row');
    fireEvent.click(screen.getByTestId('on-deck-row-promote'));
    expect(onPromote).toHaveBeenCalledWith(keg);
  });

  it('removing shows a full consequence sentence, then deletes and reloads on confirm', async () => {
    const keg = makeKeg({ id: 3 });
    (listOnDeck as Mock)
      .mockResolvedValueOnce({ ok: true, data: [keg] })
      .mockResolvedValueOnce({ ok: true, data: [] });
    (removeOnDeckKeg as Mock).mockResolvedValue({ ok: true, data: null });
    render(
      <OnDeckQueue
        tapId={1} beers={[makeBeer({ name: 'Pilsner' })]} kegs={[]} units="us" canEdit
        onPromote={vi.fn()} refreshKey={0}
      />,
    );
    await screen.findByTestId('on-deck-row');
    fireEvent.click(screen.getByTestId('on-deck-row-remove'));
    const confirm = screen.getByTestId('on-deck-remove-confirm');
    expect(confirm).toHaveTextContent('permanently remove');
    expect(confirm).toHaveTextContent('Pilsner');
    expect(confirm).toHaveTextContent("can’t be undone");
    fireEvent.click(screen.getByTestId('on-deck-remove-confirm-button'));
    await flush();
    expect(removeOnDeckKeg).toHaveBeenCalledWith(3);
    expect(screen.queryByTestId('on-deck-remove-confirm')).not.toBeInTheDocument();
    expect(listOnDeck).toHaveBeenCalledTimes(2);
  });

  it('a failed removal shows an inline error and keeps the confirm open', async () => {
    const keg = makeKeg({ id: 3 });
    (listOnDeck as Mock).mockResolvedValue({ ok: true, data: [keg] });
    (removeOnDeckKeg as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Something went wrong' });
    render(
      <OnDeckQueue
        tapId={1} beers={[makeBeer()]} kegs={[]} units="us" canEdit
        onPromote={vi.fn()} refreshKey={0}
      />,
    );
    await screen.findByTestId('on-deck-row');
    fireEvent.click(screen.getByTestId('on-deck-row-remove'));
    fireEvent.click(screen.getByTestId('on-deck-remove-confirm-button'));
    await flush();
    expect(screen.getByTestId('on-deck-remove-error')).toHaveTextContent('Something went wrong');
    expect(screen.getByTestId('on-deck-remove-confirm')).toBeInTheDocument();
  });

  it('adding to the queue picks a beer, defaults from the last keg, and submits with tapId + on_deck status', async () => {
    const beer = makeBeer({ id: 7, name: 'Stout' });
    const priorKeg = makeKeg({ id: 20, beerId: 7, sizeMl: 20000, volStartMl: 20000 });
    (createKeg as Mock).mockResolvedValue({ ok: true, data: makeKeg({ id: 21, beerId: 7 }) });
    render(
      <OnDeckQueue tapId={4} beers={[beer]} kegs={[priorKeg]} units="us" canEdit onPromote={vi.fn()} refreshKey={0} />,
    );
    await flush();
    fireEvent.click(screen.getByTestId('on-deck-add-toggle'));
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    expect(screen.getByTestId('on-deck-add-size')).toHaveValue('20000');
    expect(screen.getByTestId('on-deck-add-volstart')).toHaveValue('20000');
    fireEvent.click(screen.getByTestId('on-deck-add-submit'));
    await flush();
    expect(createKeg).toHaveBeenCalledWith({
      beerId: 7, sizeMl: 20000, volStartMl: 20000, tapId: 4, status: 'on_deck',
    });
    expect(screen.queryByTestId('on-deck-add-form')).not.toBeInTheDocument();
  });

  describe('keg type select (keg-asset fill indicator feature)', () => {
    it("defaults the 'Keg type' select to Auto and omits kegType from the createKeg payload", async () => {
      const beer = makeBeer({ id: 7, name: 'Stout' });
      (createKeg as Mock).mockResolvedValue({ ok: true, data: makeKeg({ id: 21, beerId: 7 }) });
      render(
        <OnDeckQueue tapId={4} beers={[beer]} kegs={[]} units="us" canEdit onPromote={vi.fn()} refreshKey={0} />,
      );
      await flush();
      fireEvent.click(screen.getByTestId('on-deck-add-toggle'));
      fireEvent.click(screen.getByTestId('beer-picker-option'));
      expect(screen.getByTestId('on-deck-add-keg-type')).toHaveValue('auto');

      fireEvent.change(screen.getByTestId('on-deck-add-size'), { target: { value: '19000' } });
      fireEvent.change(screen.getByTestId('on-deck-add-volstart'), { target: { value: '19000' } });
      fireEvent.click(screen.getByTestId('on-deck-add-submit'));
      await flush();

      expect(createKeg).toHaveBeenCalledWith({
        beerId: 7, sizeMl: 19000, volStartMl: 19000, tapId: 4, status: 'on_deck',
      });
    });

    it("an explicit 'Keg type' selection is sent as kegType on the createKeg payload", async () => {
      const beer = makeBeer({ id: 7, name: 'Stout' });
      (createKeg as Mock).mockResolvedValue({ ok: true, data: makeKeg({ id: 21, beerId: 7 }) });
      render(
        <OnDeckQueue tapId={4} beers={[beer]} kegs={[]} units="us" canEdit onPromote={vi.fn()} refreshKey={0} />,
      );
      await flush();
      fireEvent.click(screen.getByTestId('on-deck-add-toggle'));
      fireEvent.click(screen.getByTestId('beer-picker-option'));

      fireEvent.change(screen.getByTestId('on-deck-add-size'), { target: { value: '19000' } });
      fireEvent.change(screen.getByTestId('on-deck-add-volstart'), { target: { value: '19000' } });
      fireEvent.change(screen.getByTestId('on-deck-add-keg-type'), { target: { value: 'sixth-barrel' } });
      fireEvent.click(screen.getByTestId('on-deck-add-submit'));
      await flush();

      expect(createKeg).toHaveBeenCalledWith({
        beerId: 7, sizeMl: 19000, volStartMl: 19000, tapId: 4, status: 'on_deck', kegType: 'sixth-barrel',
      });
    });
  });

  it('a failed add-to-queue shows an inline error and keeps the form open', async () => {
    const beer = makeBeer({ id: 7 });
    (createKeg as Mock).mockResolvedValue({ ok: false, status: 400, message: 'tapId is required' });
    render(
      <OnDeckQueue tapId={4} beers={[beer]} kegs={[]} units="us" canEdit onPromote={vi.fn()} refreshKey={0} />,
    );
    await flush();
    fireEvent.click(screen.getByTestId('on-deck-add-toggle'));
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    fireEvent.change(screen.getByTestId('on-deck-add-size'), { target: { value: '19000' } });
    fireEvent.change(screen.getByTestId('on-deck-add-volstart'), { target: { value: '19000' } });
    fireEvent.click(screen.getByTestId('on-deck-add-submit'));
    await flush();
    expect(screen.getByTestId('on-deck-add-error')).toHaveTextContent('tapId is required');
    expect(screen.getByTestId('on-deck-add-form')).toBeInTheDocument();
  });

  it('canceling the add form closes it without submitting', async () => {
    render(
      <OnDeckQueue tapId={4} beers={[makeBeer()]} kegs={[]} units="us" canEdit onPromote={vi.fn()} refreshKey={0} />,
    );
    await flush();
    fireEvent.click(screen.getByTestId('on-deck-add-toggle'));
    fireEvent.click(screen.getAllByTestId('on-deck-add-cancel')[0]!);
    expect(screen.queryByTestId('on-deck-add-form')).not.toBeInTheDocument();
    expect(createKeg).not.toHaveBeenCalled();
  });
});
