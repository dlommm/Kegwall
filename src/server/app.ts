import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { createContext, type AppContext } from './context.js';
import { authRoutes } from './routes/auth.js';
import { crudRoutes } from './routes/crud.js';
import { NotFoundError, ConflictError, ValidationError } from './core/errors.js';

declare module 'fastify' {
  interface FastifyInstance { ctx: AppContext }
}

export interface AppOptions {
  dataDir?: string;
  context?: AppContext;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.decorate('ctx', opts.context ?? createContext(opts.dataDir ?? './data'));

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

  return app;
}
