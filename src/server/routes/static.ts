import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export async function staticRoutes(app: FastifyInstance, webDir: string | undefined) {
  if (!webDir || !existsSync(join(webDir, 'index.html'))) return;
  // Defense in depth: @fastify/static requires an absolute root path. Callers are
  // expected to pass one already (see server/index.ts), but resolve() is a no-op for
  // paths that are already absolute, so this is a safety net, not a behavior change.
  await app.register(fastifyStatic, { root: resolve(webDir) });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Route not found' });
  });
}
