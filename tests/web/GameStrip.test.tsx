import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { GameStrip } from '../../src/web/components/GameStrip';
import { getGameStrip } from '../../src/web/lib/api';
import type { GameStrip as GameStripData } from '../../src/web/lib/adminApi';

vi.mock('../../src/web/lib/api', () => ({ getGameStrip: vi.fn() }));

function strip(over: Partial<GameStripData> = {}): GameStripData {
  return {
    sessionId: 1, gameName: 'Keg Race', premise: 'Race!', tracking: 'AUTO',
    winRule: 'first_to_target', metric: 'oz', startedAt: '2026-08-02T18:00:00Z',
    settings: { targetOz: 100 },
    players: [
      { drinkerId: 1, displayName: 'Sam', avatarColor: '#D08C4C', team: null, volumeMl: 1478 }, // ~50 oz
      { drinkerId: 2, displayName: 'JT', avatarColor: null, team: null, volumeMl: 739 }, // ~25 oz
    ],
    ...over,
  };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => vi.clearAllMocks());

describe('GameStrip', () => {
  it('renders nothing when no game is running', async () => {
    (getGameStrip as Mock).mockResolvedValue({ ok: true, data: null });
    const { container } = render(<GameStrip />);
    await flush();
    expect(container.firstChild).toBeNull();
  });

  it('shows the headline, a bar per player, and a gold leader bar when a game runs', async () => {
    (getGameStrip as Mock).mockResolvedValue({ ok: true, data: strip() });
    render(<GameStrip />);
    await flush();
    expect(screen.getByTestId('game-strip')).toHaveTextContent('KEG RACE · FIRST TO 100 OZ');
    const players = screen.getAllByTestId('game-strip-player');
    expect(players).toHaveLength(2);
    expect(players[0]).toHaveTextContent('Sam');
    expect(players[0]).toHaveTextContent('50 oz');
    // Leader bar (first player) fills 50% toward the 100 oz target and is gold.
    const leaderFill = players[0]!.querySelector('.game-strip__bar-fill') as HTMLElement;
    expect(leaderFill.className).toContain('leader');
    expect(leaderFill.style.width).toBe('50%');
  });

  it('scales to the leader when no target is set', async () => {
    (getGameStrip as Mock).mockResolvedValue({ ok: true, data: strip({ settings: null, winRule: 'highest' }) });
    render(<GameStrip />);
    await flush();
    expect(screen.getByTestId('game-strip')).toHaveTextContent('MOST POURED');
    const players = screen.getAllByTestId('game-strip-player');
    // Leader is 100%, second is ~50% of the leader.
    expect((players[0]!.querySelector('.game-strip__bar-fill') as HTMLElement).style.width).toBe('100%');
    expect((players[1]!.querySelector('.game-strip__bar-fill') as HTMLElement).style.width).toBe('50%');
  });
});
