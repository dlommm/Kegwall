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

describe('LeaderboardBoard (design 4a + 6b)', () => {
  it('renders ranked rows with pours, volume and the quality column', () => {
    render(<LeaderboardBoard data={makeData()} units="us" title="Halfmoon Brewing" />);
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Sam');
    expect(rows[0]).toHaveTextContent('127 pours');
    expect(rows[0]).toHaveTextContent('12.2 gal');
    expect(screen.getAllByTestId('leaderboard-quality')[0]).toHaveTextContent('Q 94');
    expect(screen.getAllByTestId('leaderboard-quality')[1]).toHaveTextContent('—');
  });

  it('sizes bars relative to the leader', () => {
    const { container } = render(<LeaderboardBoard data={makeData()} units="us" title="T" />);
    const fills = container.querySelectorAll('.board-row__bar-fill');
    expect((fills[0] as HTMLElement).style.width).toBe('100%');
    expect((fills[1] as HTMLElement).style.width).toBe('50%');
  });

  it('renders the footer superlatives', () => {
    render(<LeaderboardBoard data={makeData()} units="us" title="T" />);
    const footer = screen.getByTestId('leaderboard-superlatives');
    expect(footer).toHaveTextContent('MOST POURS: Sam · 127');
    expect(footer).toHaveTextContent('SMOOTHEST POUR: Sam · 94');
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
