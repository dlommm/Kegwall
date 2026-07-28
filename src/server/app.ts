import Fastify, { type FastifyInstance } from 'fastify';

export interface AppOptions {
  dataDir?: string;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
