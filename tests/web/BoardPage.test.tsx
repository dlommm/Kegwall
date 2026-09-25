import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BoardPage } from '../../src/web/routes/BoardPage';
import { getLeaderboard } from '../../src/web/lib/api';

vi.mock('../../src/web/lib/api', () => ({
  getMenu: vi.fn().mockResolvedValue({ ok: true, data: { siteName: 'Taproom', units: 'us' } }),
  getLeaderboard: vi.fn(async (window: string) => ({
    ok: true,
    data: { window, entries: [], superlatives: {} },
  })),
}));

describe('leaderboard window selection', () => {
  it('loads the selected window and marks it active', async () => {
    render(<BoardPage />);
    await screen.findByTestId('board-window-month');
    fireEvent.click(screen.getByRole('button', { name: 'ALL TIME' }));
    await waitFor(() => expect(getLeaderboard).toHaveBeenLastCalledWith('all'));
    await waitFor(() => expect(screen.getByTestId('board-window-all')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'WEEK' }));
    await waitFor(() => expect(getLeaderboard).toHaveBeenLastCalledWith('week'));
  });
});
