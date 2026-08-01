import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getWallBySlug } from './crud.js';
import { allowedTapIdsForWall } from '../db/wallDevices.js';
import { recentUnclaimedPours, setPourDrinker, countPoursForDrinker } from '../db/pours.js';
import { listDrinkers, createDrinker, getUser } from '../db/users.js';
import { getKeg } from '../db/kegs.js';
import { getBeer } from '../db/beers.js';
import { listTaps } from '../db/taps.js';
import { leaderboard, biggestClaimedPour } from '../db/stats.js';
import { wallConfigSchema, type WallConfig } from '../core/wallConfig.js';
import { listFaceEmbeddings, insertFaceEmbedding, deleteFaceEmbeddingsForDrinker } from '../db/faceEmbeddings.js';

/** Design 3b: pours are claimable for 10 minutes after they happen. */
const CLAIM_WINDOW_MINUTES = 10;

/** Minimum scored pours before someone can win the "smoothest pour" superlative —
 * one lucky 98 shouldn't beat a consistent 94 (design 6b). */
const SMOOTHEST_MIN_SCORED = 3;

// A CSS color for the avatar circle: hex or a simple color word. Deliberately
// tight (not a general CSS <color>) since it round-trips into inline styles.
const AVATAR_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function publicRoutes(app: FastifyInstance) {
  const db = app.ctx.db;

  app.get('/api/public/wall/:slug', async (req, reply) => {
    const wall = getWallBySlug(db, (req.params as any).slug);
    if (!wall) return reply.code(404).send({ error: 'not_found', message: 'No such wall' });
    const config = wallConfigSchema.parse(wall.config) as WallConfig;
    // Device scoping first (strict: no assigned devices => no taps — see db/wallDevices),
    // then the hand-picked pages union narrows WITHIN that pool. allowedTapIds also
    // ships to the client, which must re-apply it to every /ws snapshot (the WS feed is
    // global, not per-wall — see routes/ws.ts).
    const allowedTapIds = allowedTapIdsForWall(db, wall.id);
    const allowed = new Set(allowedTapIds);
    let taps = app.ctx.state.getTapStates().filter((t) => allowed.has(t.tapId));
    const configured = new Set(config.pages.flatMap((p) => p.tapIds));
    if (configured.size > 0) taps = taps.filter((t) => configured.has(t.tapId));
    return {
      wall: { slug: wall.slug, name: wall.name, config },
      taps,
      allowedTapIds,
      units: app.ctx.settings.get('displayUnits'),
    };
  });

  app.get('/api/public/menu', async () => ({
    siteName: app.ctx.settings.get('siteName'),
    taps: app.ctx.state.getTapStates(),
    units: app.ctx.settings.get('displayUnits'),
  }));

  app.get('/api/public/drinkers', async () =>
    listDrinkers(db).map((d) => ({
      id: d.id, displayName: d.displayName, avatarColor: d.avatarColor,
    })));

  // Passwordless pourer signup (Pour Wall overhaul Phase 3, design 3a/3b): name +
  // avatar color only — no email, no password. Used by the tablet kiosk's "I'M NEW —
  // SIGN ME UP" screen and the phone QR claim flow's join step. Rate-limited hard:
  // it's an unauthenticated LAN write.
  app.post('/api/public/pourers', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(1).max(40),
      color: z.string().regex(AVATAR_COLOR_PATTERN).optional(),
    }).parse(req.body);
    const drinker = createDrinker(db, { displayName: body.name, avatarColor: body.color });
    app.ctx.log.info('tablet', `New pourer registered — "${drinker.displayName}" (passwordless signup)`);
    reply.code(201);
    return { id: drinker.id, displayName: drinker.displayName, avatarColor: drinker.avatarColor };
  });

  // The tablet's avatar grid: every pourer with their lifetime pour count.
  app.get('/api/public/pourers', async () =>
    listDrinkers(db).map((d) => ({
      id: d.id,
      displayName: d.displayName,
      avatarColor: d.avatarColor,
      pourCount: countPoursForDrinker(db, d.id),
    })));

  // Tablet arming (design 3a): "who's pouring?" → arm → the next recorded pour on any
  // tap is attributed to the armed pourer (see core/tabletArm.ts + StateManager).
  app.post('/api/public/tablet/arm', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = z.object({ drinkerId: z.number().int() }).parse(req.body);
    const drinker = getUser(db, body.drinkerId);
    if (!drinker || !drinker.isDrinker) {
      return reply.code(400).send({ error: 'validation', message: 'No such pourer' });
    }
    const armed = app.ctx.tabletArm.arm(body.drinkerId);
    app.ctx.log.info('tablet', `Tablet armed — "${drinker.displayName}" is up, next pour attributes to them`);
    return { armed: true, drinkerId: armed.drinkerId, expiresAt: new Date(armed.expiresAt).toISOString() };
  });

  app.delete('/api/public/tablet/arm', async () => {
    app.ctx.tabletArm.disarm();
    return { armed: false };
  });

  app.get('/api/public/tablet/arm', async () => {
    const armed = app.ctx.tabletArm.current();
    return armed
      ? { armed: true, drinkerId: armed.drinkerId, expiresAt: new Date(armed.expiresAt).toISOString() }
      : { armed: false };
  });

  // Face sign-in (Plan B): embeddings directory + enrollment. Same trusted-LAN
  // exposure class as the pourer grid above — embeddings are opt-in, deletable,
  // and image bytes never reach the server (descriptors are computed on-device).
  app.get('/api/public/faces', async () => {
    const cfg = app.ctx.settings.get('faceSignIn');
    return {
      enabled: cfg.enabled,
      threshold: cfg.threshold,
      faces: cfg.enabled ? listFaceEmbeddings(db) : [],
    };
  });

  app.post('/api/public/faces', async (req, reply) => {
    const cfg = app.ctx.settings.get('faceSignIn');
    if (!cfg.enabled) return reply.code(403).send({ error: 'face sign-in is disabled' });
    const body = z.object({
      drinkerId: z.number().int().positive(),
      embedding: z.array(z.number().finite()).min(64).max(2048),
    }).parse(req.body);
    const drinker = getUser(db, body.drinkerId);
    if (!drinker || !drinker.isDrinker) return reply.code(404).send({ error: 'no such drinker' });
    const row = insertFaceEmbedding(db, body.drinkerId, body.embedding);
    app.ctx.bus.emit('state_changed', { scope: 'faces', ts: new Date().toISOString() });
    app.ctx.log.info('faces', `Face enrolled for "${drinker.displayName}" (${row.id})`);
    return reply.code(201).send(row);
  });

  app.delete('/api/public/faces/drinker/:drinkerId', async (req) => {
    const drinkerId = z.coerce.number().int().positive().parse((req.params as any).drinkerId);
    const deleted = deleteFaceEmbeddingsForDrinker(db, drinkerId);
    if (deleted > 0) app.ctx.bus.emit('state_changed', { scope: 'faces', ts: new Date().toISOString() });
    return { deleted };
  });

  // Public leaderboard (design 4a view + 6b quality/superlatives) — feeds /board.
  app.get('/api/public/leaderboard', async (req) => {
    const query = z.object({
      window: z.enum(['week', 'month', 'all']).default('month'),
    }).parse(req.query ?? {});
    const entries = leaderboard(db, query.window);
    const byPours = [...entries].sort((a, b) => b.pourCount - a.pourCount)[0] ?? null;
    const smoothest = entries
      .filter((e) => e.avgQuality !== null && e.qualityCount >= SMOOTHEST_MIN_SCORED)
      .sort((a, b) => (b.avgQuality ?? 0) - (a.avgQuality ?? 0))[0] ?? null;
    return {
      window: query.window,
      entries,
      superlatives: {
        mostPours: byPours && byPours.pourCount > 0
          ? { displayName: byPours.displayName, pourCount: byPours.pourCount }
          : null,
        smoothest: smoothest
          ? { displayName: smoothest.displayName, avgQuality: smoothest.avgQuality }
          : null,
        biggestPour: biggestClaimedPour(db, query.window),
      },
    };
  });

  app.get('/api/public/recent-pours', async () => {
    const tapByNumber = new Map(listTaps(db).map((t) => [t.id, t.number]));
    return recentUnclaimedPours(db, CLAIM_WINDOW_MINUTES).map((p) => {
      const keg = getKeg(db, p.kegId)!;
      const beer = getBeer(db, keg.beerId);
      return {
        id: p.id, ts: p.ts, volumeMl: p.volumeMl,
        tapNumber: keg.tapId ? tapByNumber.get(keg.tapId) ?? null : null,
        beerName: beer?.name ?? 'Unknown',
      };
    });
  });

  app.post('/api/public/claim', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = z.object({
      pourId: z.number().int(), drinkerId: z.number().int(),
    }).parse(req.body);
    const existing = db.prepare('SELECT drinker_id FROM pours WHERE id = ?')
      .get(body.pourId) as any;
    if (!existing) return reply.code(404).send({ error: 'not_found', message: 'No such pour' });
    if (existing.drinker_id !== null) {
      return reply.code(409).send({ error: 'conflict', message: 'Pour already claimed' });
    }
    const drinker = db.prepare('SELECT id FROM users WHERE id = ? AND is_drinker = 1')
      .get(body.drinkerId);
    if (!drinker) {
      return reply.code(400).send({ error: 'validation', message: 'No such drinker' });
    }
    const pour = setPourDrinker(db, body.pourId, body.drinkerId);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    app.ctx.log.info('pours', `Pour #${pour.id} claimed (${Math.round(pour.volumeMl)} mL) via the phone claim flow`);
    return pour;
  });
}
