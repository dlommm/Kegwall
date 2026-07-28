import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import { UntappdSearchSheet } from '../../../src/web/routes/admin/UntappdSearchSheet';
import { lookupUntappd, importUntappdLabel } from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', () => ({
  lookupUntappd: vi.fn(),
  importUntappdLabel: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const HIT = {
  name: 'Citra IPA', brewery: 'Test Brewery', style: 'IPA - American', abv: 6.5, ibu: 60,
  labelUrl: 'https://untappd.example/label.png',
};

beforeEach(() => {
  vi.clearAllMocks();
  (lookupUntappd as Mock).mockResolvedValue({ ok: true, data: [] });
  (importUntappdLabel as Mock).mockResolvedValue({ ok: true, data: { path: '/labels/abc.png' } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UntappdSearchSheet', () => {
  it('never renders a remote <img> for a result — no hotlinking Untappd\'s CDN', async () => {
    vi.useFakeTimers();
    (lookupUntappd as Mock).mockResolvedValue({ ok: true, data: [HIT] });
    render(<UntappdSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('untappd-search-input'), { target: { value: 'Citra' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();
    expect(screen.getByTestId('untappd-sheet-result')).toHaveTextContent('Citra IPA');
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('debounces the search by 300ms', async () => {
    vi.useFakeTimers();
    render(<UntappdSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('untappd-search-input'), { target: { value: 'Citra' } });
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(lookupUntappd).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(lookupUntappd).toHaveBeenCalledWith('Citra');
  });

  it('shows a quiet empty state for no matches', async () => {
    vi.useFakeTimers();
    (lookupUntappd as Mock).mockResolvedValue({ ok: true, data: [] });
    render(<UntappdSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('untappd-search-input'), { target: { value: 'Nothingbeer' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();
    expect(screen.getByTestId('untappd-sheet-empty')).toBeInTheDocument();
  });

  it('shows a retry-friendly error notice when the search fails, without crashing', async () => {
    vi.useFakeTimers();
    (lookupUntappd as Mock).mockResolvedValue({ ok: false, status: 502, message: 'upstream down' });
    render(<UntappdSearchSheet onImported={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('untappd-search-input'), { target: { value: 'Citra' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();
    expect(screen.getByTestId('untappd-sheet-error')).toHaveTextContent(
      "Couldn’t reach Untappd. Try again, or fill in the beer by hand.",
    );
  });

  it('picking a result with a labelUrl downloads it server-side, then calls onImported with the local path', async () => {
    vi.useFakeTimers();
    (lookupUntappd as Mock).mockResolvedValue({ ok: true, data: [HIT] });
    const onImported = vi.fn();
    render(<UntappdSearchSheet onImported={onImported} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('untappd-search-input'), { target: { value: 'Citra' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();

    fireEvent.click(screen.getByTestId('untappd-sheet-result'));
    await flush();

    expect(importUntappdLabel).toHaveBeenCalledWith(HIT.labelUrl);
    expect(onImported).toHaveBeenCalledWith({
      name: 'Citra IPA', brewery: 'Test Brewery', style: 'IPA - American', abv: 6.5, ibu: 60,
      labelImage: '/labels/abc.png',
    });
  });

  it('picking a result with no labelUrl calls onImported directly with a null labelImage', async () => {
    vi.useFakeTimers();
    const noLabel = { ...HIT, labelUrl: null };
    (lookupUntappd as Mock).mockResolvedValue({ ok: true, data: [noLabel] });
    const onImported = vi.fn();
    render(<UntappdSearchSheet onImported={onImported} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('untappd-search-input'), { target: { value: 'Citra' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();

    fireEvent.click(screen.getByTestId('untappd-sheet-result'));
    await flush();

    expect(importUntappdLabel).not.toHaveBeenCalled();
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ labelImage: null }));
  });

  it('shows an inline error and does not call onImported when the label download fails', async () => {
    vi.useFakeTimers();
    (lookupUntappd as Mock).mockResolvedValue({ ok: true, data: [HIT] });
    (importUntappdLabel as Mock).mockResolvedValue({ ok: false, status: 502, message: 'boom' });
    const onImported = vi.fn();
    render(<UntappdSearchSheet onImported={onImported} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('untappd-search-input'), { target: { value: 'Citra' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();

    fireEvent.click(screen.getByTestId('untappd-sheet-result'));
    await flush();

    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByTestId('untappd-sheet-import-error')).toBeInTheDocument();
  });

  it('closes on Escape and on a backdrop click', async () => {
    const onClose = vi.fn();
    render(<UntappdSearchSheet onImported={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('untappd-sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
