import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../../src/server/app.js';
import { createUser, createDrinker } from '../../src/server/db/users.js';
import { createTap } from '../../src/server/db/taps.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';

test('empty taps stay quiet and cleaning reminders can be ignored and resumed', async ({ page }, testInfo) => {
  process.env.NODE_ENV = 'test';
  const dataDir = mkdtempSync(join(tmpdir(), 'kegwall-cleaning-'));
  const app = await buildApp({ dataDir, webDir: resolve('dist/web'), startSources: false });
  try {
    await createUser(app.ctx.db, { username: 'review', password: 'local-test-only', displayName: 'Review', role: 'admin' });
    const drinker = createDrinker(app.ctx.db, { displayName: 'Morgan' });
    for (let number = 1; number <= 4; number++) {
      const tap = createTap(app.ctx.db, { number });
      const beer = createBeer(app.ctx.db, { name: number === 1 ? 'Traditional Lager' : 'Sapporo Premium Beer' });
      const keg = createKeg(app.ctx.db, { beerId: beer.id, tapId: tap.id, sizeMl: 19000, volStartMl: 19000 });
      recordPourTx(app.ctx.db, { kegId: keg.id, ts: new Date(Date.now() - 18 * 3600_000).toISOString(), volumeMl: number > 2 ? 19000 : 400, source: 'udp' });
      if (number > 2) app.ctx.db.prepare("UPDATE kegs SET status = 'archived' WHERE id = ?").run(keg.id);
    }
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    expect((await page.request.post(`${base}/api/auth/login`, { data: { username: 'review', password: 'local-test-only' } })).status()).toBe(200);
    await page.goto(`${base}/admin`);
    await expect(page.getByTestId('dashboard-triage-row').filter({ hasText: 'due for a line cleaning' })).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('dashboard-after.png'), fullPage: true });
    await page.goto(`${base}/admin/taps`);
    await page.getByTestId('taps-row-expand').first().click();
    await page.getByRole('button', { name: 'Ignore reminders', exact: true }).click();
    await expect(page.getByText('Reminders ignored', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByTestId('taps-row-expand').first().click();
    await expect(page.getByRole('button', { name: 'Resume reminders' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume reminders' }).click();
    await expect(page.getByTestId('taps-cleaning')).toHaveAttribute('data-due', 'true');
    await page.screenshot({ path: testInfo.outputPath('taps-after.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('taps-mobile-after.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto(`${base}/admin`);
    await expect(page.getByTestId('dashboard-triage-row').filter({ hasText: 'due for a line cleaning' })).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('dashboard-mobile-after.png'), fullPage: true });
    await page.goto(`${base}/admin/pours`);
    await page.getByLabel('Unclaimed only').check();
    await expect(page.getByTestId('pours-row')).toHaveCount(4);
    await page.getByTestId('pours-row-drinker-select').first().selectOption(String(drinker.id));
    await expect(page.getByTestId('pours-row')).toHaveCount(3);
    await page.reload();
    await expect(page.getByTestId('pours-row-drinker-select').filter({ has: page.locator('option:checked', { hasText: 'Morgan' }) })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page).toHaveTitle('Pours · Kegwall');

    // Bulk-assign the remaining unclaimed pours in one go (phone viewport).
    await page.getByLabel('Unclaimed only').check();
    await expect(page.getByTestId('pours-row')).toHaveCount(3);
    await page.getByTestId('pours-select-all').check();
    await page.getByTestId('pours-bulk-target').selectOption(String(drinker.id));
    await page.getByTestId('pours-bulk-apply').click();
    await expect(page.getByTestId('pours-bulk-message')).toHaveText('Assigned 3 pours to Morgan.');
    await expect(page.getByTestId('pours-row')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('pours-mobile-after.png'), fullPage: true });

    // The mobile menu closes on Escape.
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('link', { name: 'Logs' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Logs' })).toBeHidden();

  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
