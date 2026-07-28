import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SwapWizard } from '../../../src/web/routes/admin/SwapWizard';
import { swapTap, resetKegtronVolume, importKegtronBeer } from '../../../src/web/lib/adminApi';
import type { TapState } from '../../../src/server/core/state';
import type { Beer } from '../../../src/server/db/beers';
import type { Keg } from '../../../src/server/db/kegs';
import type { Monitor } from '../../../src/server/db/monitors';

vi.mock('../../../src/web/lib/adminApi', () => ({
  swapTap: vi.fn(),
  resetKegtronVolume: vi.fn(),
  importKegtronBeer: vi.fn(),
  createBeer: vi.fn(),
  updateBeer: vi.fn(),
  uploadLabel: vi.fn(),
  lookupUntappd: vi.fn().mockResolvedValue({ ok: false, status: 501, message: 'not configured' }),
  lookupBreweries: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  importUntappdLabel: vi.fn(),
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
    dateTapped: null, status: 'on_tap', createdAt: '2026-07-28T00:00:00.000Z', ...overrides,
  };
}

function makeTap(overrides: Partial<TapState> = {}): TapState {
  return {
    tapId: 1, tapNumber: 1, tapName: null, beer: null, keg: null, lastPour: null,
    pouring: false, curServMl: null, monitorOnline: true, temp: null, ...overrides,
  };
}

function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 9, type: 'kegtron_pro', identifier: 'device1', serial: 'SN1', portIndex: 0,
    tapId: 1, lastSeen: null, meta: {}, ...overrides,
  };
}

const activeTap = makeTap({
  beer: makeBeer(),
  keg: {
    ...makeKeg(),
    levelPct: 40, remainingMl: 7600,
  } as any,
});

const emptyTap = makeTap();

describe('SwapWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirm gates the beer-pick step: pick UI is not shown until the kick is confirmed', () => {
    render(
      <SwapWizard tap={activeTap} beers={[]} kegs={[]} monitors={[]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    expect(screen.getByTestId('swap-wizard-step-confirm')).toBeInTheDocument();
    expect(screen.queryByTestId('swap-wizard-step-pick')).not.toBeInTheDocument();
    expect(screen.getByTestId('swap-wizard-kick-button')).toHaveTextContent('Kick keg');

    fireEvent.click(screen.getByTestId('swap-wizard-kick-button'));
    expect(screen.getByTestId('swap-wizard-step-pick')).toBeInTheDocument();
    expect(screen.queryByTestId('swap-wizard-step-confirm')).not.toBeInTheDocument();
  });

  it('an empty tap (nothing to kick) skips straight to picking a beer', () => {
    render(
      <SwapWizard tap={emptyTap} beers={[]} kegs={[]} monitors={[]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    expect(screen.getByTestId('swap-wizard-step-pick')).toBeInTheDocument();
    expect(screen.queryByTestId('swap-wizard-step-confirm')).not.toBeInTheDocument();
  });

  it('runs the full step flow for a tap with an active keg and no bound monitor: confirm -> pick -> size -> submit', async () => {
    (swapTap as Mock).mockResolvedValue({ ok: true, data: makeKeg({ id: 2, status: 'on_tap' }) });
    const onDone = vi.fn();
    const onClose = vi.fn();
    const beer = makeBeer({ id: 5, name: 'Pilsner' });
    render(
      <SwapWizard tap={activeTap} beers={[beer]} kegs={[]} monitors={[]} onClose={onClose} onDone={onDone} />,
    );

    fireEvent.click(screen.getByTestId('swap-wizard-kick-button'));
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    expect(screen.getByTestId('swap-wizard-step-size')).toBeInTheDocument();
    expect(screen.getByTestId('swap-wizard-size')).toHaveValue('');
    expect(screen.getByTestId('swap-wizard-volstart')).toHaveValue('');

    fireEvent.change(screen.getByTestId('swap-wizard-size'), { target: { value: '19000' } });
    fireEvent.change(screen.getByTestId('swap-wizard-volstart'), { target: { value: '19000' } });
    fireEvent.click(screen.getByTestId('swap-wizard-submit'));
    await flush();

    expect(swapTap).toHaveBeenCalledWith(1, { beerId: 5, sizeMl: 19000, volStartMl: 19000 });
    expect(onDone).toHaveBeenCalled();
    // no bound monitor -> no reset step -> the wizard closes itself
    expect(onClose).toHaveBeenCalled();
  });

  it('defaults size/volume from the picked beer’s most recent keg', () => {
    const beer = makeBeer({ id: 5, name: 'Pilsner' });
    const priorKeg = makeKeg({ id: 8, beerId: 5, sizeMl: 20000, volStartMl: 18000 });
    render(
      <SwapWizard tap={emptyTap} beers={[beer]} kegs={[priorKeg]} monitors={[]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    expect(screen.getByTestId('swap-wizard-size')).toHaveValue('20000');
    expect(screen.getByTestId('swap-wizard-volstart')).toHaveValue('18000');
  });

  it('rejects a starting volume greater than the size, without calling swapTap', async () => {
    const beer = makeBeer({ id: 5 });
    render(
      <SwapWizard tap={emptyTap} beers={[beer]} kegs={[]} monitors={[]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    fireEvent.change(screen.getByTestId('swap-wizard-size'), { target: { value: '19000' } });
    fireEvent.change(screen.getByTestId('swap-wizard-volstart'), { target: { value: '20000' } });
    fireEvent.click(screen.getByTestId('swap-wizard-submit'));
    await flush();
    expect(screen.getByTestId('swap-wizard-size-error')).toHaveTextContent("can't be more than the keg's size");
    expect(swapTap).not.toHaveBeenCalled();
  });

  it('surfaces a swap failure inline and stays on the size step', async () => {
    (swapTap as Mock).mockResolvedValue({ ok: false, status: 409, message: 'tap 1 already has an active keg' });
    const onDone = vi.fn();
    const beer = makeBeer({ id: 5 });
    render(
      <SwapWizard tap={emptyTap} beers={[beer]} kegs={[]} monitors={[]} onClose={vi.fn()} onDone={onDone} />,
    );
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    fireEvent.change(screen.getByTestId('swap-wizard-size'), { target: { value: '19000' } });
    fireEvent.change(screen.getByTestId('swap-wizard-volstart'), { target: { value: '19000' } });
    fireEvent.click(screen.getByTestId('swap-wizard-submit'));
    await flush();
    expect(screen.getByTestId('swap-wizard-swap-error')).toHaveTextContent('tap 1 already has an active keg');
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('swap-wizard-step-size')).toBeInTheDocument();
  });

  it('Back returns from size to pick, and from pick to confirm', () => {
    const beer = makeBeer({ id: 5 });
    render(
      <SwapWizard tap={activeTap} beers={[beer]} kegs={[]} monitors={[]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('swap-wizard-kick-button'));
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    expect(screen.getByTestId('swap-wizard-step-size')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('swap-wizard-back'));
    expect(screen.getByTestId('swap-wizard-step-pick')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('swap-wizard-back'));
    expect(screen.getByTestId('swap-wizard-step-confirm')).toBeInTheDocument();
  });

  it('Cancel at any pre-swap step closes without calling swapTap', () => {
    const onClose = vi.fn();
    render(
      <SwapWizard tap={activeTap} beers={[]} kegs={[]} monitors={[]} onClose={onClose} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('swap-wizard-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(swapTap).not.toHaveBeenCalled();
  });

  it('Escape closes the wizard', () => {
    const onClose = vi.fn();
    render(
      <SwapWizard tap={activeTap} beers={[]} kegs={[]} monitors={[]} onClose={onClose} onDone={vi.fn()} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop closes the wizard, but clicking inside it does not', () => {
    const onClose = vi.fn();
    render(
      <SwapWizard tap={activeTap} beers={[]} kegs={[]} monitors={[]} onClose={onClose} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('swap-wizard'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('swap-wizard-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('the "Import from Kegtron" beer-pick option only appears when a Pro monitor is bound to this tap', () => {
    const monitor = makeMonitor({ id: 9, tapId: 1, type: 'kegtron_pro' });
    const { rerender } = render(
      <SwapWizard tap={emptyTap} beers={[]} kegs={[]} monitors={[]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    expect(screen.queryByTestId('beer-picker-import-button')).not.toBeInTheDocument();
    rerender(
      <SwapWizard tap={emptyTap} beers={[]} kegs={[]} monitors={[monitor]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    expect(screen.getByTestId('beer-picker-import-button')).toBeInTheDocument();
  });

  it('picking a beer via Kegtron import (mocked) advances straight to the size step', async () => {
    const monitor = makeMonitor({ id: 9, tapId: 1 });
    const imported = makeBeer({ id: 11, name: 'King Cobra' });
    (importKegtronBeer as Mock).mockResolvedValue({ ok: true, data: imported });
    render(
      <SwapWizard tap={emptyTap} beers={[]} kegs={[]} monitors={[monitor]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('beer-picker-import-button'));
    await flush();
    expect(importKegtronBeer).toHaveBeenCalledWith(9);
    expect(screen.getByTestId('swap-wizard-step-size')).toBeInTheDocument();
    expect(screen.getByText('King Cobra')).toBeInTheDocument();
  });

  it('after a successful swap on a Pro-bound tap, shows the optional reset-volume step', async () => {
    const monitor = makeMonitor({ id: 9, tapId: 1 });
    (swapTap as Mock).mockResolvedValue({ ok: true, data: makeKeg({ id: 2 }) });
    const onClose = vi.fn();
    const beer = makeBeer({ id: 5 });
    render(
      <SwapWizard tap={emptyTap} beers={[beer]} kegs={[]} monitors={[monitor]} onClose={onClose} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    fireEvent.change(screen.getByTestId('swap-wizard-size'), { target: { value: '19000' } });
    fireEvent.change(screen.getByTestId('swap-wizard-volstart'), { target: { value: '19000' } });
    fireEvent.click(screen.getByTestId('swap-wizard-submit'));
    await flush();
    expect(screen.getByTestId('swap-wizard-step-reset')).toBeInTheDocument();
    // the wizard stays open for the optional reset even though the swap already succeeded
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reset-volume success shows confirmation; Finish closes the wizard', async () => {
    const monitor = makeMonitor({ id: 9, tapId: 1 });
    (swapTap as Mock).mockResolvedValue({ ok: true, data: makeKeg({ id: 2 }) });
    (resetKegtronVolume as Mock).mockResolvedValue({ ok: true, data: { ok: true } });
    const onClose = vi.fn();
    const beer = makeBeer({ id: 5 });
    render(
      <SwapWizard tap={emptyTap} beers={[beer]} kegs={[]} monitors={[monitor]} onClose={onClose} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    fireEvent.change(screen.getByTestId('swap-wizard-size'), { target: { value: '19000' } });
    fireEvent.change(screen.getByTestId('swap-wizard-volstart'), { target: { value: '19000' } });
    fireEvent.click(screen.getByTestId('swap-wizard-submit'));
    await flush();
    fireEvent.click(screen.getByTestId('swap-wizard-reset-button'));
    await flush();
    expect(resetKegtronVolume).toHaveBeenCalledWith(9);
    expect(screen.getByTestId('swap-wizard-reset-done')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('swap-wizard-finish'));
    expect(onClose).toHaveBeenCalled();
  });

  it('a 502 on reset-volume is surfaced gently and still allows finishing', async () => {
    const monitor = makeMonitor({ id: 9, tapId: 1 });
    (swapTap as Mock).mockResolvedValue({ ok: true, data: makeKeg({ id: 2 }) });
    (resetKegtronVolume as Mock).mockResolvedValue({
      ok: false, status: 502, message: 'Failed to reset volume via mdash.net (status 503)',
    });
    const beer = makeBeer({ id: 5 });
    render(
      <SwapWizard tap={emptyTap} beers={[beer]} kegs={[]} monitors={[monitor]} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('beer-picker-option'));
    fireEvent.change(screen.getByTestId('swap-wizard-size'), { target: { value: '19000' } });
    fireEvent.change(screen.getByTestId('swap-wizard-volstart'), { target: { value: '19000' } });
    fireEvent.click(screen.getByTestId('swap-wizard-submit'));
    await flush();
    fireEvent.click(screen.getByTestId('swap-wizard-reset-button'));
    await flush();
    expect(screen.getByTestId('swap-wizard-reset-error')).toHaveTextContent("Couldn't reach the Kegtron device");
    expect(screen.getByTestId('swap-wizard-finish')).toBeInTheDocument();
  });

  describe('promote path (fromKegId)', () => {
    const queuedKeg = makeKeg({ id: 42, beerId: 5, status: 'on_deck' });
    const queuedBeer = makeBeer({ id: 5, name: 'Queued Pils' });

    it('an active tap shows a kick-consequence confirm naming BOTH the outgoing and incoming '
      + 'beers, and swaps with fromKegId on confirm', async () => {
      (swapTap as Mock).mockResolvedValue({ ok: true, data: { ...queuedKeg, status: 'on_tap' } });
      const onDone = vi.fn();
      const onClose = vi.fn();
      render(
        <SwapWizard
          tap={activeTap} beers={[queuedBeer]} kegs={[]} monitors={[]}
          promoteKeg={queuedKeg} onClose={onClose} onDone={onDone}
        />,
      );
      const confirm = screen.getByTestId('swap-wizard-step-confirm');
      expect(confirm).toHaveTextContent('kick');
      // must name the outgoing (current) beer AND the incoming (queued) beer — an
      // operator confirming a promote needs to see both to notice a wrong pick.
      expect(confirm).toHaveTextContent('Citra IPA');
      expect(confirm).toHaveTextContent('Queued Pils');
      expect(screen.getByTestId('swap-wizard-kick-button')).toHaveTextContent('Kick keg');
      // no beer/size steps at all for a promote
      expect(screen.queryByTestId('beer-picker')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('swap-wizard-kick-button'));
      await flush();
      expect(swapTap).toHaveBeenCalledWith(1, { fromKegId: 42 });
      expect(onDone).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('an empty tap shows a plain confirm naming the queued beer, still calling fromKegId', async () => {
      (swapTap as Mock).mockResolvedValue({ ok: true, data: { ...queuedKeg, status: 'on_tap' } });
      render(
        <SwapWizard
          tap={emptyTap} beers={[queuedBeer]} kegs={[]} monitors={[]}
          promoteKeg={queuedKeg} onClose={vi.fn()} onDone={vi.fn()}
        />,
      );
      expect(screen.getByTestId('swap-wizard-step-confirm')).toHaveTextContent('Queued Pils');
      expect(screen.getByTestId('swap-wizard-kick-button')).toHaveTextContent('Tap this keg');
      fireEvent.click(screen.getByTestId('swap-wizard-kick-button'));
      await flush();
      expect(swapTap).toHaveBeenCalledWith(1, { fromKegId: 42 });
    });

    it('a promote failure is surfaced inline and does not call onDone', async () => {
      (swapTap as Mock).mockResolvedValue({ ok: false, status: 404, message: 'on-deck keg 42 for tap 1 not found' });
      const onDone = vi.fn();
      render(
        <SwapWizard
          tap={activeTap} beers={[queuedBeer]} kegs={[]} monitors={[]}
          promoteKeg={queuedKeg} onClose={vi.fn()} onDone={onDone}
        />,
      );
      fireEvent.click(screen.getByTestId('swap-wizard-kick-button'));
      await flush();
      expect(screen.getByTestId('swap-wizard-swap-error')).toHaveTextContent('on-deck keg 42 for tap 1 not found');
      expect(onDone).not.toHaveBeenCalled();
      expect(screen.getByTestId('swap-wizard-step-confirm')).toBeInTheDocument();
    });

    it('a promote on a Pro-bound tap still offers the reset-volume step after success', async () => {
      const monitor = makeMonitor({ id: 9, tapId: 1 });
      (swapTap as Mock).mockResolvedValue({ ok: true, data: { ...queuedKeg, status: 'on_tap' } });
      render(
        <SwapWizard
          tap={activeTap} beers={[queuedBeer]} kegs={[]} monitors={[monitor]}
          promoteKeg={queuedKeg} onClose={vi.fn()} onDone={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('swap-wizard-kick-button'));
      await flush();
      expect(screen.getByTestId('swap-wizard-step-reset')).toBeInTheDocument();
    });
  });
});
