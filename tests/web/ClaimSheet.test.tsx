import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ClaimSheet } from '../../src/web/components/ClaimSheet';
import {
  getRecentPours, getDrinkers, claimPour,
} from '../../src/web/lib/api';
import type { RecentPour, PublicDrinker } from '../../src/web/lib/api';

vi.mock('../../src/web/lib/api', () => ({
  getRecentPours: vi.fn(),
  getDrinkers: vi.fn(),
  claimPour: vi.fn(),
}));

function pour(overrides: Partial<RecentPour> = {}): RecentPour {
  return {
    id: 1,
    ts: '2026-07-28T11:58:00.000Z',
    volumeMl: 450,
    tapNumber: 1,
    beerName: 'Citra IPA',
    ...overrides,
  };
}

function drinker(overrides: Partial<PublicDrinker> = {}): PublicDrinker {
  return {
    id: 1, displayName: 'Sam Lee', avatarColor: '#f2c14e', ...overrides,
  };
}

async function openPicker() {
  fireEvent.click(await screen.findByTestId('claim-sheet-pour'));
  return screen.findAllByTestId('claim-sheet-drinker');
}

describe('ClaimSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getRecentPours as Mock).mockResolvedValue({ ok: true, data: [pour()] });
    (getDrinkers as Mock).mockResolvedValue({
      ok: true,
      data: [drinker(), drinker({ id: 2, displayName: 'Alex', avatarColor: null })],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists recent unclaimed pours', async () => {
    render(<ClaimSheet />);
    expect(await screen.findByText('Citra IPA')).toBeInTheDocument();
  });

  it('shows a quiet empty state when there is nothing to claim', async () => {
    (getRecentPours as Mock).mockResolvedValue({ ok: true, data: [] });
    render(<ClaimSheet />);
    expect(await screen.findByTestId('claim-sheet-empty')).toBeInTheDocument();
  });

  it('opens a drinker picker sheet when a pour is tapped', async () => {
    render(<ClaimSheet />);
    await openPicker();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders drinker avatars with initials, the drinker\'s avatarColor, and a fallback color when absent', async () => {
    render(<ClaimSheet />);
    const buttons = await openPicker();
    expect(buttons).toHaveLength(2);

    const samInitials = screen.getByText('SL');
    expect(samInitials).toHaveStyle({ backgroundColor: '#f2c14e' });

    const alexInitials = screen.getByText('A');
    const alexBg = getComputedStyle(alexInitials).backgroundColor;
    expect(alexBg).not.toBe('');
    expect(alexBg).not.toBe('#f2c14e');
  });

  it('claims a pour for the tapped drinker and shows a success state (happy path)', async () => {
    (claimPour as Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 1, kegId: 1, ts: '2026-07-28T12:00:00.000Z', volumeMl: 450, durationMs: null, source: 'cloud', drinkerId: 1,
      },
    });
    render(<ClaimSheet />);
    const buttons = await openPicker();
    fireEvent.click(buttons[0]!);

    expect(await screen.findByTestId('claim-sheet-success')).toHaveTextContent('Sam Lee');
    expect(claimPour).toHaveBeenCalledWith(1, 1);
  });

  it('shows an "already claimed" notice on a 409 conflict', async () => {
    (claimPour as Mock).mockResolvedValue({ ok: false, status: 409, message: 'Pour already claimed' });
    render(<ClaimSheet />);
    const buttons = await openPicker();
    fireEvent.click(buttons[0]!);

    expect(await screen.findByTestId('claim-sheet-conflict')).toHaveTextContent(/already claimed/i);
  });

  it('shows a gentle slow-down notice on a 429', async () => {
    (claimPour as Mock).mockResolvedValue({ ok: false, status: 429, message: 'Rate limited' });
    render(<ClaimSheet />);
    const buttons = await openPicker();
    fireEvent.click(buttons[0]!);

    expect(await screen.findByTestId('claim-sheet-rate-limited')).toHaveTextContent(/slow down/i);
  });

  it('shows a plain retry message for any other error', async () => {
    (claimPour as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Boom' });
    render(<ClaimSheet />);
    const buttons = await openPicker();
    fireEvent.click(buttons[0]!);

    expect(await screen.findByTestId('claim-sheet-error')).toHaveTextContent(/try again/i);
  });

  it('dismisses the sheet on Escape', async () => {
    render(<ClaimSheet />);
    await openPicker();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dismisses the sheet on backdrop click', async () => {
    render(<ClaimSheet />);
    await openPicker();

    fireEvent.click(screen.getByTestId('claim-sheet-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not dismiss when clicking inside the sheet itself', async () => {
    render(<ClaimSheet />);
    await openPicker();

    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('refreshes the unclaimed-pours list every 30s and clears the interval on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<ClaimSheet />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getRecentPours).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getRecentPours).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getRecentPours).toHaveBeenCalledTimes(3);

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('re-entrancy / stale-response guard', () => {
    it('a rapid double-tap only fires claimPour once, so a stale second response cannot clobber the success state', async () => {
      // If a second call went out, its (later) response would be this 409 — proving the
      // guard by showing that response never gets consumed/applied.
      (claimPour as Mock)
        .mockResolvedValueOnce({
          ok: true,
          data: {
            id: 1, kegId: 1, ts: '2026-07-28T12:00:00.000Z', volumeMl: 450, durationMs: null, source: 'cloud', drinkerId: 1,
          },
        })
        .mockResolvedValueOnce({ ok: false, status: 409, message: 'Pour already claimed' });

      render(<ClaimSheet />);
      const buttons = await openPicker();
      const samButton = buttons[0]!;

      // Two clicks dispatched back-to-back in the same act(), before React's
      // disabled={status === 'claiming'} re-render can reach the real DOM — the exact
      // window the synchronous claimInFlightRef guard closes.
      await act(async () => {
        fireEvent.click(samButton);
        fireEvent.click(samButton);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(claimPour).toHaveBeenCalledTimes(1);
      expect(await screen.findByTestId('claim-sheet-success')).toBeInTheDocument();
      expect(screen.queryByTestId('claim-sheet-conflict')).not.toBeInTheDocument();
    });

    it('ignores a stale claim response once the selection has moved on to a different pour', async () => {
      (getRecentPours as Mock).mockResolvedValue({
        ok: true,
        data: [
          pour({ id: 1, beerName: 'Citra IPA', tapNumber: 1 }),
          pour({ id: 2, beerName: 'Pilsner', tapNumber: 2 }),
        ],
      });
      let resolveClaimA: (value: unknown) => void = () => {};
      (claimPour as Mock).mockReturnValueOnce(new Promise((resolve) => { resolveClaimA = resolve; }));

      render(<ClaimSheet />);
      const pourButtons = await screen.findAllByTestId('claim-sheet-pour');

      fireEvent.click(pourButtons[0]!); // open pour A (Citra IPA)
      const drinkerButtonsA = await screen.findAllByTestId('claim-sheet-drinker');
      fireEvent.click(drinkerButtonsA[0]!); // claim in flight for pour A, unresolved

      fireEvent.keyDown(document, { key: 'Escape' }); // close before it resolves
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.click((await screen.findAllByTestId('claim-sheet-pour'))[1]!); // open pour B
      expect(screen.getByRole('dialog')).toHaveTextContent('Pilsner');

      // Pour A's stale response finally lands after the selection moved on.
      await act(async () => {
        resolveClaimA({ ok: false, status: 409, message: 'Pour already claimed' });
        await Promise.resolve();
        await Promise.resolve();
      });

      // Must still show pour B's own (idle) sheet, not pour A's stale conflict notice.
      expect(screen.getByRole('dialog')).toHaveTextContent('Pilsner');
      expect(screen.queryByTestId('claim-sheet-conflict')).not.toBeInTheDocument();
    });
  });
});
