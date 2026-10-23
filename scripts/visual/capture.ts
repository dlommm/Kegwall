// Visual harness (Kegwall V2, M0): boots the real server against a throwaway data dir, seeds
// the synthetic taproom (seed.ts) and photographs every surface at TV, desktop, tablet and
// phone sizes. Compare two runs with diff.ts.
//
//   npm run build && npx tsx scripts/visual/capture.ts <out-dir> [name-filter]
//
// Set KEGWALL_CHROMIUM=/path/to/chrome if Playwright's pinned browser isn't installed.
// Finite CSS animations are fast-forwarded and infinite ones stopped (`animations: 'disabled'`)
// so two runs of the same code differ only where the content is time-based (clocks, "2m ago").
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { buildApp } from '../../src/server/app.js';
import { ADMIN_LOGIN, LOOKS, THEMES, TAKEOVERS, seedTaproom } from './seed.js';

const OUT = resolve(process.argv[2] ?? '.visual/latest');
const ONLY = process.argv[3] ?? '';
mkdirSync(OUT, { recursive: true });
const log: string[] = [];

const VIEWPORTS = {
  tv720: { width: 1280, height: 720 }, tv1080: { width: 1920, height: 1080 },
  tv4k: { width: 3840, height: 2160 }, desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 }, tabletL: { width: 1024, height: 768 },
  tabletP: { width: 800, height: 1280 }, mobile: { width: 390, height: 844 },
} as const;
type Viewport = { width: number; height: number };
const VP = VIEWPORTS;

const dataDir = mkdtempSync(join(resolve(OUT, '..'), 'data-'));
process.env.NODE_ENV = 'test';
const app = await buildApp({ dataDir, webDir: resolve('dist/web'), startSources: false });
// A fixed port keeps wall URLs printed in the admin identical between runs.
const base = await app.listen({ port: Number(process.env.VISUAL_PORT ?? 47900), host: '127.0.0.1' });

// First-run screens are photographed before the seed creates a login.
const browser: Browser = await chromium.launch(process.env.KEGWALL_CHROMIUM ? { executablePath: process.env.KEGWALL_CHROMIUM } : {});

async function snap(page: Page, name: string, full = false): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full, animations: 'disabled', caret: 'hide' });
}

async function shot(name: string, url: string, vp: Viewport, opts: {
  ctx?: BrowserContext; full?: boolean; before?: (p: Page) => Promise<void>; wait?: number; scheme?: 'dark' | 'light';
} = {}): Promise<void> {
  if (ONLY && !name.includes(ONLY)) return;
  const ctx = opts.ctx ?? await browser.newContext({ viewport: vp, colorScheme: opts.scheme ?? 'dark' });
  const page = await ctx.newPage();
  if (opts.ctx) await page.setViewportSize(vp);
  try {
    await page.goto(`${base}${url}`, { waitUntil: 'networkidle', timeout: 15_000 });
    await page.waitForTimeout(opts.wait ?? 900);
    if (opts.before) await opts.before(page);
    await snap(page, name, opts.full);
    log.push(`ok ${name} ${url}`);
    // Phones and tablets: the page must never scroll sideways. Name the widest culprits.
    if (vp.width <= 1024 && !url.startsWith('/wall') && !url.startsWith('/board')) {
      const wide = await page.evaluate(() => {
        const vw = window.innerWidth;
        if (document.documentElement.scrollWidth <= vw) return null;
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = el.getBoundingClientRect();
          if (r.right <= vw + 1 || r.width === 0) continue;
          const parent = el.parentElement?.getBoundingClientRect();
          if (parent && parent.right > vw + 1) continue;
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
          if (out.length >= 4) break;
        }
        return `${document.documentElement.scrollWidth}px: ${out.join(', ')}`;
      });
      if (wide) log.push(`WIDE ${name} ${wide}`);
    }
  } catch (e) {
    log.push(`FAIL ${name} ${url} ${(e as Error).message.split('\n')[0]}`);
    try { await snap(page, name); } catch { /* page already gone */ }
  }
  await page.close();
  if (!opts.ctx) await ctx.close();
}

await shot('admin-00-setup', '/admin/setup', VP.desktop);
await shot('display-pairing-tv1080', '/display', VP.tv1080);

const taproom = await seedTaproom(app);

// ---- public TV wall ----
for (const look of LOOKS) await shot(`wall-look-${look}-1080`, `/wall/look-${look}`, VP.tv1080);
for (const id of THEMES) await shot(`wall-theme-${id}-1080`, `/wall/theme-${id}`, VP.tv1080);
await shot('wall-main-720', '/wall/main', VP.tv720);
await shot('wall-main-1080', '/wall/main', VP.tv1080);
await shot('wall-main-4k', '/wall/main', VP.tv4k);
await shot('wall-look-ledger-720', '/wall/look-ledger', VP.tv720);
await shot('wall-look-gallery-4k', '/wall/look-gallery', VP.tv4k);
await shot('wall-look-just-tapped-720', '/wall/look-just-tapped', VP.tv720);
await shot('wall-look-just-tapped-4k', '/wall/look-just-tapped', VP.tv4k);
await shot('wall-taps4-1080', '/wall/taps4', VP.tv1080);
await shot('wall-taps12-1080', '/wall/taps12', VP.tv1080);
await shot('wall-fill-keg-1080', '/wall/fill-keg', VP.tv1080);
for (const t of ['full', 'compact', 'minimal']) await shot(`wall-tpl-${t}-1080`, `/wall/tpl-${t}`, VP.tv1080);
await shot('wall-rotate-mid-1080', '/wall/rotate', VP.tv1080, { wait: 4500 });
await shot('board-leaderboard-1080', '/board', VP.tv1080);

// ---- live pour: open every takeover wall, then drive a synthetic pour on tap 1 ----
if (!ONLY || ONLY.startsWith('pour')) {
  const ctx = await browser.newContext({ viewport: VP.tv1080, colorScheme: 'dark' });
  const pages: [string, Page][] = [];
  for (const style of TAKEOVERS) {
    const p = await ctx.newPage();
    await p.goto(`${base}/wall/pour-${style}`, { waitUntil: 'networkidle' });
    pages.push([style, p]);
  }
  const monitor = taproom.monitorFor(0);
  const ts = () => new Date().toISOString();
  app.ctx.bus.emit('pour_started', { monitor, ts: ts() });
  for (const ml of [90, 160, 236]) {
    app.ctx.bus.emit('pour_progress', { monitor, curServMl: ml, ts: ts() });
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 900));
  for (const [s, p] of pages) { await snap(p, `pour-${s}-active-1080`); log.push(`ok pour-${s}-active`); }
  // One takeover at 4K proves overlays scale with the stage too.
  await pages[0]![1].setViewportSize(VP.tv4k);
  await new Promise((r) => setTimeout(r, 300));
  await snap(pages[0]![1], `pour-${pages[0]![0]}-active-4k`);
  await pages[0]![1].setViewportSize(VP.tv1080);
  app.ctx.bus.emit('pour_completed', { monitor, volumeMl: 412, durationMs: 6100, source: 'udp', ts: ts() });
  await new Promise((r) => setTimeout(r, 700));
  for (const [s, p] of pages) { await snap(p, `pour-${s}-complete-1080`); log.push(`ok pour-${s}-complete`); }
  // Two taps pouring at once: every style opens a lane per pour.
  await new Promise((r) => setTimeout(r, 6000));
  const second = taproom.monitorFor(1);
  app.ctx.bus.emit('pour_started', { monitor, ts: ts() });
  app.ctx.bus.emit('pour_started', { monitor: second, ts: ts() });
  for (const ml of [90, 180, 260]) {
    app.ctx.bus.emit('pour_progress', { monitor, curServMl: ml, ts: ts() });
    app.ctx.bus.emit('pour_progress', { monitor: second, curServMl: ml * 0.7, ts: ts() });
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 900));
  for (const [s, p] of pages) { await snap(p, `pour-${s}-two-1080`); log.push(`ok pour-${s}-two`); }
  app.ctx.bus.emit('pour_completed', { monitor, volumeMl: 300, durationMs: 5000, source: 'udp', ts: ts() });
  app.ctx.bus.emit('pour_completed', { monitor: second, volumeMl: 200, durationMs: 4000, source: 'udp', ts: ts() });
  await ctx.close();
}

// ---- phone menu + tablet kiosk ----
await shot('menu-mobile', '/menu', VP.mobile, { full: true });
await shot('menu-mobile-light', '/menu', VP.mobile, { scheme: 'light' });
await shot('menu-tablet', '/menu', VP.tabletP);
await shot('menu-desktop', '/menu', VP.desktop);
await shot('menu-claim-sheet', '/menu', VP.mobile, {
  before: async (p) => {
    const b = p.getByTestId('claim-sheet-pour').first();
    if (await b.count()) { await b.click(); await p.waitForTimeout(2500); }
  },
});
await shot('tablet-kiosk-avatars', '/tablet/main', VP.tabletL);
await shot('tablet-kiosk-portrait', '/tablet/main', VP.tabletP);
await shot('tablet-kiosk-signup', '/tablet/main', VP.tabletL, {
  before: async (p) => { await p.getByTestId('tablet-signup-button').click(); await p.waitForTimeout(500); },
});
await shot('tablet-kiosk-armed', '/tablet/main', VP.tabletL, {
  before: async (p) => {
    await p.getByTestId('tablet-avatar').first().click();
    await p.waitForTimeout(300);
    const start = p.getByTestId('tablet-session-start');
    if (await start.count()) await start.click();
    await p.waitForTimeout(700);
  },
});

// ---- admin ----
await shot('admin-01-login', '/admin/login', VP.desktop);
// One admin look (Kegwall V2), dark or light by the device's color scheme.
async function adminCtx(scheme: 'dark' | 'light'): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: VP.desktop, colorScheme: scheme });
  const r = await ctx.request.post(`${base}/api/auth/login`, { data: ADMIN_LOGIN });
  if (!r.ok()) log.push(`LOGIN FAIL ${r.status()}`);
  return ctx;
}
const ADMIN_PAGES: [string, string][] = [
  ['dashboard', '/admin'], ['welcome', '/admin/welcome'], ['beers', '/admin/beers'], ['taps', '/admin/taps'],
  ['kegs', '/admin/kegs'], ['suppliers', '/admin/suppliers'], ['monitors', '/admin/monitors'], ['walls', '/admin/walls'],
  ['displays', '/admin/displays'], ['presence', '/admin/presence'], ['automations', '/admin/automations'],
  ['games', '/admin/games'], ['pours', '/admin/pours'], ['people', '/admin/people'], ['stats', '/admin/stats'],
  ['logs', '/admin/logs'], ['settings', '/admin/settings'], ['notifications', '/admin/notifications'],
  ['doctor', '/admin/doctor'], ['home-assistant', '/admin/home-assistant'],
];
const admin = await adminCtx('dark');
for (const [n, u] of ADMIN_PAGES) await shot(`admin-${n}`, u, VP.desktop, { ctx: admin, full: true, wait: 1500 });
const openEditor = async (p: Page) => { await p.getByRole('button', { name: /^edit/i }).first().click(); await p.waitForTimeout(1500); };
await shot('admin-wall-editor', '/admin/walls', VP.desktop, { ctx: admin, full: true, wait: 1200, before: openEditor });
await shot('admin-wall-editor-fold', '/admin/walls', VP.desktop, { ctx: admin, wait: 1200, before: openEditor });
await shot('admin-dashboard-laptop', '/admin', VP.laptop, { ctx: admin, wait: 1500 });
await shot('admin-dashboard-tablet', '/admin', VP.tabletL, { ctx: admin, wait: 1500 });
await shot('admin-dashboard-mobile', '/admin', VP.mobile, { ctx: admin, wait: 1500 });
await shot('admin-stats-mobile', '/admin/stats', VP.mobile, { ctx: admin, wait: 1500, full: true });
await shot('admin-menu-mobile', '/admin', VP.mobile, {
  ctx: admin, wait: 1500, before: async (p) => { await p.getByRole('button', { name: 'Menu' }).click(); await p.waitForTimeout(400); },
});
await shot('admin-palette', '/admin', VP.desktop, {
  ctx: admin, wait: 1500, before: async (p) => { await p.keyboard.press('Control+k'); await p.keyboard.type('ke'); await p.waitForTimeout(300); },
});
await shot('admin-account-menu', '/admin/taps', VP.desktop, {
  ctx: admin, wait: 1500, before: async (p) => { await p.getByTestId('admin-account').click(); await p.waitForTimeout(300); },
});
// M8 pages: drawers, the swap flow, phones.
await shot('admin-taps-drawer', '/admin/taps', VP.desktop, {
  ctx: admin, wait: 1500, before: async (p) => { await p.getByTestId('taps-row-expand').first().click(); await p.waitForTimeout(500); },
});
await shot('admin-taps-swap', '/admin/taps', VP.desktop, {
  ctx: admin,
  wait: 1500,
  before: async (p) => {
    await p.getByTestId('taps-row-swap').first().click();
    await p.waitForTimeout(300);
    const kick = p.getByTestId('swap-wizard-kick-button');
    if (await kick.count()) await kick.click();
    await p.waitForTimeout(500);
  },
});
await shot('admin-taps-mobile', '/admin/taps', VP.mobile, { ctx: admin, wait: 1500, full: true });
const light = await adminCtx('light');
for (const [n, u] of [['dashboard', '/admin'], ['taps', '/admin/taps'], ['stats', '/admin/stats']] as const) {
  await shot(`admin-light-${n}`, u, VP.desktop, { ctx: light, wait: 1500 });
}
await light.close();
await admin.close();

writeFileSync(join(OUT, '_log.txt'), log.join('\n'));
console.log(log.filter((l) => !l.startsWith('ok')).join('\n') || 'all ok', `\n${log.length} shots -> ${OUT}`);
await browser.close();
await app.close();
rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
