import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  createBeer, listBeers, getBeer, updateBeer, deleteBeer,
} from '../db/beers.js';
import { createTap, listTaps, updateTap, deleteTap, getTap } from '../db/taps.js';
import {
  listKegs, getKeg, swapKeg, createKeg, listOnDeckForTap, removeOnDeckKeg, getActiveKegForTap,
  type Keg,
} from '../db/kegs.js';
import {
  listMonitors, bindMonitorToTap, sanitizeMonitor, getMonitorById,
} from '../db/monitors.js';
import { listTelemetryForDevice } from '../db/telemetry.js';
import { sensorSummaries } from '../db/sensors.js';
import {
  listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
  supplierPriceBook, supplierStats,
} from '../db/suppliers.js';
import { listWallDevices, setWallDevices } from '../db/wallDevices.js';
import { listPours } from '../db/pours.js';
import {
  createUser, createDrinker, listUsers, updateUser, deleteUser, deleteSessionsForUser,
} from '../db/users.js';
import { hashToken } from '../core/auth.js';
import { wallConfigSchema, parseWallConfig } from '../core/wallConfig.js';
import { settingsSchema } from '../db/settings.js';
import { countFaceEmbeddingsByDrinker, deleteFaceEmbeddingsForDrinker } from '../db/faceEmbeddings.js';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';
import { restartSourcesIfLive } from '../ingest/bootstrap.js';
import { setPourDrinker } from '../db/pours.js';
import { SOURCE_RESTART_KEYS } from '../core/restartKeys.js';
import { deleteLabelIfUnreferenced } from '../core/labelStore.js';
import { join } from 'node:path';

// labelImage must be an app-managed upload path (`/labels/<uuid>.<ext>`), never an
// arbitrary URL — otherwise an editor could point it at a third-party host and turn every
// public wall view into a beacon leaking the venue's IP/User-Agent. `downloadAndStoreLabel`
// and the upload endpoint both already produce exactly this shape; `null` clears it.
const LABEL_IMAGE_RE = /^\/labels\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;

const beerSchema = z.object({
  name: z.string().min(1),
  brewery: z.string().nullish(), style: z.string().nullish(),
  abv: z.number().nullish(), ibu: z.number().nullish(), srm: z.number().nullish(),
  description: z.string().nullish(),
  labelImage: z.string().regex(LABEL_IMAGE_RE, 'labelImage must be an uploaded /labels path').nullish(),
  // Owner-only pricing knobs. db/beers.ts has persisted these since the pricing feature
  // landed, but zod's unknown-key stripping dropped them here, so the admin form's
  // per-beer markup override 200'd without ever applying. Public serialization is
  // unaffected: toPublicTapState nulls both before any public payload.
  markupOverridePct: z.number().min(0).nullish(),
  exclusiveSupplierId: z.number().int().positive().nullish(),
});

/** Parses a `:id` route param to a positive integer, turning `NaN` (e.g. `/api/beers/abc`)
 * into a clean 400 via the ZodError handler instead of a bare-thrown 500 from better-sqlite3. */
function parseId(params: unknown): number {
  return z.coerce.number().int().parse((params as { id?: unknown }).id);
}

export interface Wall { id: number; slug: string; name: string; config: unknown }

export function getWallBySlug(db: any, slug: string): Wall | null {
  const r = db.prepare('SELECT * FROM walls WHERE slug = ?').get(slug);
  return r ? { id: r.id, slug: r.slug, name: r.name, config: parseWallConfig(JSON.parse(r.config)) } : null;
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

/**
 * Seed a default `main` wall on first run so a freshly-installed display (`/wall/main`) resolves and
 * renders immediately, instead of a not-found page, before anyone opens the admin wizard. Idempotent:
 * only seeds when there are NO walls at all. The first-run WelcomePage's own `createWall('main')`
 * already tolerates a pre-existing `main` (409 → use existing), so this never collides.
 */
export function ensureDefaultWall(db: any): Wall | null {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM walls').get() as { n: number };
  if (n > 0) return null;
  return createWall(db, { slug: 'main', name: 'Kegwall' });
}

export async function crudRoutes(app: FastifyInstance, dataDir = './data') {
  const db = app.ctx.db;
  const labelsDir = join(dataDir, 'labels');
  const viewer = { preHandler: requireRole('viewer') };
  const editor = { preHandler: requireRole('editor') };
  const admin = { preHandler: requireRole('admin') };

  // --- beers ---
  app.get('/api/beers', viewer, async () => listBeers(db));
  app.post('/api/beers', editor, async (req, reply) =>
    reply.code(201).send(createBeer(db, beerSchema.parse(req.body))));
  app.get('/api/beers/:id', viewer, async (req) => {
    const beer = getBeer(db, parseId(req.params));
    if (!beer) throw new NotFoundError('beer');
    return beer;
  });
  app.patch('/api/beers/:id', editor, async (req) => {
    const id = parseId(req.params);
    const before = getBeer(db, id);
    const updated = updateBeer(db, id, beerSchema.partial().parse(req.body));
    // If the label image changed, reclaim the old file (no other beer references it).
    if (before && before.labelImage !== updated.labelImage) {
      deleteLabelIfUnreferenced(db, labelsDir, before.labelImage);
    }
    return updated;
  });
  app.delete('/api/beers/:id', editor, async (req, reply) => {
    const id = parseId(req.params);
    const before = getBeer(db, id);
    deleteBeer(db, id);
    if (before) deleteLabelIfUnreferenced(db, labelsDir, before.labelImage);
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
    // Hidden taps vanish from wall/menu/HA but stay in the admin (see db/taps.ts).
    hidden: z.boolean().optional(),
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
    const tap = updateTap(db, parseId(req.params), body);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return tap;
  });
  app.delete('/api/taps/:id', editor, async (req, reply) => {
    deleteTap(db, parseId(req.params));
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
    // OWNER COST fields (redesign 4k) — optional swap-wizard cost step.
    costCents: z.number().int().min(0).nullish(),
    depositCents: z.number().int().min(0).nullish(),
    supplierId: z.number().int().positive().nullish(),
    purchasedAt: z.string().nullish(),
  }).refine(
    (v) => v.fromKegId != null || (v.beerId != null && v.sizeMl != null && v.volStartMl != null),
    { message: 'beerId, sizeMl, and volStartMl are required unless fromKegId (promoting an on-deck keg) is given' },
  );
  app.post('/api/taps/:id/swap', editor, async (req, reply) => {
    const tapId = parseId(req.params);
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
      costCents: body.costCents,
      depositCents: body.depositCents,
      supplierId: body.supplierId,
      purchasedAt: body.purchasedAt,
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
    const tapId = parseId(req.params);
    if (!getTap(db, tapId)) throw new NotFoundError('tap');
    const queue = listOnDeckForTap(db, tapId);
    return hideCostsFrom(req) ? queue.map(redactOwnerCost) : queue;
  });

  // --- kegs ---
  // Owner cost/sourcing redaction for viewer accounts (H2 follow-up to redesign 4k/4l):
  // viewer-gated keg reads null out costCents/depositCents/supplierId/purchasedAt unless
  // the owner opts viewers in via `pricing.showCostsToViewers`. Editors/admins always see
  // them (editors can already write them). Nulling — not deleting — keeps the wire shape
  // identical to an untracked keg, so clients need no special case.
  const redactOwnerCost = (k: Keg): Keg => ({
    ...k, costCents: null, depositCents: null, supplierId: null, purchasedAt: null,
  });
  const hideCostsFrom = (req: { user?: { role?: string | null } | null }): boolean =>
    req.user?.role === 'viewer' && !app.ctx.settings.get('pricing').showCostsToViewers;
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
    const kegs = listKegs(db, q);
    return hideCostsFrom(req) ? kegs.map(redactOwnerCost) : kegs;
  });
  // Admin-only keg history for the Kegs page: every keg (on tap now + past), enriched with
  // beer/tap/supplier names and owner cost/sourcing. Cost is owner-only, so admin — not viewer.
  app.get('/api/kegs/history', admin, async () => {
    const rows = db.prepare(`
      SELECT k.id, k.status, k.beer_id, b.name AS beer_name,
             k.tap_id, t.number AS tap_number, t.name AS tap_name,
             k.size_ml, k.vol_start_ml, k.vol_dispensed_ml, k.date_tapped, k.keg_type,
             k.cost_cents, k.deposit_cents, k.supplier_id, s.name AS supplier_name,
             k.purchased_at, k.created_at
      FROM kegs k
      LEFT JOIN beers b ON b.id = k.beer_id
      LEFT JOIN taps t ON t.id = k.tap_id
      LEFT JOIN suppliers s ON s.id = k.supplier_id
      ORDER BY (k.status = 'on_tap') DESC, COALESCE(k.date_tapped, k.created_at) DESC
    `).all() as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: r.id, status: r.status,
      beerId: r.beer_id, beerName: r.beer_name,
      tapId: r.tap_id, tapNumber: r.tap_number, tapName: r.tap_name,
      sizeMl: r.size_ml, volStartMl: r.vol_start_ml, volDispensedMl: r.vol_dispensed_ml,
      dateTapped: r.date_tapped, kegType: r.keg_type,
      costCents: r.cost_cents ?? null, depositCents: r.deposit_cents ?? null,
      supplierId: r.supplier_id ?? null, supplierName: r.supplier_name ?? null,
      purchasedAt: r.purchased_at ?? null, createdAt: r.created_at,
    }));
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
      // Owner cost/sourcing (redesign 4k/4l) — settable/clearable after the fact from the Kegs page,
      // independently of status (the swap wizard sets these at tap time; this edits them later).
      costCents: z.number().int().min(0).nullable().optional(),
      depositCents: z.number().int().min(0).nullable().optional(),
      supplierId: z.number().int().positive().nullable().optional(),
      purchasedAt: z.string().nullable().optional(),
    }).refine(
      (v) => [v.status, v.costCents, v.depositCents, v.supplierId, v.purchasedAt].some((x) => x !== undefined),
      { message: 'nothing to update' },
    ).parse(req.body);
    const keg = getKeg(db, parseId(req.params));
    if (!keg) throw new NotFoundError('keg');
    if (body.costCents !== undefined) {
      db.prepare('UPDATE kegs SET cost_cents = ? WHERE id = ?').run(body.costCents, keg.id);
    }
    if (body.depositCents !== undefined) {
      db.prepare('UPDATE kegs SET deposit_cents = ? WHERE id = ?').run(body.depositCents, keg.id);
    }
    if (body.supplierId !== undefined) {
      db.prepare('UPDATE kegs SET supplier_id = ? WHERE id = ?').run(body.supplierId, keg.id);
    }
    if (body.purchasedAt !== undefined) {
      db.prepare('UPDATE kegs SET purchased_at = ? WHERE id = ?').run(body.purchasedAt, keg.id);
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
    removeOnDeckKeg(db, parseId(req.params));
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
  // GET /api/sensors — one summary row per physical, enabled temperature sensor (Kegtron
  // probe + Govee), with its current reading and trailing-7-day range, for the dashboard's
  // per-sensor cards. Viewer role (read-only). No owner-cost or credential data involved.
  app.get('/api/sensors', viewer, async () => sensorSummaries(db));

  // Suppliers (redesign 4l). The supplier LIST + contact data is editor-role (the swap wizard's
  // supplier dropdown needs it). The price book + YTD spend expose OWNER COST, so those are
  // admin-only — the hard-requirement privacy boundary. Static `/stats` is declared before the
  // `/:id/*` param routes so it can't be shadowed.
  // Structured weekly hours (design 2026-08-04): all seven day keys, HH:MM times,
  // close strictly after open (HH:MM compares correctly as a string), one-line note.
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const dayHoursSchema = z.object({
    open: z.string().regex(timeRe),
    close: z.string().regex(timeRe),
  }).refine((d) => d.close > d.open, { message: 'close must be after open' }).nullable();
  const supplierHoursSchema = z.object({
    note: z.string().max(200).nullable(),
    days: z.object({
      mon: dayHoursSchema, tue: dayHoursSchema, wed: dayHoursSchema, thu: dayHoursSchema,
      fri: dayHoursSchema, sat: dayHoursSchema, sun: dayHoursSchema,
    }),
  });
  const supplierSchema = z.object({
    name: z.string().min(1).max(120),
    contactName: z.string().max(120).nullish(),
    phone: z.string().max(60).nullish(),
    email: z.string().max(200).nullish(),
    address: z.string().max(400).nullish(),
    hours: supplierHoursSchema.nullish(),
    deliveryNotes: z.string().max(1000).nullish(),
    notes: z.string().max(2000).nullish(),
  });
  app.get('/api/suppliers', editor, async () => listSuppliers(db));
  app.get('/api/suppliers/stats', admin, async () => supplierStats(db));
  app.get('/api/suppliers/:id/pricebook', admin, async (req) => {
    const id = parseId(req.params);
    if (!getSupplier(db, id)) throw new NotFoundError('supplier');
    return supplierPriceBook(db, id);
  });
  app.post('/api/suppliers', editor, async (req, reply) => {
    const supplier = createSupplier(db, supplierSchema.parse(req.body));
    reply.code(201);
    return supplier;
  });
  app.patch('/api/suppliers/:id', editor, async (req) => (
    updateSupplier(db, parseId(req.params), supplierSchema.parse(req.body))
  ));
  app.delete('/api/suppliers/:id', admin, async (req, reply) => {
    deleteSupplier(db, parseId(req.params));
    reply.code(204);
  });

  app.post('/api/monitors/:id/bind', editor, async (req) => {
    const body = z.object({ tapId: z.number().int().nullable() }).parse(req.body);
    const id = parseId(req.params);
    // Govee sensors measure the room, not a keg line — binding one to a tap would
    // feed nonsense into pour attribution. The UI never offers it; guard the API too.
    const target = getMonitorById(db, id);
    if (target?.type === 'govee_sensor') {
      throw new ValidationError('a Govee sensor cannot be bound to a tap');
    }
    const mon = bindMonitorToTap(db, id, body.tapId);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    // Bindings feed allowedTapIdsForWall — open wall clients must refetch too.
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
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
  // Device-wide: any port row of a device answers with the whole device's telemetry
  // (Kegtron reports temp once per device, recorded on the port-0 row).
  app.get('/api/monitors/:id/telemetry', viewer, async (req) => {
    const monitorId = parseId(req.params);
    const mon = getMonitorById(db, monitorId);
    if (!mon) throw new NotFoundError('monitor');
    const { hours } = telemetryQuerySchema.parse(req.query);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return listTelemetryForDevice(db, mon.type, mon.identifier, since);
  });

  // --- pours ---
  app.get('/api/pours', viewer, async (req) => {
    const q = z.object({
      kegId: z.coerce.number().int().optional(),
      since: z.string().optional(), until: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(2000).optional(),
      unclaimed: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
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
    const pour = setPourDrinker(db, parseId(req.params), body.drinkerId);
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
      .map((r: any) => ({ id: r.id, slug: r.slug, name: r.name, config: parseWallConfig(JSON.parse(r.config)) })));
  // Interface list specifies GET/PATCH/DELETE /api/walls/:id (unlike taps/kegs,
  // where the table has no single-item GET) — added even though the brief's
  // sample code omitted it.
  app.get('/api/walls/:id', viewer, async (req) => {
    const r = db.prepare('SELECT * FROM walls WHERE id = ?')
      .get(parseId(req.params)) as any;
    if (!r) throw new NotFoundError('wall');
    return { id: r.id, slug: r.slug, name: r.name, config: parseWallConfig(JSON.parse(r.config)) };
  });
  app.post('/api/walls', editor, async (req, reply) => {
    const body = wallSchema.parse(req.body);
    return reply.code(201).send(createWall(db, body));
  });
  app.patch('/api/walls/:id', editor, async (req) => {
    const id = parseId(req.params);
    const existing = db.prepare('SELECT * FROM walls WHERE id = ?').get(id) as any;
    if (!existing) throw new NotFoundError('wall');
    const body = wallSchema.partial().parse(req.body);
    const config = body.config !== undefined
      ? wallConfigSchema.parse(body.config)
      : parseWallConfig(JSON.parse(existing.config));
    db.prepare('UPDATE walls SET slug = ?, name = ?, config = ? WHERE id = ?')
      .run(body.slug ?? existing.slug, body.name ?? existing.name,
        JSON.stringify(config), id);
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    return { id, slug: body.slug ?? existing.slug, name: body.name ?? existing.name, config };
  });
  app.delete('/api/walls/:id', editor, async (req, reply) => {
    const id = parseId(req.params);
    // `displays.wall_id REFERENCES walls(id)` with no ON DELETE clause (migration 008), so
    // a bare DELETE for a wall a display still points at raises
    // SQLITE_CONSTRAINT_FOREIGNKEY, which `mapSqliteError` (app.ts) renders as a 400
    // "Refers to a record that does not exist" — backwards here (the wall is the record
    // being referred TO, and it very much exists). Pre-check and 409 with the actual
    // blockers named instead, matching `deleteTap`'s precedent in db/taps.ts. Unlike a
    // tap's keg history, an assigned display IS fixable from the admin UI (Displays →
    // edit → wall), so the message says how.
    const assigned = db.prepare('SELECT name FROM displays WHERE wall_id = ? ORDER BY name')
      .all(id) as { name: string }[];
    if (assigned.length > 0) {
      const names = assigned.map((d) => `"${d.name}"`).join(', ');
      throw new ConflictError(
        `wall ${id} is still assigned to display(s) ${names} — unassign the display(s) first`);
    }
    // wall_devices rows go with it via ON DELETE CASCADE (migration 011).
    db.prepare('DELETE FROM walls WHERE id = ?').run(id);
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    return reply.code(204).send();
  });

  // --- wall devices (device→wall scoping) ---
  // A wall shows only taps bound to ports of its assigned devices; no devices = no
  // taps (strict). The assignment propagates to TVs the way wall-config edits do:
  // the PUT emits state_changed (scope 'walls') now, and the resolved allowedTapIds
  // ride the /api/public/wall payload, refetched by open clients on walls_changed.
  const wallDevicesBody = z.object({
    devices: z.array(z.object({
      type: z.enum(['kegtron_pro', 'kegtron_gen1']),
      identifier: z.string().min(1),
    })).max(100),
  });
  const requireWall = (id: number) => {
    if (!db.prepare('SELECT id FROM walls WHERE id = ?').get(id)) throw new NotFoundError('wall');
  };
  app.get('/api/walls/:id/devices', viewer, async (req) => {
    const id = parseId(req.params);
    requireWall(id);
    return listWallDevices(db, id);
  });
  app.put('/api/walls/:id/devices', editor, async (req) => {
    const id = parseId(req.params);
    requireWall(id);
    const { devices } = wallDevicesBody.parse(req.body);
    for (const d of devices) {
      const known = db.prepare(
        'SELECT 1 FROM monitors WHERE type = ? AND identifier = ? LIMIT 1')
        .get(d.type, d.identifier);
      if (!known) throw new ValidationError(`unknown device ${d.type}:${d.identifier}`);
    }
    const stored = setWallDevices(db, id, devices);
    app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    return stored;
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
      : await createUser(db, loginUserSchema.parse(raw));
    return reply.code(201).send(user);
  });
  app.patch('/api/users/:id', admin, async (req) => {
    const id = parseId(req.params);
    const body = z.object({
      displayName: z.string().optional(), role: z.enum(['admin', 'editor', 'viewer']).optional(),
      password: z.string().min(8).optional(), avatarColor: z.string().nullish(),
      isDrinker: z.boolean().optional(),
    }).parse(req.body);
    const user = await updateUser(db, id, body);
    if (body.password !== undefined) {
      // A password change must revoke the user's live sessions — they're validated purely
      // by token lookup (core/auth.ts), so a stolen cookie would otherwise keep working
      // for the rest of its 30-day life after the reset. When an admin resets their OWN
      // password, the acting session is spared so the change doesn't log them out;
      // resetting someone ELSE's password (the "kick out whoever has that account" case)
      // kills every one of that user's sessions. Role changes need none of this: role is
      // re-read from the users row on every request.
      const token = req.cookies?.session;
      const keepHash = req.user?.id === id && token ? hashToken(token) : undefined;
      deleteSessionsForUser(db, id, keepHash);
    }
    return user;
  });
  app.delete('/api/users/:id', admin, async (req, reply) => {
    deleteUser(db, parseId(req.params));
    return reply.code(204).send();
  });

  // --- faces (Task 9, Plan B): admin face-data management -----------------------------
  // GET /api/faces/counts — per-drinker enrolled face-sample count, admin role (same
  // gate as the rest of the users surface above). Feeds the Users page's "N face
  // samples" + "Delete face data" affordance; removal itself reuses the public
  // DELETE /api/public/faces/drinker/:id (routes/public.ts — works even while
  // faceSignIn is disabled, since deleting is a privacy action, not a sign-in one).
  // Drinkers with zero samples are simply absent from the array (see
  // countFaceEmbeddingsByDrinker, db/faceEmbeddings.ts), never a `{count: 0}` row.
  app.get('/api/faces/counts', admin, async () =>
    Array.from(countFaceEmbeddingsByDrinker(db), ([drinkerId, count]) => ({ drinkerId, count })));

  // Admin-initiated face-data deletion (the Users page "Delete face data" action). The
  // public self-service delete is bound to the armed kiosk pourer; an admin isn't at the
  // kiosk, so they delete anyone's enrollment here, gated by the admin role.
  app.delete('/api/faces/drinker/:id', admin, async (req) => {
    const drinkerId = parseId(req.params);
    const deleted = deleteFaceEmbeddingsForDrinker(db, drinkerId);
    if (deleted > 0) app.ctx.bus.emit('state_changed', { scope: 'faces', ts: new Date().toISOString() });
    return { deleted };
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
    // Task 6: the stop/reconfigure/start cycle (with its `isStarted()`-is-false-in-tests
    // rationale) now lives in `ingest/bootstrap.ts`'s `restartSourcesIfLive` -- shared
    // verbatim with `routes/presence.ts`'s motion-source CRUD routes, see that helper's
    // doc comment. See task-8-report.md "Deviations" for the original rationale.
    if (restartSources) {
      await restartSourcesIfLive(app.ctx);
    }
    // displayUnits (and siteName) ride the wall payload — nudge open wall clients.
    if (requestedKeys.has('displayUnits') || requestedKeys.has('siteName')) {
      app.ctx.bus.emit('state_changed', { scope: 'walls', ts: new Date().toISOString() });
    }
    return app.ctx.settings.masked();
  });
}
