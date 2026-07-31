import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { createContext, type AppContext } from './context.js';
import { authRoutes } from './routes/auth.js';
import { crudRoutes } from './routes/crud.js';
import { wsRoutes } from './routes/ws.js';
import { publicRoutes } from './routes/public.js';
import { sourcesRoutes } from './routes/sources.js';
import { kegtronRoutes } from './routes/kegtron.js';
import { activityRoutes } from './routes/activity.js';
import { statsRoutes } from './routes/stats.js';
import { logsRoutes } from './routes/logs.js';
import { placesDisplaysRoutes } from './routes/placesDisplays.js';
import { featurePackRoutes } from './routes/featurePack.js';
import { uploadsRoutes } from './routes/uploads.js';
import { lookupRoutes } from './routes/lookup.js';
import { backupRoutes } from './routes/backup.js';
import { channelsRoutes } from './routes/channels.js';
import { systemRoutes } from './routes/system.js';
import { automationsRoutes } from './routes/automations.js';
import { notificationsRoutes } from './routes/notifications.js';
import { staticRoutes, labelsStaticRoutes } from './routes/static.js';
import { NotFoundError, ConflictError, ValidationError } from './core/errors.js';
import type { HostResolver } from './core/ssrfGuard.js';

/**
 * Maps a raw better-sqlite3 `SqliteError` to a clean API error shape — callers (route
 * handlers, repo functions) mostly don't pre-check constraints before inserting/updating
 * (a few hot paths do, e.g. `createKeg`'s active-tap check in db/kegs.ts, purely so THAT
 * specific case gets a nicer message), so this is the backstop that keeps a raw SQL error
 * from ever reaching a client as an opaque 500. `err.message` for a UNIQUE violation is
 * "UNIQUE constraint failed: table.column[, table.column...]" — the table/column names are
 * safe to surface (they're schema, not data), so the leading one is threaded into the
 * message. FK violations don't carry column info (SQLite's message is just "FOREIGN KEY
 * constraint failed"), so that case gets a generic-but-still-not-raw-SQL message.
 */
function mapSqliteError(err: unknown): { status: number; error: string; message: string } | null {
  if (!(err instanceof Database.SqliteError)) return null;
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    const field = /UNIQUE constraint failed: ([\w.]+)/.exec(err.message)?.[1] ?? null;
    return {
      status: 409,
      error: 'conflict',
      message: field ? `${field} already exists` : 'That value is already in use',
    };
  }
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || err.code === 'SQLITE_CONSTRAINT_TRIGGER') {
    return { status: 400, error: 'validation', message: 'Refers to a record that does not exist' };
  }
  if (err.code.startsWith('SQLITE_CONSTRAINT')) {
    return { status: 400, error: 'validation', message: 'Invalid data' };
  }
  return null;
}

declare module 'fastify' {
  interface FastifyInstance { ctx: AppContext }
}

export interface AppOptions {
  dataDir?: string;
  context?: AppContext;
  webDir?: string;
  /** Whether to actually start the registered ingest sources (Task 8's
   * `registerConfiguredSources`, always run by `createContext()`) — i.e. call
   * `ctx.sources.startAll()`. Defaults to `false` so building an app in tests never
   * opens real sockets / MQTT connections / mdash.net requests just by calling
   * `buildApp()`. Production's `index.ts` explicitly passes `true`. */
  startSources?: boolean;
  /** Overrides the `/ws` heartbeat interval (default 30s) — tests only; see `wsRoutes`. */
  wsPingIntervalMs?: number;
  /** Overrides `routes/lookup.ts`'s brewery-lookup upstream fetch timeout AND
   * `routes/kegtron.ts`'s Pro import label-download timeout (default 5s for both) —
   * tests only, same pattern as `wsPingIntervalMs` above / MdashClient's `timeoutMs`. */
  lookupTimeoutMs?: number;
  /** Overrides the remote-label-download SSRF guard's DNS resolver — tests only; see
   * `core/ssrfGuard.ts`. Applies to `routes/kegtron.ts`'s Pro import (the only caller of
   * `routes/lookup.ts`'s `downloadAndStoreLabel` since the Untappd import route it
   * originally served was removed). */
  lookupResolveHost?: HostResolver;
  /** Test-only escape hatch for that same SSRF guard — see `KegtronRoutesOptions.
   * allowInsecureHosts`'s doc comment (`routes/kegtron.ts`). Never set by `index.ts`. */
  lookupAllowInsecureHosts?: boolean;
  /** The running app version — index.ts reads it from package.json at boot. Tests
   * default to '0.0.0-dev'. Surfaces on GET /api/system/version + the update check. */
  version?: string;
  /** Overrides routes/system.ts's update-check + watchtower-trigger fetch timeouts —
   * tests only, same pattern as `lookupTimeoutMs`. */
  updateTimeoutMs?: number;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.decorate('ctx', opts.context ?? createContext(opts.dataDir ?? './data', opts.version));
  // Always torn down on close, even if startSources was never set — registering a
  // source (which createContext() always does) without ever starting it is a safe
  // no-op for every source's stop() (see e.g. cloudSource.ts's stop()), so this hook
  // is harmless for the many tests that build an app without starting sources.
  app.addHook('onClose', async () => {
    // Engine first: no point stopping sources (which would otherwise trigger a wave of
    // device_offline/state_changed events) while the engine could still be reacting to
    // them. stop() is synchronous and safe even if start() was never called.
    app.ctx.engine.stop();
    await app.ctx.sources.stopAll();
  });
  if (opts.startSources) {
    await app.ctx.sources.startAll();
    // Started alongside sources, behind the same flag — see automation/engine.ts's top
    // doc comment, point 6, for why this isn't unconditional like state.start().
    app.ctx.engine.start();
  }

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', message: err.issues.map(i => i.message).join('; ') });
    }
    if (err instanceof ValidationError) return reply.code(400).send({ error: 'validation', message: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: 'conflict', message: err.message });
    if ((err as any).statusCode === 429) return reply.send(err); // rate limit passthrough
    const mapped = mapSqliteError(err);
    if (mapped) return reply.code(mapped.status).send({ error: mapped.error, message: mapped.message });
    req.log?.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  // Route modules are called DIRECTLY, not app.register()'d: Fastify encapsulates
  // register()'d plugins, which would scope authRoutes' onRequest hook (req.user)
  // away from the other modules and break staticRoutes' setNotFoundHandler.
  await authRoutes(app);
  await crudRoutes(app);   // direct call — see encapsulation note above
  await wsRoutes(app, { pingIntervalMs: opts.wsPingIntervalMs }); // direct call —
                           // @fastify/websocket it registers internally attaches to the
                           // root instance, same reasoning as above
  await publicRoutes(app);  // direct call — see encapsulation note above
  await sourcesRoutes(app); // direct call — see encapsulation note above
  const dataDir = resolve(opts.dataDir ?? './data');
  // kegtronRoutes' Pro import handler downloads a decoded labelUrl through the same
  // SSRF-guarded path lookupRoutes uses (Phase 5 Task 0) — needs `dataDir` (for the
  // labels directory) and the same test-injectable SSRF options, so it's registered
  // here, after `dataDir` is resolved, rather than at its old spot above.
  await kegtronRoutes(app, dataDir, {
    timeoutMs: opts.lookupTimeoutMs,
    resolveHost: opts.lookupResolveHost,
    allowInsecureHosts: opts.lookupAllowInsecureHosts,
  }); // direct call — see encapsulation note above
  await activityRoutes(app); // direct call — see encapsulation note above
  await statsRoutes(app);    // direct call — see encapsulation note above
  await logsRoutes(app);     // direct call — see encapsulation note above
  await placesDisplaysRoutes(app); // direct call — see encapsulation note above
  await featurePackRoutes(app);    // direct call — see encapsulation note above
  await labelsStaticRoutes(app, dataDir); // direct call, before uploadsRoutes/staticRoutes —
                                           // see its doc comment for the decorateReply ordering
  await uploadsRoutes(app, dataDir);      // direct call — see encapsulation note above
  await lookupRoutes(app, { timeoutMs: opts.lookupTimeoutMs });
      // direct call — see encapsulation note above; must also run before staticRoutes,
      // like every route module. No longer needs `dataDir` or the SSRF-guard options —
      // its only label-download caller now is routes/kegtron.ts's Pro import above,
      // which manages its own labels dir and already received those same options.
  await backupRoutes(app, dataDir);       // direct call — see encapsulation note above;
                                           // registered AFTER uploadsRoutes because its
                                           // restore handler relies on the @fastify/
                                           // multipart decorators uploadsRoutes registers
                                           // (see backup.ts's doc comment on MAX_RESTORE_BYTES)
  await systemRoutes(app, dataDir, { updateTimeoutMs: opts.updateTimeoutMs });
                                           // direct call — see encapsulation note above;
                                           // needs the resolved dataDir (native-mode
                                           // update trigger file), same as backupRoutes
  await channelsRoutes(app);              // direct call — see encapsulation note above;
                                           // Phase 5 Task 2's send-test endpoint, reads
                                           // settings.alertChannels (already registered by
                                           // the time app.ctx exists, no dataDir/ordering
                                           // dependency on anything above)
  await automationsRoutes(app);           // direct call — see encapsulation note above;
                                           // Phase 5 Task 4's templates/CRUD/run-now
                                           // routes, reads app.ctx.engine (already
                                           // constructed by createContext by this point)
  await notificationsRoutes(app);         // direct call — see encapsulation note above;
                                           // Phase 5 Task 6's notification-center REST
                                           // surface (list/ack/ack-all/unacked-count)
  await staticRoutes(app, opts.webDir); // direct call, LAST — setNotFoundHandler inside a
                                         // register()'d plugin would not apply globally

  return app;
}
