import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { createUser } from '../../src/server/db/users.js';
import { seedE2EFixtures, E2E_MONITORS } from './fixtures.js';

/**
 * E2E smoke (Phase 5 Task 7): the two automation-driven live paths the plan calls out --
 * a `wall_banner` action reaching the wall over the real `/ws` broadcast, and an alert's
 * `notify` action reaching the admin notification bell the same way, ack included. Same
 * in-process-real-server shape as `wall.spec.ts` (`buildApp()` against a fresh temp
 * SQLite DB, the real `dist/web` build, driven by a real Chromium page) -- but its OWN
 * server/DB instance, not a shared one, for two reasons: (1) `wall.spec.ts` boots with
 * `startSources: false` and never starts the `AutomationEngine` (its `volume_update` test
 * only proves the WS/state-broadcast path, no automation involved), while this file needs
 * a REAL running engine to prove a created rule actually fires; (2) keeping the two
 * suites' seeded/mutated state fully separate avoids any cross-file ordering coupling.
 *
 * `startSources: true` (unlike wall.spec.ts's `false`) is what actually starts the engine
 * -- `engine.start()` is gated behind the exact same flag as `sources.startAll()` (see
 * app.ts / context.ts's doc comments) since either can dispatch real side effects. This is
 * still zero real network: with no settings configured, the only source that registers at
 * all is `KegtronCloudSource`, and its own `start()` self-skips outright (no API key) --
 * see `ingest/bootstrap.ts` / `cloudSource.ts`. No UDP/Gen1/HA-publisher source registers
 * without explicit settings this suite never sets.
 */
test.describe.configure({ mode: 'serial' });

let app: FastifyInstance;
let baseURL: string;
let dataDir: string;

const ADMIN_CREDENTIALS = { username: 'e2e-automations-admin', password: 'e2e-automations-pw-1' };

test.beforeAll(async () => {
  const webDir = resolve(process.cwd(), 'dist/web');
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error(
      `dist/web/index.html not found at ${webDir} — run "npm run build" before "npm run test:e2e".`,
    );
  }

  dataDir = mkdtempSync(join(tmpdir(), 'kegtron-e2e-automations-'));
  // See wall.spec.ts's identical NODE_ENV note: silences buildApp's Fastify request logger.
  process.env.NODE_ENV = 'test';
  app = await buildApp({ dataDir, webDir, startSources: true });
  seedE2EFixtures(app.ctx);
  // Created directly against the DB (not via POST /api/auth/setup) -- setup only ever
  // works ONCE per app (see routes/auth.ts's hasAnyLoginUser gate), and each test below
  // needs its own fresh login (Playwright gives every test an isolated browser context,
  // so session cookies from one test's page never carry into the next). Login itself
  // (the thing the task asks for, "login via API") happens per-test via
  // POST /api/auth/login against these seeded credentials.
  createUser(app.ctx.db, {
    username: ADMIN_CREDENTIALS.username, displayName: 'E2E Admin',
    password: ADMIN_CREDENTIALS.password, role: 'admin',
  });
  baseURL = await app.listen({ port: 0, host: '127.0.0.1' });
});

test.afterAll(async () => {
  await app?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/** `page.request` shares cookie storage with `page`'s own browsing context, so a session
 * cookie set here is sent along by every subsequent `page.goto`/`page.request` call in
 * the SAME test. */
async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post(`${baseURL}/api/auth/login`, { data: ADMIN_CREDENTIALS });
  expect(res.ok()).toBe(true);
}

test('a wall_banner automation rule created via the API fires a real banner on pour_completed', async ({ page }) => {
  await loginAsAdmin(page);

  const created = await page.request.post(`${baseURL}/api/automations`, {
    data: {
      name: 'E2E banner on pour',
      trigger: { type: 'pour_completed' },
      actions: [{
        type: 'wall_banner', text: '{{beer.name}} poured on tap {{tap.number}}',
        kind: 'celebrate', durationMs: 8000,
      }],
    },
  });
  expect(created.status()).toBe(201);

  await page.goto(`${baseURL}/wall/main`);
  await expect(page.getByTestId('tap-card')).toHaveCount(4);

  // Emitted directly on the live app's event bus -- the same bus a real cloud/UDP/BLE
  // ingest report publishes `pour_completed` to; the engine (running for real in this
  // suite, unlike wall.spec.ts) matches the rule above and dispatches its `wall_banner`
  // action, which routes/ws.ts relays to every connected client as `{type:'banner',...}`.
  // `E2E_MONITORS.pro` is bound to tap 1 (Citra Haze) -- see fixtures.ts. Wrapped in
  // `toPass` and re-emitted per retry for the same WS-handshake-race reason
  // wall.spec.ts's own volume_update test documents (this test's `page.goto` races the
  // socket's connect).
  await expect(async () => {
    app.ctx.bus.emit('pour_completed', {
      monitor: E2E_MONITORS.pro, volumeMl: 473, durationMs: 5000, source: 'cloud',
      ts: new Date().toISOString(),
    });
    // `toContainText`, not `toHaveText` -- the banner also renders a "×" dismiss button
    // inside the same element, which a plain `toHaveText` would include verbatim.
    await expect(page.getByTestId('banner-lane-banner')).toContainText('Citra Haze poured on tap 1');
  }).toPass({ timeout: 10_000, intervals: [100, 250, 500, 1000] });
});

test('a keg-low alert template rule increments the admin bell badge on a level crossing, and ack clears it', async ({ page }) => {
  await loginAsAdmin(page);

  const created = await page.request.post(`${baseURL}/api/automations/from-template`, {
    data: { template: 'keg_low', params: { thresholdPct: 40 } },
  });
  expect(created.status()).toBe(201);

  await page.goto(`${baseURL}/admin`);
  await expect(page.getByTestId('admin-layout')).toBeVisible();
  await expect(page.getByTestId('notification-bell-badge')).toHaveCount(0);

  // Vienna Nights (tap 2, Gen 1 monitor -- see fixtures.ts) starts at 50% dispensed
  // (9500/19000mL). The engine needs an established baseline sample before it can detect
  // a CROSSING at all (see automation/engine.ts's onVolumeUpdate doc comment) -- this
  // first emit, at the fixture's own current level, sets that baseline without crossing
  // anything (not wrapped in the retry loop below: it only needs to happen once, before
  // the real crossing).
  app.ctx.bus.emit('volume_update', {
    monitor: E2E_MONITORS.gen1, volStartMl: 19000, volDispensedMl: 9500, sizeMl: 19000,
    ts: new Date().toISOString(),
  });

  // Re-emitting the SAME crossing event on every retry is safe/idempotent here: after the
  // first successful crossing, this tap's `previousLevelByTap` baseline is already below
  // the threshold, so a repeated identical emit is no longer a crossing (conditions.ts's
  // `crossed` requires prev >= threshold) and fires nothing further -- the retries exist
  // to absorb the WS round trip (bus emit -> engine fire -> InAppChannel DB write ->
  // state_changed{scope:'notifications'} -> /ws broadcast -> useAdminNotifications), not
  // to re-trigger the rule.
  await expect(async () => {
    app.ctx.bus.emit('volume_update', {
      monitor: E2E_MONITORS.gen1, volStartMl: 19000, volDispensedMl: 12000, sizeMl: 19000,
      ts: new Date().toISOString(),
    }); // (19000-12000)/19000 = 36.8%, crosses below the 40% threshold
    await expect(page.getByTestId('notification-bell-badge')).toHaveText('1');
  }).toPass({ timeout: 10_000, intervals: [100, 250, 500, 1000] });

  await page.getByTestId('notification-bell-button').click();
  await expect(page.getByTestId('notification-bell-panel')).toBeVisible();
  const row = page.getByTestId('notification-row').first();
  await expect(row).toContainText('Keg running low');
  await row.getByRole('button', { name: 'Ack' }).click();

  // The ack round-trips through POST /api/notifications/:id/ack -- confirms this is a
  // real server mutation, not optimistic-only client state (same discipline as
  // wall.spec.ts's claim-flow test).
  await expect(page.getByTestId('notification-bell-badge')).toHaveCount(0);
});
