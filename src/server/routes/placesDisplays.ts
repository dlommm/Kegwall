import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  listDisplays, createDisplay, updateDisplay, deleteDisplay, getDisplay,
  pairDisplay, touchDisplay,
} from '../db/displays.js';
import { updateMonitorDeviceIdentity, getMonitorById, sanitizeMonitor } from '../db/monitors.js';
import { requireDisplayToken } from './displayAuth.js';
import { NotFoundError } from '../core/errors.js';

/**
 * Monitor device identity (name + enabled) + displays with pairing (design 7c).
 */
export async function placesDisplaysRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };
  const editor = { preHandler: requireRole('editor') };

  // --- Monitor device identity ----------------------------------------------

  // Applies to the whole physical DEVICE: every port row sharing the addressed
  // monitor's (type, identifier) gets the name/enabled state (see
  // updateMonitorDeviceIdentity). Disabling a Govee sensor also evicts its cached
  // wall-chip reading so the chip disappears immediately.
  app.patch('/api/monitors/:id/identity', editor, async (req) => {
    const id = z.coerce.number().int().parse((req.params as any).id);
    const body = z.object({
      name: z.string().trim().max(60).nullable().optional(),
      enabled: z.boolean().optional(),
    }).parse(req.body);
    const existing = getMonitorById(db, id);
    if (!existing) throw new NotFoundError(`monitor ${id}`);
    const name = body.name === undefined ? undefined
      : (body.name === '' ? null : body.name);
    const updated = updateMonitorDeviceIdentity(db, id, { name, enabled: body.enabled });
    if (body.enabled === false && existing.type === 'govee_sensor') {
      app.ctx.sensors.remove(existing.identifier);
    }
    return sanitizeMonitor(updated);
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
    // Mints a per-display secret token and returns it ONCE — the display stores it and
    // presents it (X-Display-Token / ?displayToken=) on every subsequent gated request.
    const paired = pairDisplay(db, body.code);
    if (!paired) {
      return reply.code(404).send({ error: 'not_found', message: 'No display with that code' });
    }
    app.ctx.log.info('wall', `Display "${paired.display.name}" paired (code ${paired.display.code})`);
    return { ...displayView(paired.display.id), token: paired.token };
  });

  // The paired display's refresh call: what should this display show right now? Requires the
  // display token when enforcement is on (also closes the old primary-key enumeration — an
  // anonymous caller can no longer walk id=1,2,3… once enforced).
  app.get('/api/public/display/:id', { preHandler: requireDisplayToken(app) }, async (req, reply) => {
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
