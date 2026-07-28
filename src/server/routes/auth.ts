import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  createUser, verifyPassword, type Role, type User,
} from '../db/users.js';
import { createSession, getUserForToken, destroySession } from '../core/auth.js';

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function requireRole(minRole: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized', message: 'Log in first' });
    const role = req.user.role;
    if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) {
      return reply.code(403).send({ error: 'forbidden', message: `Needs ${minRole} role` });
    }
  };
}

export async function authRoutes(app: FastifyInstance) {
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
  });

  app.post('/api/auth/setup', async (req, reply) => {
    const anyLogin = app.ctx.db
      .prepare('SELECT COUNT(*) c FROM users WHERE username IS NOT NULL').get() as any;
    if (anyLogin.c > 0) {
      return reply.code(409).send({ error: 'conflict', message: 'Setup already completed' });
    }
    const body = setupSchema.parse(req.body);
    const user = createUser(app.ctx.db, { ...body, role: 'admin' });
    const { token } = createSession(app.ctx.db, user.id);
    reply.setCookie('session', token, {
      httpOnly: true, sameSite: 'lax', path: '/',
    });
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
    const { token } = createSession(app.ctx.db, user.id);
    reply.setCookie('session', token, { httpOnly: true, sameSite: 'lax', path: '/' });
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
