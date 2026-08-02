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
import { toPublicTapState, type TapState } from '../core/state.js';
import { displayPricePerPintCents } from '../core/pricing.js';
import { activeGameStrip, recentGameWinner } from '../db/games.js';
import { requireDisplayToken } from './displayAuth.js';
import { bestMatch } from '../core/faceMatch.js';
import { listFaceEmbeddings, insertFaceEmbedding, deleteFaceEmbeddingsForDrinker } from '../db/faceEmbeddings.js';

const faceEmbeddingSchema = z.array(z.number().finite()).min(64).max(2048);

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

  /**
   * Public tap serialization + the ONE public-facing money value: the computed per-pint
   * DISPLAY price, attached only when pricing is enabled. Cost is read from the raw TapState,
   * priced, then `toPublicTapState` strips every owner-cost field — so the wire carries the
   * marked-up price and nothing that reveals what the operator actually paid (hard requirement).
   */
  function toPublicTap(t: TapState): TapState & { pricePerPintCents: number | null } {
    const pricing = app.ctx.settings.get('pricing');
    const pricePerPintCents = pricing.enabled && t.keg
      ? displayPricePerPintCents({
        costCents: t.keg.costCents,
        sizeMl: t.keg.sizeMl,
        markupPct: pricing.markupPct,
        rounding: pricing.rounding,
        overridePct: t.beer?.markupOverridePct ?? null,
      })
      : null;
    return { ...toPublicTapState(t), pricePerPintCents };
  }
  // Display-facing reads: gated behind the display token when enforcement is on (dormant
  // otherwise). The guest-phone claim flow below (recent-pours/claim/pourers) stays public.
  const display = { preHandler: requireDisplayToken(app) };

  app.get('/api/public/wall/:slug', display, async (req, reply) => {
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
      taps: taps.map(toPublicTap), // strips owner cost; attaches display price when enabled
      allowedTapIds,
      units: app.ctx.settings.get('displayUnits'),
    };
  });

  // GET /api/public/game — the live wall GAME STRIP (redesign 5c), or null when no game runs.
  // Display-gated like the wall; public-safe (pourer names + progress only, no cost/accounts).
  app.get('/api/public/game', display, async () => activeGameStrip(db));

  app.get('/api/public/menu', display, async () => ({
    siteName: app.ctx.settings.get('siteName'),
    // Hidden taps never reach a public surface; owner cost is stripped by toPublicTap, which
    // also attaches the computed display price when pricing is enabled.
    taps: app.ctx.state.getTapStates().filter((t) => !t.hidden).map(toPublicTap),
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

  app.delete('/api/public/tablet/arm', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async () => {
    app.ctx.tabletArm.disarm();
    return { armed: false };
  });

  app.get('/api/public/tablet/arm', async () => {
    const armed = app.ctx.tabletArm.current();
    return armed
      ? { armed: true, drinkerId: armed.drinkerId, expiresAt: new Date(armed.expiresAt).toISOString() }
      : { armed: false };
  });

  // Face sign-in (Plan B). CRITICAL: the enrolled embedding vectors are irrevocable
  // biometric data and NEVER leave the server. This endpoint returns only whether the
  // feature is enabled (the tablet uses it to decide whether to start the camera). Matching
  // happens server-side via POST /faces/match below.
  app.get('/api/public/faces', async () => {
    const cfg = app.ctx.settings.get('faceSignIn');
    return { enabled: cfg.enabled };
  });

  // Whether a specific drinker already has a face on file (a boolean only — never a vector).
  // Feeds the kiosk enroll screen's "you've added your face" state.
  app.get('/api/public/faces/enrolled/:drinkerId', async (req) => {
    const drinkerId = z.coerce.number().int().positive().parse((req.params as any).drinkerId);
    const row = db.prepare('SELECT 1 FROM face_embeddings WHERE drinker_id = ? LIMIT 1').get(drinkerId);
    return { enrolled: !!row };
  });

  // Server-side match: the tablet computes a probe embedding on-device and posts it here;
  // the server compares it against the corpus and returns only { drinkerId, score } — the
  // corpus is never serialized to any client.
  app.post('/api/public/faces/match', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const cfg = app.ctx.settings.get('faceSignIn');
    if (!cfg.enabled) return reply.code(403).send({ error: 'face sign-in is disabled' });
    const { embedding } = z.object({ embedding: faceEmbeddingSchema }).parse(req.body);
    const enrolled = listFaceEmbeddings(db)
      .map((r) => ({ drinkerId: r.drinkerId, embedding: r.embedding }));
    return { match: bestMatch(embedding, enrolled, cfg.threshold) };
  });

  // Enrollment is bound to the currently-ARMED pourer: you can only add a face for whoever
  // is armed at the kiosk right now (the "Add my face" button lives on the armed screen).
  // That closes both the impersonation vector (enrolling your face as someone else) and the
  // eviction DoS (5 junk POSTs destroying a victim's real samples) — neither is reachable
  // without first arming as that exact drinker at the physical tablet.
  app.post('/api/public/faces', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const cfg = app.ctx.settings.get('faceSignIn');
    if (!cfg.enabled) return reply.code(403).send({ error: 'face sign-in is disabled' });
    const body = z.object({
      drinkerId: z.number().int().positive(),
      embedding: faceEmbeddingSchema,
    }).parse(req.body);
    const armed = app.ctx.tabletArm.current();
    if (!armed || armed.drinkerId !== body.drinkerId) {
      return reply.code(403).send({
        error: 'forbidden', message: 'Arm this pourer on the tablet before adding their face',
      });
    }
    const drinker = getUser(db, body.drinkerId);
    if (!drinker || !drinker.isDrinker) return reply.code(404).send({ error: 'no such drinker' });
    const row = insertFaceEmbedding(db, body.drinkerId, body.embedding);
    app.ctx.bus.emit('state_changed', { scope: 'faces', ts: new Date().toISOString() });
    app.ctx.log.info('faces', `Face enrolled for "${drinker.displayName}" (${row.id})`);
    return reply.code(201).send(row);
  });

  // Self-service "remove my face" at the kiosk — same armed-pourer binding + enabled gate as
  // enrollment (an admin deletes anyone's data via the admin DELETE /api/faces/drinker/:id).
  app.delete('/api/public/faces/drinker/:drinkerId', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const cfg = app.ctx.settings.get('faceSignIn');
    if (!cfg.enabled) return reply.code(403).send({ error: 'face sign-in is disabled' });
    const drinkerId = z.coerce.number().int().positive().parse((req.params as any).drinkerId);
    const armed = app.ctx.tabletArm.current();
    if (!armed || armed.drinkerId !== drinkerId) {
      return reply.code(403).send({
        error: 'forbidden', message: 'Arm this pourer on the tablet before removing their face',
      });
    }
    const deleted = deleteFaceEmbeddingsForDrinker(db, drinkerId);
    if (deleted > 0) app.ctx.bus.emit('state_changed', { scope: 'faces', ts: new Date().toISOString() });
    return { deleted };
  });

  // Leaderboard (design 4a view + 6b quality/superlatives) — feeds /board, a display surface.
  app.get('/api/public/leaderboard', display, async (req) => {
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
        // Games decorate the ONE board (redesign 5d) — never a separate leaderboard.
        gameWinner: recentGameWinner(db),
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
    const existing = db.prepare('SELECT drinker_id, ts FROM pours WHERE id = ?')
      .get(body.pourId) as { drinker_id: number | null; ts: string } | undefined;
    if (!existing) return reply.code(404).send({ error: 'not_found', message: 'No such pour' });
    if (existing.drinker_id !== null) {
      return reply.code(409).send({ error: 'conflict', message: 'Pour already claimed' });
    }
    // The claim window is enforced server-side, not just in the UI's recent-pours list:
    // a pour older than CLAIM_WINDOW_MINUTES can't be claimed by anyone (design 3b), so an
    // anonymous caller can't back-claim arbitrarily old pours to inflate the leaderboard.
    // ISO-8601 UTC timestamps compare lexicographically (recordPourTx stores `…Z`).
    const cutoff = new Date(Date.now() - CLAIM_WINDOW_MINUTES * 60_000).toISOString();
    if (existing.ts < cutoff) {
      return reply.code(409).send({ error: 'conflict', message: 'Pour is too old to claim' });
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
