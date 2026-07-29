import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  listLocations, createLocation, updateLocation, deleteLocation, getLocation,
} from '../db/locations.js';
import {
  listDisplays, createDisplay, updateDisplay, deleteDisplay, getDisplay,
  getDisplayByCode, touchDisplay,
} from '../db/displays.js';
import { updateMonitorIdentity, getMonitorById, sanitizeMonitor } from '../db/monitors.js';
import { NotFoundError } from '../core/errors.js';

/**
 * Pour Wall overhaul Phase 5 routes: locations (design 11a), monitor friendly
 * names, and displays with pairing (design 7c).
 */
export async function placesDisplaysRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };
  const editor = { preHandler: requireRole('editor') };

  // --- Locations (11a) ------------------------------------------------------

  const locationBody = z.object({ name: z.string().trim().min(1).max(60) });

  app.get('/api/locations', viewer, async () => listLocations(db));

  app.post('/api/locations', editor, async (req, reply) => {
    const body = locationBody.parse(req.body);
    reply.code(201);
    const location = createLocation(db, body.name);
    app.ctx.log.info('app', `Location created — "${location.name}"`);
    return location;
  });

  app.patch('/api/locations/:id', editor, async (req) => {
    const id = z.coerce.number().int().parse((req.params as any).id);
    const body = locationBody.parse(req.body);
    return updateLocation(db, id, body.name);
  });

  app.delete('/api/locations/:id', editor, async (req, reply) => {
    const id = z.coerce.number().int().parse((req.params as any).id);
    deleteLocation(db, id);
    return reply.code(204).send();
  });

  // --- Monitor identity (11a: friendly name + location) ---------------------

  app.patch('/api/monitors/:id/identity', editor, async (req) => {
    const id = z.coerce.number().int().parse((req.params as any).id);
    const body = z.object({
      name: z.string().trim().max(60).nullable().optional(),
      locationId: z.number().int().nullable().optional(),
    }).parse(req.body);
    if (!getMonitorById(db, id)) throw new NotFoundError(`monitor ${id}`);
    if (body.locationId != null && !getLocation(db, body.locationId)) {
      throw new NotFoundError(`location ${body.locationId}`);
    }
    return sanitizeMonitor(updateMonitorIdentity(db, id, {
      name: body.name === undefined ? undefined : (body.name === '' ? null : body.name),
      locationId: body.locationId,
    }));
  });

  // --- Displays (7c) --------------------------------------------------------

  const overridesSchema = z.object({
    look: z.enum(['classic', 'ledger', 'gallery', 'columns']).optional(),
    themeId: z.string().max(40).optional(),
    takeoverStyle: z.enum(['off', 'full', 'spotlight', 'split', 'dock', 'fill']).optional(),
  });

  app.get('/api/displays', viewer, async () => listDisplays(db));

  app.post('/api/displays', editor, async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(1).max(60),
      wallId: z.number().int().nullable().optional(),
    }).parse(req.body);
    reply.code(201);
    const display = createDisplay(db, body);
    app.ctx.log.info('wall', `Display "${display.name}" created — pairing code ${display.code}`);
    return display;
  });

  app.patch('/api/displays/:id', editor, async (req) => {
    const id = z.coerce.number().int().parse((req.params as any).id);
    const body = z.object({
      name: z.string().trim().min(1).max(60).optional(),
      wallId: z.number().int().nullable().optional(),
      overrides: overridesSchema.optional(),
    }).parse(req.body);
    if (!getDisplay(db, id)) throw new NotFoundError(`display ${id}`);
    return updateDisplay(db, id, body);
  });

  app.delete('/api/displays/:id', editor, async (req, reply) => {
    const id = z.coerce.number().int().parse((req.params as any).id);
    deleteDisplay(db, id);
    return reply.code(204).send();
  });

  // Public pairing: the TV enters its code and learns which display it is +
  // which wall to render. Rate-limited (it's an unauthenticated code guess).
  app.post('/api/public/display/pair', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = z.object({ code: z.string().trim().min(4).max(12) }).parse(req.body);
    const display = getDisplayByCode(db, body.code);
    if (!display) {
      return reply.code(404).send({ error: 'not_found', message: 'No display with that code' });
    }
    touchDisplay(db, display.id);
    app.ctx.log.info('wall', `Display "${display.name}" paired (code ${display.code})`);
    return displayView(display.id);
  });

  // The paired TV's refresh call: what should this display show right now?
  app.get('/api/public/display/:id', async (req, reply) => {
    const id = z.coerce.number().int().parse((req.params as any).id);
    const display = getDisplay(db, id);
    if (!display) {
      return reply.code(404).send({ error: 'not_found', message: 'No such display' });
    }
    touchDisplay(db, id);
    return displayView(id);
  });

  function displayView(id: number) {
    const display = getDisplay(db, id)!;
    let wallSlug: string | null = null;
    if (display.wallId != null) {
      const row = db.prepare('SELECT slug FROM walls WHERE id = ?').get(display.wallId) as any;
      wallSlug = row?.slug ?? null;
    }
    return {
      id: display.id,
      name: display.name,
      wallSlug,
      overrides: display.overrides,
    };
  }

}
