import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Server tests (tests/**) run in node, matching the Fastify backend they exercise.
// Web tests (tests/web/**) run in jsdom, matching the React SPA in src/web/. Each
// project only loads its own setupFiles/plugins, so @testing-library/jest-dom and the
// React JSX transform never touch the node-environment server suite.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/web/**'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['tests/web/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/web/setup.ts'],
        },
      },
    ],
  },
});
