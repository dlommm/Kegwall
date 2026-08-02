import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  listGames, getGame, getActiveSession, getSession, startSession, endSession,
  addParticipant, listParticipants,
} from '../db/games.js';
import { getUser } from '../db/users.js';
import { NotFoundError, ValidationError } from '../core/errors.js';

/** Parse a route :id param to a positive int, or 400. */
function parseId(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('invalid id');
  return id;
}

/**
 * `/api/games/*` — the drinking-games catalog + live session control (WebUI redesign 5a/5b).
 * Reads are viewer-role; starting/ending a game is editor-role. Results decorate the ONE
 * house leaderboard (Phase 5) — there is no separate game leaderboard.
 */
export async function gamesRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };
  const editor = { preHandler: requireRole('editor') };

  app.get('/api/games', viewer, async () => listGames(db));

  // The one running session, hydrated with its game + participant names, or null.
  app.get('/api/games/active', viewer, async () => hydrateActive(db));

  const startSchema = z.object({
    gameId: z.number().int().positive(),
    settings: z.record(z.string(), z.unknown()).nullish(),
    participantDrinkerIds: z.array(z.number().int().positive()).default([]),
  });
  app.post('/api/games/sessions', editor, async (req, reply) => {
    const body = startSchema.parse(req.body);
    const session = startSession(db, {
      gameId: body.gameId,
      settings: body.settings ?? null,
      participants: body.participantDrinkerIds.map((drinkerId) => ({ drinkerId })),
    });
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    reply.code(201);
    return hydrateActive(db, session.id);
  });

  const participantSchema = z.object({
    drinkerId: z.number().int().positive(),
    team: z.string().max(40).nullish(),
  });
  app.post('/api/games/sessions/:id/participants', editor, async (req) => {
    const sessionId = parseId(req.params);
    const body = participantSchema.parse(req.body);
    addParticipant(db, sessionId, body.drinkerId, body.team ?? null);
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    return hydrateActive(db, sessionId);
  });

  const endSchema = z.object({
    results: z.array(z.object({
      drinkerId: z.number().int().positive(),
      score: z.number(),
      rank: z.number().int().positive(),
    })).default([]),
  }).default({ results: [] });
  app.post('/api/games/sessions/:id/end', editor, async (req) => {
    const sessionId = parseId(req.params);
    if (!getSession(db, sessionId)) throw new NotFoundError('session');
    const body = endSchema.parse(req.body ?? {});
    const session = endSession(db, sessionId, body.results);
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    return session;
  });
}

/** Active session + its game + participant identities, or null. */
export function hydrateActive(db: import('better-sqlite3').Database, sessionId?: number) {
  const session = sessionId ? getSession(db, sessionId) : getActiveSession(db);
  if (!session) return null;
  const game = getGame(db, session.gameId);
  if (!game) return null;
  const participants = listParticipants(db, session.id).map((p) => {
    const user = getUser(db, p.drinkerId);
    return {
      drinkerId: p.drinkerId,
      displayName: user?.displayName ?? 'Unknown',
      avatarColor: user?.avatarColor ?? null,
      team: p.team,
    };
  });
  return { session, game, participants };
}
