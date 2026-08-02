import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError } from '../core/errors.js';
import { GAMES_CATALOG, type GameCategory, type GameTracking } from './gamesCatalog.js';

// Drinking-games repo (WebUI redesign Phase 5). The `games` catalog is seeded from
// gamesCatalog.ts; sessions/participants/results track a live game. Only one session runs at
// a time (enforced by idx_game_sessions_active). Results decorate the ONE house leaderboard.

export interface Game {
  id: number;
  name: string;
  category: GameCategory;
  premise: string;
  tracking: GameTracking;
  metric: string;
  winRule: string;
  duration: string | null;
  minPlayers: number;
  maxPlayers: number | null;
  flags: Record<string, unknown> | null;
}

export interface GameSession {
  id: number;
  gameId: number;
  startedAt: string;
  endedAt: string | null;
  settings: Record<string, unknown> | null;
}

export interface GameParticipant {
  sessionId: number;
  drinkerId: number;
  team: string | null;
}

function rowToGame(r: any): Game {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    premise: r.premise,
    tracking: r.tracking,
    metric: r.metric,
    winRule: r.win_rule,
    duration: r.duration ?? null,
    minPlayers: r.min_players,
    maxPlayers: r.max_players ?? null,
    flags: r.flags ? JSON.parse(r.flags) : null,
  };
}

function rowToSession(r: any): GameSession {
  return {
    id: r.id,
    gameId: r.game_id,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
    settings: r.settings_json ? JSON.parse(r.settings_json) : null,
  };
}

/**
 * Idempotently loads the 100-game catalog. Upserts by name so premises/tags stay fresh on
 * redeploy without wiping any sessions (games are referenced by game_sessions.game_id, so a
 * delete-and-reinsert would break history — upsert keeps ids stable). Called at boot.
 */
export function seedGames(db: Database.Database): void {
  const upsert = db.prepare(`
    INSERT INTO games (name, category, premise, tracking, metric, win_rule, duration, min_players, max_players, flags)
    VALUES (@name, @category, @premise, @tracking, @metric, @winRule, @duration, @minPlayers, @maxPlayers, @flags)
    ON CONFLICT(name) DO UPDATE SET
      category = excluded.category, premise = excluded.premise, tracking = excluded.tracking,
      metric = excluded.metric, win_rule = excluded.win_rule, duration = excluded.duration,
      min_players = excluded.min_players, max_players = excluded.max_players, flags = excluded.flags
  `);
  const run = db.transaction(() => {
    for (const game of GAMES_CATALOG) {
      upsert.run({
        name: game.name, category: game.category, premise: game.premise, tracking: game.tracking,
        metric: game.metric, winRule: game.winRule, duration: game.duration,
        minPlayers: game.minPlayers, maxPlayers: game.maxPlayers, flags: null,
      });
    }
  });
  run();
}

export function listGames(db: Database.Database): Game[] {
  return db.prepare('SELECT * FROM games ORDER BY category, name COLLATE NOCASE').all().map(rowToGame);
}

export function getGame(db: Database.Database, id: number): Game | null {
  const r = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  return r ? rowToGame(r) : null;
}

/** The one currently-running game session, or null. */
export function getActiveSession(db: Database.Database): GameSession | null {
  const r = db.prepare('SELECT * FROM game_sessions WHERE ended_at IS NULL LIMIT 1').get();
  return r ? rowToSession(r) : null;
}

export function getSession(db: Database.Database, id: number): GameSession | null {
  const r = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id);
  return r ? rowToSession(r) : null;
}

/** Starts a game. 409s if a session is already running (idx_game_sessions_active also guards). */
export function startSession(db: Database.Database, input: {
  gameId: number;
  startedAt?: string;
  settings?: Record<string, unknown> | null;
  participants?: { drinkerId: number; team?: string | null }[];
}): GameSession {
  if (!getGame(db, input.gameId)) throw new NotFoundError(`game ${input.gameId}`);
  if (getActiveSession(db)) throw new ConflictError('a game is already running');
  const startedAt = input.startedAt ?? new Date().toISOString();
  const tx = db.transaction(() => {
    const res = db.prepare('INSERT INTO game_sessions (game_id, started_at, settings_json) VALUES (?, ?, ?)')
      .run(input.gameId, startedAt, input.settings ? JSON.stringify(input.settings) : null);
    const sessionId = Number(res.lastInsertRowid);
    for (const p of input.participants ?? []) {
      db.prepare('INSERT OR IGNORE INTO game_participants (session_id, drinker_id, team) VALUES (?, ?, ?)')
        .run(sessionId, p.drinkerId, p.team ?? null);
    }
    return sessionId;
  });
  return getSession(db, tx())!;
}

export function addParticipant(db: Database.Database, sessionId: number, drinkerId: number, team?: string | null): void {
  if (!getSession(db, sessionId)) throw new NotFoundError(`session ${sessionId}`);
  db.prepare('INSERT OR IGNORE INTO game_participants (session_id, drinker_id, team) VALUES (?, ?, ?)')
    .run(sessionId, drinkerId, team ?? null);
}

export function listParticipants(db: Database.Database, sessionId: number): GameParticipant[] {
  return db.prepare('SELECT * FROM game_participants WHERE session_id = ?').all(sessionId)
    .map((r: any) => ({ sessionId: r.session_id, drinkerId: r.drinker_id, team: r.team ?? null }));
}

/** Ends a session and records final results (score + rank per drinker). */
export function endSession(
  db: Database.Database,
  sessionId: number,
  results: { drinkerId: number; score: number; rank: number }[] = [],
  endedAt?: string,
): GameSession {
  const session = getSession(db, sessionId);
  if (!session) throw new NotFoundError(`session ${sessionId}`);
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_sessions SET ended_at = ? WHERE id = ?')
      .run(endedAt ?? new Date().toISOString(), sessionId);
    for (const r of results) {
      db.prepare('INSERT OR REPLACE INTO game_results (session_id, drinker_id, score, rank) VALUES (?, ?, ?, ?)')
        .run(sessionId, r.drinkerId, r.score, r.rank);
    }
  });
  tx();
  return getSession(db, sessionId)!;
}
