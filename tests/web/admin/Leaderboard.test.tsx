import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Leaderboard } from '../../../src/web/routes/admin/Leaderboard';
import type { LeaderboardEntry } from '../../../src/server/db/stats';

function makeData(): LeaderboardEntry[] {
  return [
    { drinkerId: 1, displayName: 'Bob', avatarColor: '#00ff00', pourCount: 4, volumeMl: 1200 },
    { drinkerId: 2, displayName: 'Alice', avatarColor: null, pourCount: 2, volumeMl: 600 },
  ];
}

describe('Leaderboard', () => {
  it('renders one row per drinker in the given order, with pour count and volume', () => {
    render(<Leaderboard data={makeData()} units="metric" window="week" onWindowChange={vi.fn()} />);
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Bob');
    expect(rows[0]).toHaveTextContent('4');
    expect(rows[0]).toHaveTextContent('1200 mL');
  });

  it('shows an empty state explaining what will appear when no pours are claimed', () => {
    render(<Leaderboard data={[]} units="metric" window="week" onWindowChange={vi.fn()} />);
    expect(screen.getByTestId('leaderboard-empty')).toHaveTextContent(/will appear|fills in/i);
  });

  it('calls onWindowChange with the clicked window', () => {
    const onWindowChange = vi.fn();
    render(<Leaderboard data={makeData()} units="metric" window="week" onWindowChange={onWindowChange} />);
    fireEvent.click(screen.getByTestId('leaderboard-window-all'));
    expect(onWindowChange).toHaveBeenCalledWith('all');
  });

  it('marks the active window switcher option as pressed', () => {
    render(<Leaderboard data={makeData()} units="metric" window="month" onWindowChange={vi.fn()} />);
    expect(screen.getByTestId('leaderboard-window-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('leaderboard-window-week')).toHaveAttribute('aria-pressed', 'false');
  });
});
