import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Serves `DATA_DIR/labels` (label images written by `routes/uploads.ts`) at `/labels/`.
 * Always registered — unlike `staticRoutes` below it doesn't depend on a `webDir` build
 * output existing, so label images work in dev (`npm run dev`, no `dist/web`) and in any
 * test that builds an app without a `webDir`. Must run before `staticRoutes` in `app.ts`:
 * @fastify/static decorates `reply.sendFile` on first registration and throws if a second
 * registration tries to do that again, so THIS is the one that gets to be "first" — see
 * `staticRoutes`' `decorateReply: false` below.
 */
export async function labelsStaticRoutes(app: FastifyInstance, dataDir: string) {
  const labelsDir = resolve(join(dataDir, 'labels'));
  mkdirSync(labelsDir, { recursive: true });
  await app.register(fastifyStatic, { root: labelsDir, prefix: '/labels/' });
}

export async function staticRoutes(app: FastifyInstance, webDir: string | undefined) {
  if (!webDir || !existsSync(join(webDir, 'index.html'))) return;
  // Defense in depth: @fastify/static requires an absolute root path. Callers are
  // expected to pass one already (see server/index.ts), but resolve() is a no-op for
  // paths that are already absolute, so this is a safety net, not a behavior change.
  // decorateReply: false — labelsStaticRoutes (registered before this, always) already
  // added the reply.sendFile decorator; a second @fastify/static registration trying to
  // add it again throws FST_ERR_DEC_ALREADY_PRESENT.
  await app.register(fastifyStatic, { root: resolve(webDir), decorateReply: false });
  app.setNotFoundHandler((req, reply) => {
    // /labels excluded alongside /api and /ws: a MISSING label file reaches this handler
    // too — @fastify/static calls reply.callNotFound() for a 404 within its own served
    // root (see labelsStaticRoutes above), which routes here since there's no closer-
    // scoped not-found handler. Without this exclusion a bad/deleted label path would
    // silently 200 with the SPA shell instead of 404ing.
    if (req.method === 'GET' && !req.url.startsWith('/api')
      && !req.url.startsWith('/ws') && !req.url.startsWith('/labels')) {
      return reply.sendFile('index.html', resolve(webDir));
    }
    return reply.code(404).send({ error: 'not_found', message: 'Route not found' });
  });
}
