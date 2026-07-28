import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke config (Phase 3 Task 7). Chromium only, per the plan. Deliberately no
 * `webServer` entry: `tests/e2e/wall.spec.ts` boots/tears down its own `buildApp()`
 * instance in `test.beforeAll`/`afterAll` so the test process holds a direct reference
 * to `app.ctx` (needed to `ctx.bus.emit('volume_update', ...)` and prove the live WS
 * path — see the spec for why that requires being in-process rather than a spawned
 * child). That server serves a `npm run build` `dist/web` output, so `dist/web` must
 * exist before this suite runs (see package.json's `test:e2e` script / this task's
 * report for the full verification command order).
 *
 * NOT part of `npm test` — a separate `test:e2e` script, per the Task 7 plan.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
