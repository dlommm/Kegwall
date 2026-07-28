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
import { uploadsRoutes } from './routes/uploads.js';
import { lookupRoutes } from './routes/lookup.js';
import { staticRoutes, labelsStaticRoutes } from './routes/static.js';
import { NotFoundError, ConflictError, ValidationError } from './core/errors.js';

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
  /** Overrides `routes/lookup.ts`'s upstream fetch timeout (default 5s) — tests only,
   * same pattern as `wsPingIntervalMs` above / MdashClient's `timeoutMs`. */
  lookupTimeoutMs?: number;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.decorate('ctx', opts.context ?? createContext(opts.dataDir ?? './data'));
  // Always torn down on close, even if startSources was never set — registering a
  // source (which createContext() always does) without ever starting it is a safe
  // no-op for every source's stop() (see e.g. cloudSource.ts's stop()), so this hook
  // is harmless for the many tests that build an app without starting sources.
  app.addHook('onClose', async () => {
    await app.ctx.sources.stopAll();
  });
  if (opts.startSources) {
    await app.ctx.sources.startAll();
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
  await kegtronRoutes(app); // direct call — see encapsulation note above
  await activityRoutes(app); // direct call — see encapsulation note above
  const dataDir = resolve(opts.dataDir ?? './data');
  await labelsStaticRoutes(app, dataDir); // direct call, before uploadsRoutes/staticRoutes —
                                           // see its doc comment for the decorateReply ordering
  await uploadsRoutes(app, dataDir);      // direct call — see encapsulation note above
  await lookupRoutes(app, dataDir, { timeoutMs: opts.lookupTimeoutMs }); // direct call —
                                           // see encapsulation note above; must also run
                                           // before staticRoutes, like every route module
  await staticRoutes(app, opts.webDir); // direct call, LAST — setNotFoundHandler inside a
                                         // register()'d plugin would not apply globally

  return app;
}
