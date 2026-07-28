import type { FastifyInstance } from 'fastify';
import { requireRole } from './auth.js';

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/api/sources', { preHandler: requireRole('viewer') }, async () => app.ctx.sources.status());
}
