import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import {
  listNotifications, ackNotification, ackAll, unackedCount,
} from '../db/notificationsRepo.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  before: z.coerce.number().int().positive().optional(),
});

/**
 * Phase 5 Task 6: the notification center's REST surface. `db/notificationsRepo.ts`
 * (Task 1) shipped `listNotifications`/`ackNotification`/`ackAll`/`unackedCount`; nothing
 * exposed them over HTTP until this task -- Tasks 1-5 only shipped the WS *nudge* (a bare
 * unacked count on `state_changed{scope:'notifications'}`, `routes/ws.ts`), not a way to
 * actually fetch/page/ack anything. This module fills that gap.
 *
 * Every route here -- INCLUDING the two ack endpoints -- is `viewer` role, not `editor`.
 * Per the plan's own explicit framing ("viewer can ack; their own view state is global --
 * acceptable, note it"): a notification's `acked` flag is one shared, app-wide bit (there
 * is no per-user "I've seen this" state), not a personal preference or a mutation to any
 * managed resource, so gating it above `viewer` would only mean a read-only role can see
 * every notification's content but can never dismiss any of them -- worse UX for no real
 * access-control benefit. `automations` CRUD (the thing that actually PRODUCES
 * notifications) stays `editor`-gated exactly as before; this module doesn't touch that.
 */
export async function notificationsRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const viewer = { preHandler: requireRole('viewer') };

  const emitChanged = (): void => {
    app.ctx.bus.emit('state_changed', { scope: 'notifications', ts: new Date().toISOString() });
  };

  // Registered before the ack-all/unacked-count POST/GET below only for readability
  // (matching automations.ts's "static segment before :id" discipline) -- there's no
  // actual routing ambiguity here since every literal path below has a different
  // segment COUNT than its `:id`-bearing sibling, so find-my-way's radix router would
  // resolve these correctly in any registration order.
  app.get('/api/notifications', viewer, async (req) => {
    const query = listQuerySchema.parse(req.query);
    return listNotifications(db, query);
  });

  app.get('/api/notifications/unacked-count', viewer, async () => ({ count: unackedCount(db) }));

  app.post('/api/notifications/:id/ack', viewer, async (req) => {
    const notification = ackNotification(db, Number((req.params as any).id));
    emitChanged();
    return notification;
  });

  app.post('/api/notifications/ack-all', viewer, async () => {
    const count = ackAll(db);
    emitChanged();
    return { count };
  });
}
