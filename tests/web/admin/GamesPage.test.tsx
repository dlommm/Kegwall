import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { GamesPage } from '../../../src/web/routes/admin/GamesPage';
import {
  getGames, getActiveGame, startGameSession, endGameSession,
} from '../../../src/web/lib/adminApi';
import type { Game } from '../../../src/web/lib/adminApi';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  getGames: vi.fn(),
  getActiveGame: vi.fn(),
  startGameSession: vi.fn(),
  endGameSession: vi.fn(),
}));

function game(over: Partial<Game> & Pick<Game, 'id' | 'name' | 'category' | 'tracking'>): Game {
  return {
    premise: 'A premise.', metric: 'oz', winRule: 'highest', duration: '~30 min',
    minPlayers: 2, maxPlayers: 8, flags: null, ...over,
  };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getGames as Mock).mockResolvedValue({
    ok: true,
    data: [
      game({ id: 1, name: 'Keg Race', category: 'volume', tracking: 'AUTO' }),
      game({ id: 2, name: 'Perfect Pint', category: 'precision', tracking: 'AUTO' }),
      game({ id: 3, name: 'Kings Cup Verified', category: 'cardboard', tracking: 'TABLET' }),
    ],
  });
  (getActiveGame as Mock).mockResolvedValue({ ok: true, data: null });
  (startGameSession as Mock).mockResolvedValue({ ok: true, data: null });
  (endGameSession as Mock).mockResolvedValue({ ok: true, data: null });
});

describe('GamesPage', () => {
  it('groups games into category sections with a count', async () => {
    renderAdminPage(<GamesPage />);
    await flush();
    expect(screen.getByTestId('games-count')).toHaveTextContent('3 games');
    expect(screen.getByTestId('games-section-volume')).toHaveTextContent('Keg Race');
    expect(screen.getByTestId('games-section-precision')).toBeInTheDocument();
    expect(screen.getAllByTestId('game-card')).toHaveLength(3);
    expect(screen.getAllByTestId('game-tracking')[0]).toHaveTextContent('AUTO');
  });

  it('filters by tracking tag (TABLET)', async () => {
    renderAdminPage(<GamesPage />);
    await flush();
    fireEvent.click(screen.getByTestId('games-filter-tablet'));
    const cards = screen.getAllByTestId('game-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('Kings Cup Verified');
  });

  it('filters by category', async () => {
    renderAdminPage(<GamesPage />);
    await flush();
    fireEvent.click(screen.getByTestId('games-filter-precision'));
    expect(screen.getAllByTestId('game-card')).toHaveLength(1);
    expect(screen.getByTestId('game-card')).toHaveTextContent('Perfect Pint');
  });

  it('an editor can start a game, and the active banner replaces the Start buttons', async () => {
    renderAdminPage(<GamesPage />);
    await flush();
    fireEvent.click(screen.getAllByTestId('game-start')[0]!);
    await flush();
    expect(startGameSession).toHaveBeenCalledWith({ gameId: 1 });
  });

  it('shows the now-playing banner and an End control when a game is active', async () => {
    (getActiveGame as Mock).mockResolvedValue({
      ok: true, data: { session: { id: 7, gameId: 1, startedAt: 'x', endedAt: null, settings: null }, game: { name: 'Keg Race' }, participants: [] },
    });
    renderAdminPage(<GamesPage />);
    await flush();
    expect(screen.getByTestId('games-active-banner')).toHaveTextContent('Now playing: Keg Race');
    expect(screen.queryByTestId('game-start')).not.toBeInTheDocument(); // Start hidden while a game runs
    fireEvent.click(screen.getByTestId('games-end'));
    await flush();
    expect(endGameSession).toHaveBeenCalledWith(7);
  });

  it('a viewer sees no Start buttons', async () => {
    renderAdminPage(<GamesPage />, adminContext('viewer'));
    await flush();
    expect(screen.queryByTestId('game-start')).not.toBeInTheDocument();
  });
});
