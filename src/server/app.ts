import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { createContext, type AppContext } from './context.js';
import { authRoutes } from './routes/auth.js';
import { crudRoutes } from './routes/crud.js';
import { wsRoutes } from './routes/ws.js';
import { publicRoutes } from './routes/public.js';
import { sourcesRoutes } from './routes/sources.js';
import { kegtronRoutes } from './routes/kegtron.js';
import { staticRoutes } from './routes/static.js';
import { NotFoundError, ConflictError, ValidationError } from './core/errors.js';

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
  await staticRoutes(app, opts.webDir); // direct call, LAST — setNotFoundHandler inside a
                                         // register()'d plugin would not apply globally

  return app;
}
