import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  createBeer, listBeers, getBeer, updateBeer, deleteBeer,
} from '../db/beers.js';
import { createTap, listTaps, updateTap, deleteTap, getTap } from '../db/taps.js';
import {
  listKegs, getKeg, swapKeg, createKeg, listOnDeckForTap, removeOnDeckKeg, getActiveKegForTap,
} from '../db/kegs.js';
import {
  listMonitors, bindMonitorToTap, sanitizeMonitor, getMonitorById,
} from '../db/monitors.js';
import { listTelemetry } from '../db/telemetry.js';
import { listPours } from '../db/pours.js';
import {
  createUser, createDrinker, listUsers, updateUser, deleteUser,
} from '../db/users.js';
import { wallConfigSchema } from '../core/wallConfig.js';
import { settingsSchema } from '../db/settings.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { registerConfiguredSources } from '../ingest/bootstrap.js';
import { setPourDrinker } from '../db/pours.js';
import { SOURCE_RESTART_KEYS } from '../core/restartKeys.js';

const beerSchema = z.object({
  name: z.string().min(1),
  brewery: z.string().nullish(), style: z.string().nullish(),
  abv: z.number().nullish(), ibu: z.number().nullish(), srm: z.number().nullish(),
  description: z.string().nullish(), labelImage: z.string().nullish(),
});

export interface Wall { id: number; slug: string; name: string; config: unknown }

export function getWallBySlug(db: any, slug: string): Wall | null {
  const r = db.prepare('SELECT * FROM walls WHERE slug = ?').get(slug);
  return r ? { id: r.id, slug: r.slug, name: r.name, config: JSON.parse(r.config) } : null;
}

/**
 * Throws `ValidationError` unless `drinkerId` is `null`/`undefined` (nothing to check —
 * "no default" / "field omitted") or refers to an existing `is_drinker = 1` user.
 *
 * Phase 5 Task 0 review, Fix round 1: the `users.id` FK on both `pours.drinker_id` and
 * `taps.default_drinker_id` only blocks a NONEXISTENT id — it happily accepts a real
 * login-only staff account (`is_drinker = 0`) that deliberately opted out of drinker
 * visibility. `PATCH /api/pours/:id/drinker` (below) already re-checked this by hand;
 * this is that same check, extracted so `POST`/`PATCH /api/taps` (which had been missing
 * it entirely — a tap's default drinker gets stamped onto every future pour by
 * `StateManager`, unvalidated, per core/state.ts) can share it. A raw API caller could
 * otherwise set a staff member's user id as a tap's default and have every pour on that
 * tap publicly attributed to them.
 */
function assertValidDrinkerId(db: any, drinkerId: number | null | undefined): void {
  if (drinkerId == null) return;
  const drinker = db.prepare('SELECT id FROM users WHERE id = ? AND is_drinker = 1').get(drinkerId);
  if (!drinker) throw new ValidationError('No such drinker');
}

// Exported (alongside getWallBySlug) for Task 13's wall-display routes, per the
// Task 11 brief's Produces list — the POST /api/walls handler below delegates here.
export function createWall(db: any, input: { slug: string; name: string; config?: unknown }): Wall {
  const config = wallConfigSchema.parse(input.config ?? {});
  const res = db.prepare('INSERT INTO walls (slug, name, config) VALUES (?, ?, ?)')
    .run(input.slug, input.name, JSON.stringify(config));
  return { id: Number(res.lastInsertRowid), slug: input.slug, name: input.name, config };
}

export async function crudRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };
  const editor = { preHandler: requireRole('editor') };
  const admin = { preHandler: requireRole('admin') };

  // --- beers ---
  app.get('/api/beers', viewer, async () => listBeers(db));
  app.post('/api/beers', editor, async (req, reply) =>
    reply.code(201).send(createBeer(db, beerSchema.parse(req.body))));
  app.get('/api/beers/:id', viewer, async (req) => {
    const beer = getBeer(db, Number((req.params as any).id));
    if (!beer) throw new NotFoundError('beer');
    return beer;
  });
  app.patch('/api/beers/:id', editor, async (req) =>
    updateBeer(db, Number((req.params as any).id), beerSchema.partial().parse(req.body)));
  app.delete('/api/beers/:id', editor, async (req, reply) => {
    deleteBeer(db, Number((req.params as any).id));
    return reply.code(204).send();
  });

  // --- taps (same shape) ---
  // Every mutation below emits 'state_changed' (scope 'taps') so the admin taps page's
  // live list — sourced entirely from the /ws snapshot via useTapStates, same as the
  // wall/menu — picks up a newly added/renamed/removed tap without a manual reload
  // (Task 5). getTapStates() (ws.ts's snapshot) already includes every tap regardless of
  // keg state, so no other change is needed for a bare tap CRUD op to show up live.
  const tapSchema = z.object({
    number: z.number().int().min(1),
    name: z.string().nullish(),
    // Phase 5 Task 0: the drinker StateManager stamps onto an otherwise-unclaimed
    // pour_completed record for this tap (see core/state.ts). `null` clears it.
    defaultDrinkerId: z.number().int().nullish(),
  });
  app.get('/api/taps', viewer, async () => listTaps(db));
  app.post('/api/taps', editor, async (req, reply) => {
    const body = tapSchema.parse(req.body);
    assertValidDrinkerId(db, body.defaultDrinkerId);
    const tap = createTap(db, body);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return reply.code(201).send(tap);
  });
  app.patch('/api/taps/:id', editor, async (req) => {
    const body = tapSchema.partial().parse(req.body);
    assertValidDrinkerId(db, body.defaultDrinkerId);
    const tap = updateTap(db, Number((req.params as any).id), body);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return tap;
  });
  app.delete('/api/taps/:id', editor, async (req, reply) => {
    deleteTap(db, Number((req.params as any).id));
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return reply.code(204).send();
  });

  // The 7 KegFill asset ids (keg-asset fill indicator feature) — kept in sync BY HAND
  // with `src/web/lib/kegAssets.ts`'s `KEG_ASSET_IDS` and migration 005's CHECK
  // constraint, same convention this file already uses for `status` enums vs. their
  // SQL CHECKs. `null`/omitted means "auto-match by sizeMl" (see `resolveKegAsset`).
  const kegTypeSchema = z.enum([
    'half-barrel', 'quarter-barrel', 'sixth-barrel', 'fifty-liter', 'cornelius', 'slim-quarter', 'mini-keg',
  ]).nullable().optional();

  // --- keg swap ---
  // `fromKegId` promotes an already-queued on-deck keg (see `listOnDeckForTap` /
  // `swapKeg`'s doc comment in db/kegs.ts, Task 1) instead of tapping a brand-new one —
  // in that path `beerId`/`sizeMl`/`volStartMl`/`kegType` are ignored (the promoted keg
  // keeps the values it was created with), so the refine below only requires them when
  // `fromKegId` is absent. This mirrors `swapKeg`'s own runtime check but surfaces it as
  // a clean 400 instead of a raw thrown-from-the-transaction ValidationError with a
  // route-agnostic message.
  const swapSchema = z.object({
    beerId: z.number().int().optional(),
    sizeMl: z.number().int().positive().optional(),
    volStartMl: z.number().int().positive().optional(),
    fromKegId: z.number().int().optional(),
    kegType: kegTypeSchema,
  }).refine(
    (v) => v.fromKegId != null || (v.beerId != null && v.sizeMl != null && v.volStartMl != null),
    { message: 'beerId, sizeMl, and volStartMl are required unless fromKegId (promoting an on-deck keg) is given' },
  );
  app.post('/api/taps/:id/swap', editor, async (req, reply) => {
    const tapId = Number((req.params as any).id);
    if (!getTap(db, tapId)) throw new NotFoundError('tap');
    const body = swapSchema.parse(req.body);
    // Captured BEFORE swapKeg (which kicks it, inside its own transaction) so the
    // outgoing keg's id/beerId are still available to emit `keg_kicked` for it below —
    // Phase 5 Task 3: feeds the automation engine's keg_kicked/keg_tapped triggers.
    const outgoing = getActiveKegForTap(db, tapId);
    const keg = swapKeg(db, {
      tapId,
      fromKegId: body.fromKegId,
      newBeerId: body.beerId,
      sizeMl: body.sizeMl,
      volStartMl: body.volStartMl,
      kegType: body.kegType,
    });
    const ts = new Date().toISOString();
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts });
    // Kicked-then-tapped order (not the reverse) — a rule that auto-resolves a
    // "keg kicked" alert on `keg_tapped` (see automation/engine.ts) should see the kick
    // recorded first.
    if (outgoing) {
      app.ctx.bus.emit('keg_kicked', { tapId, kegId: outgoing.id, beerId: outgoing.beerId, ts });
    }
    app.ctx.bus.emit('keg_tapped', { tapId, kegId: keg.id, beerId: keg.beerId, ts });
    return reply.code(201).send(keg);
  });

  // GET /api/taps/:id/on-deck — the swap wizard's on-deck queue for a single tap
  // (Task 5), in queue order. Registered ahead of no other tap route conflicts with it
  // (Fastify matches the literal `/on-deck` segment before `/api/taps/:id` alone would).
  app.get('/api/taps/:id/on-deck', viewer, async (req) => {
    const tapId = Number((req.params as any).id);
    if (!getTap(db, tapId)) throw new NotFoundError('tap');
    return listOnDeckForTap(db, tapId);
  });

  // --- kegs ---
  // `status` here only ever accepts 'on_deck' — a bare create is otherwise always
  // 'on_tap' (createKeg's own default); the on-deck queue's "add to queue" action is the
  // one caller that needs this path (Task 5). Queuing without a `tapId` would be
  // meaningless (there's nothing to queue behind), so it's required together with
  // `status: 'on_deck'` even though `tapId` is otherwise optional on a bare keg create.
  const kegCreateSchema = z.object({
    beerId: z.number().int(), sizeMl: z.number().int().positive(),
    volStartMl: z.number().int().positive(), tapId: z.number().int().nullish(),
    status: z.enum(['on_deck']).optional(),
    kegType: kegTypeSchema,
    // Cost tracking (Phase 6, design 6d): what the keg cost, in cents.
    costCents: z.number().int().min(0).nullish(),
  }).refine((v) => v.status !== 'on_deck' || v.tapId != null, {
    message: 'tapId is required when queuing an on_deck keg',
  });
  app.get('/api/kegs', viewer, async (req) => {
    const q = z.object({ status: z.enum(['on_tap', 'kicked', 'archived']).optional() })
      .parse(req.query);
    return listKegs(db, q);
  });
  app.post('/api/kegs', editor, async (req, reply) => {
    const body = kegCreateSchema.parse(req.body);
    const keg = createKeg(db, body);
    if (body.costCents != null) {
      db.prepare('UPDATE kegs SET cost_cents = ? WHERE id = ?').run(body.costCents, keg.id);
    }
    return reply.code(201).send(getKeg(db, keg.id));
  });
  app.patch('/api/kegs/:id', editor, async (req) => {
    const body = z.object({
      status: z.enum(['on_tap', 'kicked', 'archived']).optional(),
      // Cost tracking (Phase 6, design 6d) — settable/clearable independently of status.
      costCents: z.number().int().min(0).nullable().optional(),
    }).refine((v) => v.status !== undefined || v.costCents !== undefined, {
      message: 'nothing to update',
    }).parse(req.body);
    const keg = getKeg(db, Number((req.params as any).id));
    if (!keg) throw new NotFoundError('keg');
    if (body.costCents !== undefined) {
      db.prepare('UPDATE kegs SET cost_cents = ? WHERE id = ?').run(body.costCents, keg.id);
    }
    if (body.status === undefined) return getKeg(db, keg.id);
    db.prepare('UPDATE kegs SET status = ? WHERE id = ?').run(body.status, keg.id);
    // Phase 5 Task 3: a manual status flip is the OTHER "swap/status path" the automation
    // engine's keg_tapped/keg_kicked triggers hook (the swap wizard above is the other).
    // Scoped to an actual TRANSITION (status !== keg.status) so re-PATCHing the same
    // status doesn't spuriously re-fire, and to a keg with a known tapId (an 'on_deck'
    // keg's status can't reach 'on_tap'/'kicked' through this route in practice, but
    // `tapId` is nullable on the type, so this guard is defensive).
    if (body.status !== keg.status && keg.tapId !== null) {
      const ts = new Date().toISOString();
      if (body.status === 'kicked') {
        app.ctx.bus.emit('keg_kicked', { tapId: keg.tapId, kegId: keg.id, beerId: keg.beerId, ts });
      } else if (body.status === 'on_tap') {
        app.ctx.bus.emit('keg_tapped', { tapId: keg.tapId, kegId: keg.id, beerId: keg.beerId, ts });
      }
    }
    return getKeg(db, keg.id);
  });
  // DELETE /api/kegs/:id — removes a queued on-deck keg from its tap's queue (Task 5's
  // on-deck "remove" action). `removeOnDeckKeg` (db/kegs.ts) 404s for an unknown id and
  // throws ValidationError (400) for any keg not currently 'on_deck' — a tapped/kicked/
  // archived keg is real history, not a queue entry, and is never deletable this way.
  app.delete('/api/kegs/:id', editor, async (req, reply) => {
    removeOnDeckKeg(db, Number((req.params as any).id));
    return reply.code(204).send();
  });

  // --- monitors ---
  // Every response below is run through sanitizeMonitor() — meta.deviceKey (the mdash
  // DEVICE_PUBLIC_KEY) must never leave the server; see that function's doc comment in
  // db/monitors.ts for why (a viewer holding it could call mdash.net directly with full
  // device RPC control, bypassing the editor-role gate on routes/kegtron.ts).
  // Each monitor also carries `deviceKeg` — the size/starting volume the Kegtron device
  // itself reports (set in Kegtron's own app) — so the swap wizard can prefill from it.
  app.get('/api/monitors', viewer, async () => listMonitors(db).map((m) => ({
    ...sanitizeMonitor(m),
    deviceKeg: app.ctx.state.deviceKegInfo(
      { type: m.type, identifier: m.identifier, portIndex: m.portIndex },
    ),
  })));
  app.post('/api/monitors/:id/bind', editor, async (req) => {
    const body = z.object({ tapId: z.number().int().nullable() }).parse(req.body);
    const mon = bindMonitorToTap(db, Number((req.params as any).id), body.tapId);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return sanitizeMonitor(mon);
  });

  // GET /api/monitors/:id/telemetry?hours=24 — the Monitors page's per-Pro-device temp/
  // humidity history (Task 6): viewer role (read-only, same as the rest of the telemetry
  // surface), reuses listTelemetry (db/telemetry.ts) as-is rather than a bespoke query.
  // `hours` bounds the lookback window: 1-168 (a week) — wide enough for any near-term
  // sparkline, narrow enough that an unbounded `?hours=` can't force a full-table scan.
  const telemetryQuerySchema = z.object({
    hours: z.coerce.number().int().min(1).max(168).default(24),
  });
  app.get('/api/monitors/:id/telemetry', viewer, async (req) => {
    const monitorId = Number((req.params as any).id);
    if (!getMonitorById(db, monitorId)) throw new NotFoundError('monitor');
    const { hours } = telemetryQuerySchema.parse(req.query);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return listTelemetry(db, monitorId, since);
  });

  // --- pours ---
  app.get('/api/pours', viewer, async (req) => {
    const q = z.object({
      kegId: z.coerce.number().int().optional(),
      since: z.string().optional(), until: z.string().optional(),
      limit: z.coerce.number().int().max(2000).optional(),
    }).parse(req.query);
    return listPours(db, q);
  });

  // PATCH /api/pours/:id/drinker — admin reassign/unclaim (Phase 5 Task 0, editor role:
  // matches this app's "viewer reads, editor writes" binding). Unlike the public
  // `POST /api/public/claim` route (routes/public.ts), this is NOT scoped to
  // currently-unclaimed pours and NEVER 409s on an existing claim — an editor fixing a
  // mis-claimed pour (or clearing one) is exactly the "override" case that route
  // deliberately doesn't allow. `drinkerId: null` unclaims.
  app.patch('/api/pours/:id/drinker', editor, async (req) => {
    const body = z.object({ drinkerId: z.number().int().nullable() }).parse(req.body);
    assertValidDrinkerId(db, body.drinkerId);
    const pour = setPourDrinker(db, Number((req.params as any).id), body.drinkerId);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return pour;
  });

  // --- walls ---
  // `config` is validated separately via wallConfigSchema.parse rather than
  // embedded as wallConfigSchema.default({}) here: TS strict rejects `{}` as a
  // default value because it doesn't structurally match the schema's fully-
  // resolved *output* type (defaults are a runtime-only concept to the type
  // checker), so the outer schema passes config through untyped and the inner
  // schema fills/validates it explicitly below.
  const wallSchema = z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1),
    config: z.unknown().optional(),
  });
  app.get('/api/walls', viewer, async () =>
    db.prepare('SELECT * FROM walls').all()
      .map((r: any) => ({ id: r.id, slug: r.slug, name: r.name, config: JSON.parse(r.config) })));
  // Interface list specifies GET/PATCH/DELETE /api/walls/:id (unlike taps/kegs,
  // where the table has no single-item GET) — added even though the brief's
  // sample code omitted it.
  app.get('/api/walls/:id', viewer, async (req) => {
    const r = db.prepare('SELECT * FROM walls WHERE id = ?')
      .get(Number((req.params as any).id)) as any;
    if (!r) throw new NotFoundError('wall');
    return { id: r.id, slug: r.slug, name: r.name, config: JSON.parse(r.config) };
  });
  app.post('/api/walls', editor, async (req, reply) => {
    const body = wallSchema.parse(req.body);
    return reply.code(201).send(createWall(db, body));
  });
  app.patch('/api/walls/:id', editor, async (req) => {
    const id = Number((req.params as any).id);
    const existing = db.prepare('SELECT * FROM walls WHERE id = ?').get(id) as any;
    if (!existing) throw new NotFoundError('wall');
    const body = wallSchema.partial().parse(req.body);
    const config = body.config !== undefined
      ? wallConfigSchema.parse(body.config)
      : JSON.parse(existing.config);
    db.prepare('UPDATE walls SET slug = ?, name = ?, config = ? WHERE id = ?')
      .run(body.slug ?? existing.slug, body.name ?? existing.name,
        JSON.stringify(config), id);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return { id, slug: body.slug ?? existing.slug, name: body.name ?? existing.name, config };
  });
  app.delete('/api/walls/:id', editor, async (req, reply) => {
    db.prepare('DELETE FROM walls WHERE id = ?').run(Number((req.params as any).id));
    return reply.code(204).send();
  });

  // --- users ---
  // NOT a z.discriminatedUnion: clients omit drinkerOnly for login users, and a
  // defaulted discriminator key does not resolve reliably — branch explicitly.
  const drinkerOnlySchema = z.object({
    drinkerOnly: z.literal(true), displayName: z.string().min(1),
    avatarColor: z.string().optional(),
  });
  const loginUserSchema = z.object({
    username: z.string().min(1), displayName: z.string().min(1),
    password: z.string().min(8), role: z.enum(['admin', 'editor', 'viewer']),
  });
  app.get('/api/users', admin, async () => listUsers(db));
  app.post('/api/users', admin, async (req, reply) => {
    const raw = req.body as { drinkerOnly?: unknown } | null;
    const user = raw?.drinkerOnly === true
      ? createDrinker(db, drinkerOnlySchema.parse(raw))
      : createUser(db, loginUserSchema.parse(raw));
    return reply.code(201).send(user);
  });
  app.patch('/api/users/:id', admin, async (req) =>
    updateUser(db, Number((req.params as any).id), z.object({
      displayName: z.string().optional(), role: z.enum(['admin', 'editor', 'viewer']).optional(),
      password: z.string().min(8).optional(), avatarColor: z.string().nullish(),
      isDrinker: z.boolean().optional(),
    }).parse(req.body)));
  app.delete('/api/users/:id', admin, async (req, reply) => {
    deleteUser(db, Number((req.params as any).id));
    return reply.code(204).send();
  });

  // --- settings ---
  app.get('/api/settings', admin, async () => app.ctx.settings.masked());
  app.patch('/api/settings', admin, async (req) => {
    const body = settingsSchema.partial().parse(req.body);
    // zod v4's `.partial()` fills every OMITTED key with that field's schema default
    // (not "leave unset" — verified directly against this repo's zod version), so
    // `body`/`sanitized` below always carry every Settings key regardless of what the
    // client actually sent. `requestedKeys` — the literal top-level keys present on the
    // raw request body — is what both the write loop and the restart-key check must
    // scope to; iterating `sanitized`'s keys directly would silently reset every
    // NOT-sent field back to its schema default on every single PATCH (e.g. a bare
    // `{siteName: 'x'}` PATCH would wipe an already-configured `kegtronApiKey` back to
    // null) and would also make `restartSources` spuriously true on every PATCH.
    const requestedKeys = new Set(Object.keys(req.body as Record<string, unknown>));
    // A GET body round-tripped straight back through PATCH carries masked
    // secret placeholders ('••••...'); sanitizePatch drops/merges those so
    // they never overwrite the real stored secrets (see settings.ts).
    const sanitized = app.ctx.settings.sanitizePatch(body);
    const restartSources = SOURCE_RESTART_KEYS.some((k) => requestedKeys.has(k) && k in sanitized);
    for (const [k, v] of Object.entries(sanitized)) {
      if (!requestedKeys.has(k)) continue;
      app.ctx.settings.set(k as any, v as any);
    }
    // Only restart a source set that's actually live — `isStarted()` is false in every
    // test that builds the app with the default `startSources: false` and never
    // manually starts sources, so an incidental PATCH there (e.g. existing tests that
    // set a fake kegtronApiKey) never spins up a real KegtronCloudSource against the
    // live mdash.net API. In production this is always true by the time an
    // authenticated PATCH can reach this route (index.ts always passes
    // startSources: true). See task-8-report.md "Deviations".
    if (restartSources && app.ctx.sources.isStarted()) {
      await app.ctx.sources.stopAll();
      registerConfiguredSources(app.ctx);
      await app.ctx.sources.startAll();
    }
    return app.ctx.settings.masked();
  });
}
