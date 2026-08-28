import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  createUser, verifyPassword, type Role, type User,
} from '../db/users.js';
import {
  createSession, getUserForToken, destroySession, sweepExpiredSessions,
} from '../core/auth.js';
import { setupTokenMatches, consumeSetupClaimToken } from '../core/setupToken.js';

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/** Session cookie lifetime in seconds — mirrors core/auth.ts's SESSION_DAYS so the browser
 * cookie and the server-side session expiry agree (previously the cookie was session-only,
 * dying at browser close while the DB session lived 30 days). */
const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

/** Cookie options for the session cookie. `secure` is set when the request arrived over
 * HTTPS — either directly (`req.protocol`) or via a terminating proxy's
 * `x-forwarded-proto` — so a TLS deployment gets a Secure cookie while a plain-HTTP LAN
 * install still works. A spoofed header only ever makes the cookie MORE restrictive. */
function sessionCookieOptions(req: FastifyRequest) {
  const https = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
  return {
    httpOnly: true, sameSite: 'lax' as const, path: '/',
    secure: https, maxAge: SESSION_COOKIE_MAX_AGE_S,
  };
}

export function hasAnyLoginUser(db: Database.Database): boolean {
  const row = db.prepare('SELECT COUNT(*) c FROM users WHERE username IS NOT NULL').get() as any;
  return row.c > 0;
}

export function requireRole(minRole: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized', message: 'Log in first' });
    const role = req.user.role;
    if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) {
      return reply.code(403).send({ error: 'forbidden', message: `Needs ${minRole} role` });
    }
  };
}

export interface AuthRoutesOptions {
  /** Resolved data directory — where the first-run setup claim token lives. */
  dataDir: string;
  /** When true, `POST /api/auth/setup` requires the first-run claim token written to
   * `dataDir` at boot. Defaults on in production and off under NODE_ENV=test (so the
   * existing route-test suite, which drives setup directly, stays unchanged); a dedicated
   * test opts in explicitly. */
  requireSetupToken: boolean;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions) {
  // Resolve session cookie -> req.user for ALL routes. NOTE: authRoutes is CALLED
  // DIRECTLY (await authRoutes(app)), not via app.register() — a register()'d plugin
  // is encapsulated and this hook would not apply to the other route modules.
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.session;
    req.user = token ? getUserForToken(app.ctx.db, token) : null;
  });

  const setupSchema = z.object({
    username: z.string().min(1), displayName: z.string().min(1),
    password: z.string().min(8),
    // The first-run claim token printed to the server console at boot. Required only when
    // opts.requireSetupToken is set (production) — see AuthRoutesOptions.
    claimToken: z.string().optional(),
  });

  // Public, unauthenticated: the admin SPA probes this before rendering the login form
  // to decide whether to send a first-time visitor to /admin/setup instead — see
  // src/web/routes/admin/LoginPage.tsx. Only ever reveals a boolean, never user data.
  app.get('/api/auth/needs-setup', async () => ({ needsSetup: !hasAnyLoginUser(app.ctx.db) }));

  app.post('/api/auth/setup', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (hasAnyLoginUser(app.ctx.db)) {
      return reply.code(409).send({ error: 'conflict', message: 'Setup already completed' });
    }
    const body = setupSchema.parse(req.body);
    if (opts.requireSetupToken && !setupTokenMatches(opts.dataDir, body.claimToken)) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Invalid or missing setup token — copy it from the server logs',
      });
    }
    const { claimToken: _drop, ...userInput } = body;
    const user = createUser(app.ctx.db, { ...userInput, role: 'admin' });
    if (opts.requireSetupToken) consumeSetupClaimToken(opts.dataDir);
    const { token } = createSession(app.ctx.db, user.id);
    reply.setCookie('session', token, sessionCookieOptions(req));
    return reply.code(201).send(user);
  });

  app.post('/api/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const user = verifyPassword(app.ctx.db, body.username, body.password);
    if (!user) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Bad username or password' });
    }
    // Piggyback the expired-session sweep on successful logins — expired rows are
    // otherwise only deleted lazily when their exact token is presented again, so
    // abandoned browsers' sessions would accumulate forever (see core/auth.ts).
    sweepExpiredSessions(app.ctx.db);
    const { token } = createSession(app.ctx.db, user.id);
    reply.setCookie('session', token, sessionCookieOptions(req));
    return user;
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.session;
    if (token) destroySession(app.ctx.db, token);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized', message: 'Not logged in' });
    return req.user;
  });
}
