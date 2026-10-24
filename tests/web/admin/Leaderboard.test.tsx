import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Leaderboard } from '../../../src/web/routes/admin/Leaderboard';
import type { LeaderboardEntry } from '../../../src/server/db/stats';

function makeData(): LeaderboardEntry[] {
  return [
    {
      drinkerId: 1, displayName: 'Bob', avatarColor: '#00ff00', pourCount: 4, volumeMl: 1200, avgQuality: 92, qualityCount: 4, beers: [],
    },
    {
      drinkerId: 2, displayName: 'Alice', avatarColor: null, pourCount: 2, volumeMl: 600, avgQuality: null, qualityCount: 0, beers: [],
    },
  ];
}

// Leaderboard links to /admin/pours (Phase 5 Task 0) — react-router's <Link> needs a
// Router context, hence the MemoryRouter wrapper below on every render.
describe('Leaderboard', () => {
  it('renders one row per drinker in the given order, with pour count and volume', () => {
    render(<MemoryRouter><Leaderboard data={makeData()} units="metric" window="week" onWindowChange={vi.fn()} /></MemoryRouter>);
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Bob');
    expect(rows[0]).toHaveTextContent('4');
    expect(rows[0]).toHaveTextContent('1200 mL');
  });

  it('shows an empty state explaining what will appear when no pours are claimed', () => {
    render(<MemoryRouter><Leaderboard data={[]} units="metric" window="week" onWindowChange={vi.fn()} /></MemoryRouter>);
    expect(screen.getByTestId('leaderboard-empty')).toHaveTextContent(/will appear|fills in/i);
  });

  it('calls onWindowChange with the clicked window', () => {
    const onWindowChange = vi.fn();
    render(<MemoryRouter><Leaderboard data={makeData()} units="metric" window="week" onWindowChange={onWindowChange} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('leaderboard-window-all'));
    expect(onWindowChange).toHaveBeenCalledWith('all');
  });

  it('marks the active window switcher option as pressed', () => {
    render(<MemoryRouter><Leaderboard data={makeData()} units="metric" window="month" onWindowChange={vi.fn()} /></MemoryRouter>);
    expect(screen.getByTestId('leaderboard-window-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('leaderboard-window-week')).toHaveAttribute('aria-pressed', 'false');
  });

  it('links to the pours admin page for reassign/unclaim', () => {
    render(<MemoryRouter><Leaderboard data={makeData()} units="metric" window="week" onWindowChange={vi.fn()} /></MemoryRouter>);
    expect(screen.getByTestId('leaderboard-manage-pours-link')).toHaveAttribute('href', '/admin/pours');
  });
});
