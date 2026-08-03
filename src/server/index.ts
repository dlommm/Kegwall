import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { buildApp } from './app.js';
import { ensureDefaultWall } from './routes/crud.js';

// The app runs from source under tsx (no build step), so package.json always sits two
// levels above this file — true in the Docker image (/app/package.json) and in a
// bare-metal checkout alike. Same import.meta.url resolution idiom as db/migrate.ts.
const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

const port = Number(process.env.PORT ?? 8080);
// Listen host. Defaults to 0.0.0.0 (the right default for a container behind a published
// port); a native install can narrow it to 127.0.0.1 via HOST/BIND and put a reverse proxy
// in front, so the admin UI isn't exposed on every host interface.
const host = process.env.HOST ?? process.env.BIND ?? '0.0.0.0';

const app = await buildApp({
  dataDir: process.env.DATA_DIR ?? './data',
  // @fastify/static (see routes/static.ts) requires an absolute root path — resolve
  // the default (and any relative WEB_DIR override) against the current working
  // directory so `npm start` doesn't crash once dist/web exists.
  webDir: resolve(process.env.WEB_DIR ?? './dist/web'),
  startSources: true,
  version: pkg.version,
  port,
});
// Seed a default `main` wall on first run so a fresh install's display (/wall/main) resolves and
// renders immediately, before anyone opens the admin wizard. Idempotent (no-op once any wall exists).
// Done here in the production entrypoint — not in createContext — so the test harness's buildApp
// starts from a clean slate. See ensureDefaultWall in routes/crud.ts.
ensureDefaultWall(app.ctx.db);
await app.listen({ port, host });
app.ctx.log.info('app', `Server started on ${host}:${port}`);
