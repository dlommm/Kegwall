import { resolve } from 'node:path';
import { buildApp } from './app.js';

const app = await buildApp({
  dataDir: process.env.DATA_DIR ?? './data',
  // @fastify/static (see routes/static.ts) requires an absolute root path — resolve
  // the default (and any relative WEB_DIR override) against the current working
  // directory so `npm start` doesn't crash once dist/web exists.
  webDir: resolve(process.env.WEB_DIR ?? './dist/web'),
  startSources: true,
});
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
app.ctx.log.info('app', `Server started on port ${process.env.PORT ?? 8080}`);
