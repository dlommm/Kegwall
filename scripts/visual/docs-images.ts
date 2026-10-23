// Docs images (Kegwall V2): turns a visual-harness run into the screenshots the README and
// docs/ embed, so they're regenerated from the real app instead of going stale.
//
//   npm run build && npm run visual:capture -- .visual/docs
//   npm run docs:images -- .visual/docs [only]
//
// `only` limits the run to docs images whose name contains it (e.g. `admin-people`).
// Each image is re-encoded as JPEG at a docs-friendly width; the looks and takeovers are laid
// out as labelled contact sheets. Output goes to docs/images/.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const SRC = resolve(process.argv[2] ?? '.visual/docs');
const OUT = resolve('docs/images');
const ONLY = process.argv[3] ?? '';

/** [harness shot, docs file, width in CSS px] */
const SINGLES: [string, string, number][] = [
  ['wall-look-just-tapped-1080', 'wall', 1600],
  ['admin-dashboard', 'admin-tonight', 1440],
  ['admin-light-dashboard', 'admin-tonight-light', 1440],
  ['admin-dashboard-mobile', 'admin-tonight-phone', 390],
  ['admin-taps', 'admin-taps', 1440],
  ['admin-taps-drawer', 'admin-taps-drawer', 1440],
  ['admin-taps-swap', 'admin-taps-swap', 1440],
  ['admin-kegs', 'admin-kegs', 1440],
  ['admin-suppliers', 'admin-suppliers', 1440],
  ['admin-monitors', 'admin-monitors', 1440],
  ['admin-beers', 'admin-beers', 1440],
  ['admin-beers-editor', 'admin-beers-editor', 1440],
  ['admin-people', 'admin-people', 1440],
  ['admin-stats', 'admin-stats', 1440],
  ['admin-settings', 'admin-settings', 1440],
  ['admin-wall-editor-fold', 'admin-wall-editor', 1440],
  ['admin-palette', 'admin-search', 1440],
  ['admin-menu-mobile', 'admin-menu-phone', 390],
];

const LOOKS: [string, string][] = [
  ['just-tapped', 'Just Tapped'], ['classic', 'Classic'], ['ledger', 'Ledger'], ['gallery', 'Gallery'],
  ['columns', 'Tap Columns'], ['handles', 'Tap Handles'], ['tally', 'Tally'], ['chalkboard', 'Chalkboard'],
  ['editorial', 'Editorial'], ['neon', 'Neon'], ['terminal', 'Terminal'], ['poster', 'Poster'],
  ['departures', 'Departures'], ['zen', 'Zen'],
];

const TAKEOVERS: [string, string][] = [
  ['pour-full-active-1080', 'Full'], ['pour-spotlight-active-1080', 'Spotlight'],
  ['pour-split-active-1080', 'Split'], ['pour-dock-active-1080', 'Dock'],
  ['pour-fill-active-1080', 'Fill'], ['pour-tappull-active-1080', 'Tap Pull'],
  ['pour-kegdrain-active-1080', 'Keg Drain'], ['pour-full-two-1080', 'Two taps at once'],
];

function dataUrl(name: string): string {
  const file = join(SRC, `${name}.png`);
  if (!existsSync(file)) throw new Error(`missing ${file}: run the capture first`);
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

async function render(page: Page, html: () => string, width: number, out: string): Promise<void> {
  if (ONLY && !out.includes(ONLY)) return;
  await page.setViewportSize({ width, height: 400 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#0d0c0b">${html()}</body></html>`);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await page.screenshot({ path: join(OUT, `${out}.jpg`), type: 'jpeg', quality: 82, fullPage: true });
  console.log(`docs/images/${out}.jpg`);
}

function sheet(items: [string, string][], columns: number): string {
  const cells = items.map(([shot, label]) => `<figure style="margin:0">
    <img src="${dataUrl(shot)}" style="display:block;width:100%;border-radius:6px">
    <figcaption style="margin-top:8px;color:#F7F4EE;font:700 18px system-ui,sans-serif">${label}</figcaption></figure>`);
  return `<div style="display:grid;grid-template-columns:repeat(${columns},1fr);gap:28px 20px;padding:24px">${cells.join('')}</div>`;
}

const browser = await chromium.launch(process.env.KEGWALL_CHROMIUM ? { executablePath: process.env.KEGWALL_CHROMIUM } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [shot, out, width] of SINGLES) {
  await render(page, () => `<img src="${dataUrl(shot)}" style="display:block;width:${width}px">`, width, out);
}
await render(page, () => sheet(LOOKS.map(([id, label]) => [`wall-look-${id}-1080`, label]), 4), 1600, 'wall-looks');
await render(page, () => sheet(TAKEOVERS, 4), 1600, 'pour-takeovers');
await browser.close();
