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
  it('ranks every pourer on the tally board, the leader first and larger (Kegwall 2.1)', () => {
    const data = makeData({
      entries: [
        { drinkerId: 1, displayName: 'Sam', avatarColor: '#D08C4C', pourCount: 127, volumeMl: 46000, avgQuality: 94, qualityCount: 90, beers: [{ beerId: 1, srm: 4, pours: 80 }] },
        { drinkerId: 2, displayName: 'JT', avatarColor: '#5FD9BC', pourCount: 94, volumeMl: 23000, avgQuality: 88, qualityCount: 40 },
        { drinkerId: 3, displayName: 'Kim', avatarColor: null, pourCount: 60, volumeMl: 15000, avgQuality: null, qualityCount: 0 },
        { drinkerId: 4, displayName: 'Lee', avatarColor: null, pourCount: 30, volumeMl: 7000, avgQuality: 72, qualityCount: 10 },
      ],
    });
    render(<LeaderboardBoard data={data} units="us" title="Halfmoon Brewing" />);
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute('data-rank', '1');
    expect(rows[0]).toHaveTextContent('Sam');
    expect(rows[0]).toHaveTextContent('12.2 gal');
    expect(rows[3]).toHaveTextContent('Lee');
    expect(screen.getByText('Sam leads by 33 pours')).toBeInTheDocument();
    expect(screen.getAllByTestId('tally')).toHaveLength(4);
  });

  it('marks the active window pill', () => {
    render(<LeaderboardBoard data={makeData({ window: 'month' })} units="us" title="T" />);
    expect(screen.getByTestId('board-window-month')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('board-window-week')).toHaveAttribute('data-active', 'false');
  });

  it('writes the superlatives as sentences, with no emoji', () => {
    render(<LeaderboardBoard data={makeData()} units="us" title="T" />);
    const footer = screen.getByTestId('leaderboard-superlatives');
    expect(footer).toHaveTextContent('Sam poured the most often: 127 pours.');
    expect(footer).toHaveTextContent('a pour score of 94');
    expect(footer).toHaveTextContent("The biggest pour was JT's, 30.0 oz.");
    expect(footer.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('shows a game-winner trophy chip when a game posted to the board (redesign 5d)', () => {
    const data = makeData({
      superlatives: {
        mostPours: null, smoothest: null, biggestPour: null,
        gameWinner: { gameName: 'Keg Race', displayName: 'Sam', endedAt: '2026-08-01T00:00:00Z' },
      },
    });
    render(<LeaderboardBoard data={data} units="us" title="T" />);
    expect(screen.getByTestId('board-game-winner')).toHaveTextContent('Keg Race went to Sam.');
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
