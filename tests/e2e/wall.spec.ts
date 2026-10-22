import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { seedE2EFixtures, E2E_MONITORS, type E2EFixtures } from './fixtures.js';

/**
 * E2E smoke (Task 7 of the Phase 3 plan): boots a REAL server — `buildApp()` against a
 * fresh temp SQLite DB, `startSources: false` (never touch real hardware/network), the
 * actual `dist/web` produced by `npm run build` — in this same process, seeds it via
 * `seedE2EFixtures`, then drives it with a real Chromium page. Booting in-
 * process (rather than Playwright's `webServer` option spawning a child) is what lets
 * this file reach `app.ctx.bus` directly to prove the live WS path: emitting
 * `volume_update` here and watching the already-rendered page update without a reload.
 *
 * Serial: every test shares the one server/DB instance seeded in `beforeAll`, and the
 * claim-flow test intentionally mutates that shared state (claims the one seeded
 * unclaimed pour) — it runs last so nothing after it depends on that pour still existing.
 */
test.describe.configure({ mode: 'serial' });

let app: FastifyInstance;
let baseURL: string;
let dataDir: string;
let fixtures: E2EFixtures;

test.beforeAll(async () => {
  const webDir = resolve(process.cwd(), 'dist/web');
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error(
      `dist/web/index.html not found at ${webDir} — run "npm run build" before "npm run test:e2e".`,
    );
  }

  dataDir = mkdtempSync(join(tmpdir(), 'kegtron-e2e-'));
  // buildApp() only silences its Fastify request logger when NODE_ENV === 'test' (see
  // app.ts) — Playwright's own runner doesn't set that (unlike vitest), so without this
  // every request this suite makes would spam stdout with a JSON request/response log line.
  process.env.NODE_ENV = 'test';
  app = await buildApp({ dataDir, webDir, startSources: false });
  fixtures = seedE2EFixtures(app.ctx);
  baseURL = await app.listen({ port: 0, host: '127.0.0.1' });
});

test.afterAll(async () => {
  await app?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function tapCardByName(page: Page, beerName: string) {
  // None of the four seeded beer names is a substring of another (see fixtures.ts), so a
  // plain substring `hasText` filter on the card is enough to disambiguate.
  return page.getByTestId('tap-card').filter({ hasText: beerName });
}

test('/wall/main renders 4 tap cards with beer names', async ({ page }) => {
  await page.goto(`${baseURL}/wall/main`);

  await expect(page.getByTestId('tap-card')).toHaveCount(4);
  const names = await page.getByTestId('tap-card-name').allTextContents();
  expect(names.sort()).toEqual(
    ['Belgian Sun', 'Citra Haze', 'Midnight Oats', 'Vienna Nights'].sort(),
  );

  // The permanently-kicked tap (Midnight Oats, see fixtures.ts) still shows its beer
  // name and card, just marked kicked — confirms the KICKED fallback path (Task 4/5
  // review requirement) is actually reachable through the real API, not just in tests
  // that call StateManager directly.
  await expect(tapCardByName(page, 'Midnight Oats')).toHaveAttribute('data-kicked', 'true');
});

test('a server-side volume_update updates a card live over WS', async ({ page }) => {
  await page.goto(`${baseURL}/wall/main`);

  const liquidBody = tapCardByName(page, 'Citra Haze').getByTestId('liquid-fill-body');
  await expect(liquidBody).toHaveAttribute('height', '83.2');

  // Emitted directly on the live app's event bus — this is the same bus
  // ingest sources publish to; StateManager reacts by updating the keg's dispensed
  // volume, which fires `state_changed`, which the /ws route re-broadcasts as a fresh
  // snapshot to every connected client (see routes/ws.ts). Wrapped in `expect(...)
  // .toPass()` and re-emitted on every retry: this test process's WS handshake with the
  // page it just navigated is asynchronous, so a single emit right after `goto` could
  // race a socket that hasn't finished connecting yet.
  await expect(async () => {
    app.ctx.bus.emit('volume_update', {
      monitor: E2E_MONITORS.pro,
      volStartMl: 19000,
      volDispensedMl: 9500, // (19000 - 9500) / 19000 * 100 = 50.0
      sizeMl: 19000,
      ts: new Date().toISOString(),
    });
    await expect(liquidBody).toHaveAttribute('height', '50');
  }).toPass({ timeout: 10_000, intervals: [100, 250, 500, 1000] });
});

test('/menu renders the tap list', async ({ page }) => {
  await page.goto(`${baseURL}/menu`);

  await expect(page.getByTestId('menu-page-tap-list').getByTestId('tap-card')).toHaveCount(4);
  const names = await page.getByTestId('tap-card-name').allTextContents();
  expect(names.sort()).toEqual(
    ['Belgian Sun', 'Citra Haze', 'Midnight Oats', 'Vienna Nights'].sort(),
  );
});

test('the claim flow completes against the real API', async ({ page }) => {
  await page.goto(`${baseURL}/menu`);

  const pourButton = page.getByTestId('claim-sheet-pour');
  await expect(pourButton).toHaveCount(1);
  await expect(pourButton).toContainText('Vienna Nights');
  await pourButton.click();

  const drinkerButtons = page.getByTestId('claim-sheet-drinker');
  await expect(drinkerButtons).toHaveCount(2);
  await drinkerButtons.first().click();

  await expect(page.getByTestId('claim-sheet-success')).toBeVisible();
  // The claimed pour drops out of the unclaimed list — confirms the success path is a
  // real round trip through POST /api/public/claim, not just optimistic client state.
  await page.getByTestId('claim-sheet-success').getByText('Done').click();
  await expect(page.getByTestId('claim-sheet-empty')).toBeVisible();
});
