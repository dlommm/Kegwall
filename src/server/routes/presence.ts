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

  // Open SSE connections (task-5 review F2): a stream still open when the app closes
  // (e.g. an admin/kiosk tab connected during a server restart, or — as the review's
  // probe found — simply every open connection in a test that doesn't explicitly
  // cancel its reader first) must not leak its bus subscription, ping timer, or raw
  // socket past `app.close()`. Every other per-connection resource in this app (wsRoutes'
  // `clients` set) is torn down the same way: tracked in a registration-scoped collection,
  // reaped by a single `onClose` hook below.
  interface OpenStream {
    unsubscribe: () => void;
    ping: ReturnType<typeof setInterval>;
    raw: import('node:http').ServerResponse;
  }
  const openStreams = new Set<OpenStream>();

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
    const entry: OpenStream = { unsubscribe, ping, raw: reply.raw };
    openStreams.add(entry);
    req.raw.on('close', () => {
      // `Set.delete` returns false if already removed — guards against the onClose hook
      // below and this handler both running their cleanup (app closing while the client
      // socket is also in the middle of tearing down).
      if (!openStreams.delete(entry)) return;
      unsubscribe();
      clearInterval(ping);
    });
  });

  app.addHook('onClose', () => {
    for (const entry of [...openStreams]) {
      if (!openStreams.delete(entry)) continue; // same double-run guard as above
      entry.unsubscribe();
      clearInterval(entry.ping);
      // Force-closes the underlying socket — plain `.end()` would leave a `keep-alive`
      // connection sitting open for Node's http.Server.close() to wait on forever, which
      // is exactly the hang the review's live probe caught.
      entry.raw.destroy();
    }
  });
}
