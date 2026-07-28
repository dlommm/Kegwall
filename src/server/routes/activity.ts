import type { FastifyInstance } from 'fastify';
import { requireRole } from './auth.js';
import { listRecentActivity } from '../db/activity.js';

/** `GET /api/admin/activity` — the dashboard home's activity feed (Task 3 of the Phase
 * 4 plan). Viewer role, same as every other read endpoint the admin dashboard depends
 * on (`/api/sources`, `/api/pours`). */
export async function activityRoutes(app: FastifyInstance) {
  app.get('/api/admin/activity', { preHandler: requireRole('viewer') },
    async () => listRecentActivity(app.ctx.db));
}
