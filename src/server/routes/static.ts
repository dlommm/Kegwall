import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function staticRoutes(app: FastifyInstance, webDir: string | undefined) {
  if (!webDir || !existsSync(join(webDir, 'index.html'))) return;
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Route not found' });
  });
}
