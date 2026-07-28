import { buildApp } from './app.js';

const app = await buildApp({
  dataDir: process.env.DATA_DIR ?? './data',
  webDir: process.env.WEB_DIR ?? './dist/web',
  startSources: true,
});
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
