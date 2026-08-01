import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const DEFAULT_PING_INTERVAL_MS = 30_000;

export interface PresenceRoutesOptions { pingIntervalMs?: number }

/** Presence wake surfaces (spec Part A/A2-A3): the token-gated external motion webhook
 * + agent SSE stream, and the public user-interaction wake endpoint (same trust level
 * as the wall pages themselves — worst case someone turns screens ON). */
export async function presenceRoutes(app: FastifyInstance, opts: PresenceRoutesOptions = {}) {
  const requireToken = (token: unknown): { code: number; error: string } | null => {
    const expected = app.ctx.settings.get('presenceWebhookToken');
    if (!expected) return { code: 503, error: 'presence token not configured' };
    if (token !== expected) return { code: 401, error: 'bad token' };
    return null;
  };

  app.post('/api/presence/motion', async (req, reply) => {
    const { token } = z.object({ token: z.string().optional() }).parse(req.query);
    const denied = requireToken(token);
    if (denied) return reply.code(denied.code).send({ error: denied.error });
    const { wall } = z.object({ wall: z.string().optional() }).parse(req.body ?? {});
    app.ctx.presence.motion(wall ?? null, 'webhook');
    return { ok: true };
  });

  app.post('/api/presence/wake', async (req) => {
    const { wall, source } = z.object({
      wall: z.string().optional(),
      source: z.enum(['touch', 'camera']).default('touch'),
    }).parse(req.body ?? {});
    app.ctx.presence.motion(wall ?? null, source);
    return { ok: true };
  });

  const pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  app.get('/api/presence/stream', (req, reply) => {
    const { wall, token } = z.object({ wall: z.string(), token: z.string().optional() })
      .parse(req.query);
    const denied = requireToken(token);
    if (denied) return reply.code(denied.code).send({ error: denied.error });
    const state = app.ctx.presence.stateOf(wall);
    if (state === undefined) return reply.code(404).send({ error: 'no such wall' });

    reply.hijack(); // takes ownership of the raw response — fastify must not also try to
                     // serialize/send a body once we start writing to reply.raw ourselves
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (s: string) => reply.raw.write(`data: ${JSON.stringify({ state: s })}\n\n`);
    send(state); // on-connect replay: a reconnecting agent never sticks in a stale stage
    const unsubscribe = app.ctx.bus.on('display_power_changed', (e) => {
      if (e.wallSlug === wall) send(e.state);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), pingIntervalMs);
    req.raw.on('close', () => { unsubscribe(); clearInterval(ping); });
  });
}
