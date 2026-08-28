// --- Drinking games (redesign 5a/5b) ---------------------------------------
import { request, type ApiResult } from '../adminHttp';

export type { Game, GameSession, GameParticipant, GameStrip } from '../../../server/db/games.js';

type ActiveGame = {
  session: import('../../../server/db/games.js').GameSession;
  game: import('../../../server/db/games.js').Game;
  participants: { drinkerId: number; displayName: string; avatarColor: string | null; team: string | null }[];
} | null;

/** GET /api/games — the full 100-game catalog (viewer role). */
export function getGames(): Promise<ApiResult<import('../../../server/db/games.js').Game[]>> {
  return request('/api/games');
}

/** GET /api/games/active — the one running session (hydrated) or null. */
export function getActiveGame(): Promise<ApiResult<ActiveGame>> {
  return request('/api/games/active');
}

export function startGameSession(input: {
  gameId: number;
  settings?: Record<string, unknown> | null;
  participantDrinkerIds?: number[];
}): Promise<ApiResult<ActiveGame>> {
  return request('/api/games/sessions', { method: 'POST', body: JSON.stringify(input) });
}

export function endGameSession(
  sessionId: number,
  results: { drinkerId: number; score: number; rank: number }[] = [],
): Promise<ApiResult<import('../../../server/db/games.js').GameSession>> {
  return request(`/api/games/sessions/${sessionId}/end`, { method: 'POST', body: JSON.stringify({ results }) });
}
