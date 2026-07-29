import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { ALERT_CHANNEL_NAMES, buildAlertChannel, type AlertChannelName } from '../notify/channels/index.js';

const paramsSchema = z.object({
  name: z.enum(ALERT_CHANNEL_NAMES as unknown as [AlertChannelName, ...AlertChannelName[]]),
});

/**
 * `POST /api/channels/:name/test` (admin role, per the plan — a step up from the
 * automations page itself, which the Phase 5 plan's "Global Constraints" gates at
 * editor; channel SETTINGS specifically are admin, matching `PATCH /api/settings`'s own
 * `admin` gate). Builds a fixed test message, sends it through the CURRENTLY SAVED
 * `alertChannels` config for `:name` (`notify/channels/index.ts#buildAlertChannel` — the
 * same factory Task 3's engine will use), and reports success/failure back as JSON —
 * NEVER as an HTTP error status, since "the test send failed" is an expected, routine
 * outcome for this endpoint, not a request-level error.
 *
 * Every failure message is a fixed, humanized string — never the sender's raw thrown
 * error — so a channel's own redaction discipline (no secrets/URLs in a THROWN message;
 * see e.g. `channels/pushover.ts`) can't be undermined by this route re-surfacing
 * something it shouldn't (e.g. a future sender regression that leaks more detail than it
 * should into its error `message`).
 */
export async function channelsRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole('admin') };

  app.post('/api/channels/:name/test', admin, async (req, reply) => {
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(404).send({ error: 'not_found', message: 'Unknown channel' });
    }
    const { name } = parsed.data;

    const channel = buildAlertChannel(app.ctx.settings, name);
    if (!channel) {
      return { ok: false, message: `${name} is not configured yet — save its settings first, then try again` };
    }

    try {
      await channel.send({
        title: 'Kegwall test notification',
        body: `This is a test message from the ${name} channel.`,
        severity: 'info',
      });
      return { ok: true };
    } catch {
      return { ok: false, message: `Could not send a test message via ${name} — check its settings and try again` };
    }
  });
}
