import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { buildApp } from './app.js';

// The app runs from source under tsx (no build step), so package.json always sits two
// levels above this file — true in the Docker image (/app/package.json) and in a
// bare-metal checkout alike. Same import.meta.url resolution idiom as db/migrate.ts.
const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

const app = await buildApp({
  dataDir: process.env.DATA_DIR ?? './data',
  // @fastify/static (see routes/static.ts) requires an absolute root path — resolve
  // the default (and any relative WEB_DIR override) against the current working
  // directory so `npm start` doesn't crash once dist/web exists.
  webDir: resolve(process.env.WEB_DIR ?? './dist/web'),
  startSources: true,
  version: pkg.version,
});
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
app.ctx.log.info('app', `Server started on port ${process.env.PORT ?? 8080}`);
