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
});
