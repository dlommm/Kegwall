import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeaderboardBoard, formatBoardVolume } from '../../src/web/components/LeaderboardBoard';
import type { LeaderboardResponse } from '../../src/web/lib/api';

function makeData(overrides: Partial<LeaderboardResponse> = {}): LeaderboardResponse {
  return {
    window: 'month',
    entries: [
      {
        drinkerId: 1, displayName: 'Sam', avatarColor: '#D08C4C', pourCount: 127, volumeMl: 46000, avgQuality: 94, qualityCount: 90,
      },
      {
        drinkerId: 2, displayName: 'JT', avatarColor: '#5FD9BC', pourCount: 94, volumeMl: 23000, avgQuality: null, qualityCount: 0,
      },
    ],
    superlatives: {
      mostPours: { displayName: 'Sam', pourCount: 127 },
      smoothest: { displayName: 'Sam', avgQuality: 94 },
      biggestPour: { drinkerId: 2, displayName: 'JT', volumeMl: 887, ts: 'x' },
    },
    ...overrides,
  };
}

describe('formatBoardVolume', () => {
  it('renders gallons for US, liters for metric', () => {
    expect(formatBoardVolume(3785.41, 'us')).toBe('1.0 gal');
    expect(formatBoardVolume(46000, 'metric')).toBe('46.0 L');
  });
});

describe('LeaderboardBoard (redesign 2f — podium)', () => {
  it('puts the top 3 on a medal podium (champion centered) and ranks 4+ in compact rows', () => {
    const data = makeData({
      entries: [
        { drinkerId: 1, displayName: 'Sam', avatarColor: '#D08C4C', pourCount: 127, volumeMl: 46000, avgQuality: 94, qualityCount: 90 },
        { drinkerId: 2, displayName: 'JT', avatarColor: '#5FD9BC', pourCount: 94, volumeMl: 23000, avgQuality: 88, qualityCount: 40 },
        { drinkerId: 3, displayName: 'Kim', avatarColor: null, pourCount: 60, volumeMl: 15000, avgQuality: null, qualityCount: 0 },
        { drinkerId: 4, displayName: 'Lee', avatarColor: null, pourCount: 30, volumeMl: 7000, avgQuality: 72, qualityCount: 10 },
      ],
    });
    render(<LeaderboardBoard data={data} units="us" title="Halfmoon Brewing" />);
    const cards = screen.getAllByTestId('leaderboard-podium-card');
    expect(cards).toHaveLength(3);
    // Visual order: 2nd, 1st (champion), 3rd.
    expect(cards[0]).toHaveAttribute('data-rank', '2');
    expect(cards[1]).toHaveAttribute('data-rank', '1');
    expect(cards[1]).toHaveTextContent('CHAMPION');
    expect(cards[1]).toHaveTextContent('Sam');
    expect(cards[1]).toHaveTextContent('12.2 gal');
    // Rank 4 is a compact row, numbered 4.
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Lee');
    expect(rows[0]).toHaveTextContent('4');
  });

  it('marks the active window pill', () => {
    render(<LeaderboardBoard data={makeData({ window: 'month' })} units="us" title="T" />);
    expect(screen.getByTestId('board-window-month')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('board-window-week')).toHaveAttribute('data-active', 'false');
  });

  it('renders the footer superlatives as trophy chips', () => {
    render(<LeaderboardBoard data={makeData()} units="us" title="T" />);
    const footer = screen.getByTestId('leaderboard-superlatives');
    expect(footer).toHaveTextContent('MOST POURS: Sam · 127');
    expect(footer).toHaveTextContent('SMOOTHEST: Sam · 94');
    expect(footer).toHaveTextContent('BIGGEST POUR: JT · 30.0 oz');
  });

  it('shows a friendly empty state', () => {
    render(
      <LeaderboardBoard
        data={makeData({ entries: [], superlatives: { mostPours: null, smoothest: null, biggestPour: null } })}
        units="us"
        title="T"
      />,
    );
    expect(screen.getByTestId('leaderboard-empty')).toBeInTheDocument();
  });
});
