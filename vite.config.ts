import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const webRoot = fileURLToPath(new URL('./src/web', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/web', import.meta.url));

// The Fastify static route (src/server/routes/static.ts) serves dist/web with an
// SPA fallback, so this must build to exactly that directory.
export default defineConfig({
  root: webRoot,
  plugins: [
    react(),
    tailwindcss(),
    // Face sign-in (Plan B): self-host human's model files — the app must never
    // reach a CDN. Only the three models the face pipeline uses are shipped.
    // `root` above is src/web, so node_modules is two levels up; stripBase
    // flattens the copy so files land directly in <outDir>/models, not
    // nested under models/../../node_modules/....
    viteStaticCopy({
      targets: [
        {
          src: '../../node_modules/@vladmandic/human/models/blazeface.*',
          dest: 'models',
          rename: { stripBase: true },
        },
        {
          src: '../../node_modules/@vladmandic/human/models/facemesh.*',
          dest: 'models',
          rename: { stripBase: true },
        },
        {
          src: '../../node_modules/@vladmandic/human/models/faceres.*',
          dest: 'models',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
