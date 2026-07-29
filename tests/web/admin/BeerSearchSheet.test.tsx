import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import { BeerSearchSheet } from '../../../src/web/routes/admin/BeerSearchSheet';
import { lookupBeers } from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', () => ({
  lookupBeers: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const HIT = {
  name: 'Sculpin IPA', brewery: 'Ballast Point Brewing Company',
  style: 'American-Style India Pale Ale', abv: 7, ibu: 70,
  description: 'A hop-forward IPA.',
};

beforeEach(() => {
  vi.clearAllMocks();
  (lookupBeers as Mock).mockResolvedValue({ ok: true, data: [] });
});

describe('BeerSearchSheet', () => {
  // catalog.beer's free tier is 1,000 requests/month — this sheet must NEVER search on
  // every keystroke (unlike the old debounced UntappdSearchSheet, or BreweryAutocomplete),
  // only on an explicit submit (Enter in the field, which submits the form, or the search
  // button).
  it('never calls lookupBeers just from typing — only on submit (Enter/button)', async () => {
    render(<BeerSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-search-input'), { target: { value: 'Sculpin' } });
    await flush();
    expect(lookupBeers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('beer-search-submit'));
    await flush();
    expect(lookupBeers).toHaveBeenCalledWith('Sculpin');
    expect(lookupBeers).toHaveBeenCalledTimes(1);
  });

  it('also searches on Enter (native form submit), not just the button', async () => {
    render(<BeerSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-search-input'), { target: { value: 'Sculpin' } });
    fireEvent.submit(screen.getByTestId('beer-search-form'));
    await flush();
    expect(lookupBeers).toHaveBeenCalledWith('Sculpin');
  });

  it('does not call lookupBeers for a blank/whitespace-only query', async () => {
    render(<BeerSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-search-input'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByTestId('beer-search-form'));
    await flush();
    expect(lookupBeers).not.toHaveBeenCalled();
  });

  it('shows a loading state while the search is in flight, then the result', async () => {
    let resolveSearch: (v: unknown) => void = () => {};
    (lookupBeers as Mock).mockReturnValue(new Promise((resolve) => { resolveSearch = resolve; }));
    render(<BeerSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-search-input'), { target: { value: 'Sculpin' } });
    fireEvent.submit(screen.getByTestId('beer-search-form'));
    await flush();
    expect(screen.getByTestId('beer-search-sheet-loading')).toBeInTheDocument();

    await act(async () => { resolveSearch({ ok: true, data: [HIT] }); });
    expect(screen.getByTestId('beer-search-sheet-result')).toHaveTextContent('Sculpin IPA');
  });

  it('shows a quiet empty state for no matches', async () => {
    (lookupBeers as Mock).mockResolvedValue({ ok: true, data: [] });
    render(<BeerSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-search-input'), { target: { value: 'Nothingbeer' } });
    fireEvent.submit(screen.getByTestId('beer-search-form'));
    await flush();
    expect(screen.getByTestId('beer-search-sheet-empty')).toBeInTheDocument();
  });

  it('shows a retry-friendly error notice when the search fails, without crashing', async () => {
    (lookupBeers as Mock).mockResolvedValue({ ok: false, status: 502, message: 'upstream down' });
    render(<BeerSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-search-input'), { target: { value: 'Sculpin' } });
    fireEvent.submit(screen.getByTestId('beer-search-form'));
    await flush();
    expect(screen.getByTestId('beer-search-sheet-error')).toBeInTheDocument();
  });

  it('picking a result calls onImported with name/brewery/style/abv/ibu/description — no label field at all', async () => {
    (lookupBeers as Mock).mockResolvedValue({ ok: true, data: [HIT] });
    const onImported = vi.fn();
    render(<BeerSearchSheet onImported={onImported} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-search-input'), { target: { value: 'Sculpin' } });
    fireEvent.submit(screen.getByTestId('beer-search-form'));
    await flush();

    fireEvent.click(screen.getByTestId('beer-search-sheet-result'));

    expect(onImported).toHaveBeenCalledWith({
      name: 'Sculpin IPA',
      brewery: 'Ballast Point Brewing Company',
      style: 'American-Style India Pale Ale',
      abv: 7,
      ibu: 70,
      description: 'A hop-forward IPA.',
    });
    // No <img> anywhere — catalog.beer has no label art, unlike the removed Untappd sheet.
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('closes on Escape and on a backdrop click', () => {
    const onClose = vi.fn();
    render(<BeerSearchSheet onImported={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('beer-search-sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
