import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  createBeer, listBeers, getBeer, updateBeer, deleteBeer,
} from '../db/beers.js';
import { createTap, listTaps, updateTap, deleteTap, getTap } from '../db/taps.js';
import { listKegs, getKeg, swapKeg, createKeg } from '../db/kegs.js';
import { listMonitors, bindMonitorToTap, sanitizeMonitor } from '../db/monitors.js';
import { listPours } from '../db/pours.js';
import {
  createUser, createDrinker, listUsers, updateUser, deleteUser,
} from '../db/users.js';
import { wallConfigSchema } from '../core/wallConfig.js';
import { settingsSchema, type Settings } from '../db/settings.js';
import { NotFoundError } from '../core/errors.js';
import { registerConfiguredSources } from '../ingest/bootstrap.js';

// Settings fields whose value actually changes which ingest sources should be running
// (see bootstrap.ts's registerConfiguredSources) — a PATCH touching any of these
// triggers a live stop/reconfigure/restart cycle of ctx.sources (Task 8 brief).
const SOURCE_RESTART_KEYS: readonly (keyof Settings)[] = [
  'kegtronApiKey', 'udpEnabled', 'mqtt', 'bleDirectEnabled',
];

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
  const tapSchema = z.object({ number: z.number().int().min(1), name: z.string().nullish() });
  app.get('/api/taps', viewer, async () => listTaps(db));
  app.post('/api/taps', editor, async (req, reply) =>
    reply.code(201).send(createTap(db, tapSchema.parse(req.body))));
  app.patch('/api/taps/:id', editor, async (req) =>
    updateTap(db, Number((req.params as any).id), tapSchema.partial().parse(req.body)));
  app.delete('/api/taps/:id', editor, async (req, reply) => {
    deleteTap(db, Number((req.params as any).id));
    return reply.code(204).send();
  });

  // --- keg swap ---
  const swapSchema = z.object({
    beerId: z.number().int(), sizeMl: z.number().int().positive(),
    volStartMl: z.number().int().positive(),
  });
  app.post('/api/taps/:id/swap', editor, async (req, reply) => {
    const tapId = Number((req.params as any).id);
    if (!getTap(db, tapId)) throw new NotFoundError('tap');
    const body = swapSchema.parse(req.body);
    const keg = swapKeg(db, { tapId, newBeerId: body.beerId, ...body });
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return reply.code(201).send(keg);
  });

  // --- kegs ---
  const kegCreateSchema = z.object({
    beerId: z.number().int(), sizeMl: z.number().int().positive(),
    volStartMl: z.number().int().positive(), tapId: z.number().int().nullish(),
  });
  app.get('/api/kegs', viewer, async (req) => {
    const q = z.object({ status: z.enum(['on_tap', 'kicked', 'archived']).optional() })
      .parse(req.query);
    return listKegs(db, q);
  });
  app.post('/api/kegs', editor, async (req, reply) =>
    reply.code(201).send(createKeg(db, kegCreateSchema.parse(req.body))));
  app.patch('/api/kegs/:id', editor, async (req) => {
    const body = z.object({ status: z.enum(['on_tap', 'kicked', 'archived']) }).parse(req.body);
    const keg = getKeg(db, Number((req.params as any).id));
    if (!keg) throw new NotFoundError('keg');
    db.prepare('UPDATE kegs SET status = ? WHERE id = ?').run(body.status, keg.id);
    return getKeg(db, keg.id);
  });

  // --- monitors ---
  // Every response below is run through sanitizeMonitor() — meta.deviceKey (the mdash
  // DEVICE_PUBLIC_KEY) must never leave the server; see that function's doc comment in
  // db/monitors.ts for why (a viewer holding it could call mdash.net directly with full
  // device RPC control, bypassing the editor-role gate on routes/kegtron.ts).
  app.get('/api/monitors', viewer, async () => listMonitors(db).map(sanitizeMonitor));
  app.post('/api/monitors/:id/bind', editor, async (req) => {
    const body = z.object({ tapId: z.number().int().nullable() }).parse(req.body);
    const mon = bindMonitorToTap(db, Number((req.params as any).id), body.tapId);
    app.ctx.bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
    return sanitizeMonitor(mon);
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
