import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDisplayByToken, type Display } from '../db/displays.js';

// ---------------------------------------------------------------------------
// Display-token auth (native-display epic, sub-project A). A paired display client (the
// native Flutter wall, or a paired browser wall/tablet) presents its per-display secret so
// the gated wall/menu/leaderboard/passport/ws reads can authenticate it. Enforcement is
// gated by settings.displays.enforceToken (default off): while off, this is a pass-through
// (it still resolves req.display when a token is present, but never denies access), so the
// mechanism ships dormant and an operator flips it on only after pairing their screens.
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest { display: Display | null }
}

/** The display token from the `X-Display-Token` header (REST) or the `?displayToken=` query
 * param (WS/SSE — a browser WebSocket/EventSource cannot set custom headers). */
function extractDisplayToken(req: FastifyRequest): string | undefined {
  const header = req.headers['x-display-token'];
  if (typeof header === 'string' && header) return header;
  const q = (req.query as { displayToken?: unknown } | undefined)?.displayToken;
  return typeof q === 'string' && q ? q : undefined;
}

/** Decorates `req.display` (default null). Call once in buildApp, before any route that uses
 * requireDisplayToken — Fastify requires the property be decorated before it can be assigned. */
export function registerDisplayAuth(app: FastifyInstance): void {
  app.decorateRequest('display', null);
}

/** preHandler factory: resolves the presented token to `req.display`, then — only when
 * `settings.displays.enforceToken` is on — rejects with 401 unless the request carries a
 * valid display token OR a logged-in session user. The session-user allowance matters
 * because these endpoints (`/ws`, the wall payload, etc.) are also consumed by authenticated
 * admin pages via the cookie, and a logged-in staff member is at least as trusted as a
 * paired display. While enforcement is off it never denies access (dormant, back-compat). */
export function requireDisplayToken(app: FastifyInstance) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractDisplayToken(req);
    req.display = token ? getDisplayByToken(app.ctx.db, token) : null;
    if (!app.ctx.settings.get('displays').enforceToken) return; // dormant → allow
    if (req.display || req.user) return; // paired display OR logged-in staff
    return reply.code(401).send({ error: 'unauthorized', message: 'This display must be paired' });
  };
}
