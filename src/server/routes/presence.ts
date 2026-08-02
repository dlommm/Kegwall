import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { motionSourceSchema, parseMotionSources } from '../db/settings.js';
import { parseWallConfig } from '../core/wallConfig.js';
import { NotFoundError } from '../core/errors.js';
import { restartSourcesIfLive } from '../ingest/bootstrap.js';

const DEFAULT_PING_INTERVAL_MS = 30_000;

export interface PresenceRoutesOptions { pingIntervalMs?: number }

/** Presence wake surfaces (spec Part A/A2-A3): the token-gated external motion webhook
 * + agent SSE stream, and the public user-interaction wake endpoint (same trust level
 * as the wall pages themselves — worst case someone turns screens ON). Task 3 adds the
 * admin-only motion-source CRUD/status surface and explicit display-state override. */
export async function presenceRoutes(app: FastifyInstance, opts: PresenceRoutesOptions = {}) {
  const db = app.ctx.db;
  // Same `requireRole('admin')` guard idiom as routes/crud.ts:75 — replicated rather than
  // imported as an object (crud.ts's `admin` binding is module-private) since both route
  // modules are called directly (not `app.register()`'d, see app.ts) against the same
  // Fastify instance, so `requireRole` itself (the actual auth logic, from './auth.js')
  // is the only piece that needs to be shared; the tiny `{ preHandler }` wrapper is
  // cheaper to duplicate than to plumb out of crud.ts.
  const admin = { preHandler: requireRole('admin') };

  const requireToken = (token: unknown): { code: number; error: string } | null => {
    const expected = app.ctx.settings.get('presenceWebhookToken');
    if (!expected) return { code: 503, error: 'presence token not configured' };
    if (token !== expected) return { code: 401, error: 'bad token' };
    return null;
  };

  const pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;

  // Open SSE connections (task-5 review F2): a stream still open when the app closes
  // (e.g. an admin/kiosk tab connected during a server restart, or — as the review's
  // probe found — simply every open connection in a test that doesn't explicitly
  // cancel its reader first) must not leak its bus subscription, ping timer, or raw
  // socket past `app.close()`. Every other per-connection resource in this app (wsRoutes'
  // `clients` set) is torn down the same way: tracked in a registration-scoped collection,
  // reaped by a single `onClose` hook below.
  interface OpenStream {
    wall: string; // Task 3: lets GET /api/presence/sources report live agent counts per wall.
    unsubscribe: () => void;
    ping: ReturnType<typeof setInterval>;
    raw: import('node:http').ServerResponse;
  }
  const openStreams = new Set<OpenStream>();

  app.post('/api/presence/motion', async (req, reply) => {
    const { token, source } = z.object({
      token: z.string().optional(),
      // Task 3: which configured motionSources entry fired this webhook, if any — routed
      // through the registry (ctx.motion.trigger) instead of calling presence.motion()
      // directly, so lastTriggeredAt bookkeeping and the unknown-id "wake everything"
      // fallback both live in exactly one place (core/motionSources.ts).
      source: z.string().optional(),
    }).parse(req.query);
    const denied = requireToken(token);
    if (denied) return reply.code(denied.code).send({ error: denied.error });
    app.ctx.motion.trigger(source ?? null);
    return { ok: true };
  });

  app.post('/api/presence/wake', async (req) => {
    const { wall, source } = z.object({
      wall: z.string().optional(),
      source: z.enum(['touch', 'camera']).default('touch'),
    }).parse(req.body ?? {});
    if (source === 'camera') {
      // Task 3 / final-review I2: routes through the registry's camera sentinel (see
      // core/motionSources.ts) ONLY when `wall` is both present and a real, currently-
      // configured wall slug (`presence.stateOf(wall) !== undefined` -- the same
      // "does this wall actually exist" check the SSE stream route already uses) — that's
      // the one case where `trigger('camera:' + wall)` stamps a real, bounded
      // `camera:<slug>` status entry an admin can see. A GARBAGE wall string (never a
      // configured wall) used to stamp the registry's status Map keyed by that raw
      // client-controlled string forever — unbounded growth from arbitrary public input.
      // No wall, OR an unrecognized one, wakes that slug (or, with no wall at all, every
      // wall) directly via `presence.motion()` — no registry stamp, and critically no
      // `trigger(null)` fallback either: that fallback used to tag the resulting
      // `motion_detected` event's source as `'webhook'`, mislabeling a genuine camera wake.
      if (wall !== undefined && app.ctx.presence.stateOf(wall) !== undefined) {
        app.ctx.motion.trigger(`camera:${wall}`);
      } else {
        app.ctx.presence.motion(wall ?? null, 'camera');
      }
    } else {
      app.ctx.presence.motion(wall ?? null, source);
    }
    return { ok: true };
  });

  // POST /api/presence/state — admin override (Task 3): lets the admin UI force a wall
  // (or, with no `wall`, every wall) into a specific power stage on demand, independent
  // of any motion wake. `presence.setState` already holds the stage until the next
  // motion (no idle timer re-armed), same semantics as a screensaver-triggered 'off'.
  app.post('/api/presence/state', admin, async (req) => {
    const { wall, state } = z.object({
      wall: z.string().optional(),
      state: z.enum(['active', 'screensaver', 'off']),
    }).parse(req.body);
    app.ctx.presence.setState(wall ?? null, state);
    return { ok: true };
  });

  // --- motion-source CRUD/status (Task 3) ---------------------------------------------
  // Every write below (create/patch/delete) ends with `restartSourcesIfLive` (Task 6,
  // `ingest/bootstrap.ts`) — the same stop/reconfigure/start cycle `routes/crud.ts`'s
  // settings PATCH runs for a `SOURCE_RESTART_KEYS` change, reused here (not
  // duplicated) so a motion source add/edit/remove here ALSO reconfigures the live
  // GPIO/BLE/mqtt transports; see that helper's doc comment for the `isStarted()` guard
  // rationale.
  // GET /api/presence/sources: the admin Sources page's single read — configured sources
  // (registry snapshot via `snapshotAll()`, EVERY valid source regardless of `enabled` —
  // final-review C2: this is the only management surface a disabled source has, so it
  // must stay listed/editable rather than vanish; transport gating still reads the
  // enabled-only `sources()` in ingest/bootstrap.ts, untouched), derived camera rows (one
  // per wall with displayPower.cameraMotion on, status read back from the registry's
  // `camera:<slug>` sentinel entries — see motionSources.ts's ledgered fix), and live
  // agent (open SSE stream) counts per wall.
  app.get('/api/presence/sources', admin, async () => {
    const sources = app.ctx.motion.snapshotAll();

    const walls = db.prepare('SELECT slug, config FROM walls').all() as
      { slug: string; config: string }[];
    const camera = walls
      .map((w) => ({ slug: w.slug, config: parseWallConfig(JSON.parse(w.config)) }))
      .filter((w) => w.config.displayPower.cameraMotion)
      .map((w) => ({
        wallSlug: w.slug,
        enabled: true,
        lastTriggeredAt: app.ctx.motion.statusOf(`camera:${w.slug}`).lastTriggeredAt,
      }));

    const agentCounts = new Map<string, number>();
    for (const entry of openStreams) {
      agentCounts.set(entry.wall, (agentCounts.get(entry.wall) ?? 0) + 1);
    }
    const agents = [...agentCounts.entries()].map(([wall, connections]) => ({ wall, connections }));

    return { sources, camera, agents };
  });

  app.post('/api/presence/sources', admin, async (req, reply) => {
    // Body is a MotionSource sans `id` — `crypto.randomUUID()` is a Node global (no
    // import needed, same as core/motionSources.ts's migrateMotionTopics), spread AFTER
    // the body so a client-supplied `id` (there shouldn't be one, but the type is
    // Record<string, unknown> here, not yet validated) can never override the generated
    // one. motionSourceSchema.parse validates the whole shape, including the per-type
    // `config` requirement (mqtt needs topic+match, gpio needs line).
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const source = motionSourceSchema.parse({ ...raw, id: crypto.randomUUID() });
    const existing = parseMotionSources(app.ctx.settings.get('motionSources') as unknown[]);
    app.ctx.settings.set('motionSources', [...existing, source]);
    await restartSourcesIfLive(app.ctx);
    return reply.code(201).send(source);
  });

  app.patch('/api/presence/sources/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    const existing = parseMotionSources(app.ctx.settings.get('motionSources') as unknown[]);
    const idx = existing.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundError('motion source');
    // Shallow top-level merge (patch fields replace the corresponding whole field, e.g. a
    // full `config` object) — the same "client sends back a full sub-object" idiom
    // settings.sanitizePatch uses, not a deep merge. Re-parsed through the same schema as
    // create so a patch can't leave a source in an invalid per-type shape. `id` is
    // spread LAST (final-review I1) — the path id always wins over anything the body
    // carries (there's no legitimate reason for a PATCH body to include an `id` at all,
    // but nothing upstream strips one before it gets here, and a body id that happened to
    // match a DIFFERENT existing source would otherwise silently reassign this row's
    // identity out from under its own webhook URL / registry status entry).
    const merged = motionSourceSchema.parse({ ...existing[idx], ...(req.body as object ?? {}), id });
    const next = [...existing];
    next[idx] = merged;
    app.ctx.settings.set('motionSources', next);
    await restartSourcesIfLive(app.ctx);
    return merged;
  });

  app.delete('/api/presence/sources/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = parseMotionSources(app.ctx.settings.get('motionSources') as unknown[]);
    // Idempotent, same as crud.ts's beer/tap/keg deletes -- an unknown id is simply a
    // no-op 204 rather than a 404.
    app.ctx.settings.set('motionSources', existing.filter((s) => s.id !== id));
    // Final-review M2: the deleted source's in-memory runtime status (health/
    // lastTriggeredAt) has no `motionSources` row to belong to anymore -- drop it too,
    // rather than leaving it to sit in the registry's status map forever.
    app.ctx.motion.forgetStatus(id);
    await restartSourcesIfLive(app.ctx);
    return reply.code(204).send();
  });

  app.get('/api/presence/stream', (req, reply) => {
    const { wall, token } = z.object({ wall: z.string(), token: z.string().optional() })
      .parse(req.query);
    const denied = requireToken(token);
    if (denied) return reply.code(denied.code).send({ error: denied.error });
    const state = app.ctx.presence.stateOf(wall);
    if (state === undefined) return reply.code(404).send({ error: 'no such wall' });

    reply.hijack(); // takes ownership of the raw response — fastify must not also try to
                     // serialize/send a body once we start writing to reply.raw ourselves
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (s: string) => reply.raw.write(`data: ${JSON.stringify({ state: s })}\n\n`);
    send(state); // on-connect replay: a reconnecting agent never sticks in a stale stage
    const unsubscribe = app.ctx.bus.on('display_power_changed', (e) => {
      if (e.wallSlug === wall) send(e.state);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), pingIntervalMs);
    const entry: OpenStream = { wall, unsubscribe, ping, raw: reply.raw };
    openStreams.add(entry);
    req.raw.on('close', () => {
      // `Set.delete` returns false if already removed — guards against the onClose hook
      // below and this handler both running their cleanup (app closing while the client
      // socket is also in the middle of tearing down).
      if (!openStreams.delete(entry)) return;
      unsubscribe();
      clearInterval(ping);
    });
  });

  app.addHook('onClose', () => {
    for (const entry of [...openStreams]) {
      if (!openStreams.delete(entry)) continue; // same double-run guard as above
      entry.unsubscribe();
      clearInterval(entry.ping);
      // Force-closes the underlying socket — plain `.end()` would leave a `keep-alive`
      // connection sitting open for Node's http.Server.close() to wait on forever, which
      // is exactly the hang the review's live probe caught.
      entry.raw.destroy();
    }
  });
}
