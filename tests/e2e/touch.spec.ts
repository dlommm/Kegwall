import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { seedE2EFixtures } from './fixtures.js';

/**
 * Touch-target audit (Kegwall V2 M10 exit; CLAUDE.md: ≥ 44 px on the tablet and the menu).
 * Boots the real server on the built web app and measures every visible control a guest or a
 * pourer can tap on the phone menu (with the beer sheet open too) and the kiosk. A control is
 * exempt only when it's an inline link inside running text.
 */
test.describe.configure({ mode: 'serial' });

let app: FastifyInstance;
let baseURL: string;
let dataDir: string;

test.beforeAll(async () => {
  const webDir = resolve(process.cwd(), 'dist/web');
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error('dist/web/index.html not found — run "npm run build" before "npm run test:e2e".');
  }
  dataDir = mkdtempSync(join(tmpdir(), 'kegtron-touch-'));
  process.env.NODE_ENV = 'test';
  app = await buildApp({ dataDir, webDir, startSources: false });
  seedE2EFixtures(app.ctx);
  baseURL = await app.listen({ port: 0, host: '127.0.0.1' });
});

test.afterAll(async () => {
  await app?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/** Every visible control smaller than 44 × 44 CSS px, described for the failure message. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="radio"]',
    );
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      // An inline link inside a sentence takes the line's height; that's fine.
      if (el.tagName === 'A' && style.display === 'inline' && el.parentElement?.tagName === 'P') continue;
      if (r.height < 44 || r.width < 44) {
        const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 40);
        out.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

test('the phone menu: every control is at least 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseURL}/menu`);
  await expect(page.getByTestId('menu-page')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);

  await page.getByTestId('menu-tap').first().click();
  await expect(page.getByTestId('beer-sheet')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});

test('the kiosk: every control is at least 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${baseURL}/tablet/main`);
  await expect(page.getByTestId('tablet-grid')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);

  await page.getByTestId('tablet-signup-button').click();
  await expect(page.getByTestId('tablet-signup')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});
