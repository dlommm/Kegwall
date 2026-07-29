import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  poursByDay, hourHistogram, activeKegStats, beersByVolume, leaderboard,
} from '../db/stats.js';
import { listTelemetryForDevice } from '../db/telemetry.js';
import { getMonitorById } from '../db/monitors.js';
import { NotFoundError } from '../core/errors.js';

/**
 * `GET /api/stats/*` — the admin Stats page's six read-only aggregation endpoints (Task
 * 9 of the Phase 4 plan). All viewer role, same as every other read surface in the app
 * (`/api/pours`, `/api/admin/activity`, `/api/monitors/:id/telemetry`) — stats are for
 * looking at, not editing, so there's no editor/admin split here.
 */
export async function statsRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };

  // `?days=` is restricted to the three ranges the Stats page's switcher actually offers
  // (7/30/90) — an `z.enum` on the raw string query value (rather than a bare
  // `z.coerce.number()`) rejects anything else with a clean 400 instead of silently
  // aggregating over an arbitrary window.
  const poursQuerySchema = z.object({
    days: z.enum(['7', '30', '90']).default('30').transform(Number),
  });
  const beersQuerySchema = z.object({
    days: z.enum(['7', '30', '90']).default('90').transform(Number),
  });
  const tempsQuerySchema = z.object({
    monitorId: z.coerce.number().int(),
    hours: z.coerce.number().int().min(1).max(168).default(48),
  });
  const leaderboardQuerySchema = z.object({
    window: z.enum(['week', 'month', 'all']).default('week'),
  });

  app.get('/api/stats/pours', viewer, async (req) => {
    const { days } = poursQuerySchema.parse(req.query);
    return poursByDay(db, days);
  });

  app.get('/api/stats/hours', viewer, async () => hourHistogram(db));

  app.get('/api/stats/kegs', viewer, async () => activeKegStats(db));

  app.get('/api/stats/beers', viewer, async (req) => {
    const { days } = beersQuerySchema.parse(req.query);
    return beersByVolume(db, days);
  });

  // Query-param twin of `GET /api/monitors/:id/telemetry` (Task 6, routes/crud.ts) —
  // same viewer role, same device-wide telemetry reuse, same hours bounds — but
  // addressed by `?monitorId=` rather than a path param, per the Task 9 plan's endpoint
  // shape, so the Stats page's temp chart can read it the same way as its other
  // `/api/stats/*` calls. Any port row of a device answers identically.
  app.get('/api/stats/temps', viewer, async (req) => {
    const { monitorId, hours } = tempsQuerySchema.parse(req.query);
    const mon = getMonitorById(db, monitorId);
    if (!mon) throw new NotFoundError(`monitor ${monitorId}`);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return listTelemetryForDevice(db, mon.type, mon.identifier, since);
  });

  app.get('/api/stats/leaderboard', viewer, async (req) => {
    const { window } = leaderboardQuerySchema.parse(req.query);
    return leaderboard(db, window);
  });
}
