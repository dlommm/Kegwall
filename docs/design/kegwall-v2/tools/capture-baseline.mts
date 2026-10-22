// Baseline screenshot harness for the Kegwall V2 design audit.
// Boots a real buildApp() against a throwaway data dir (startSources:false — no BLE/MQTT/UDP/
// cloud, no notifications), seeds deterministic synthetic data, and captures every surface.
//
// Usage (from the repo root, after `npm run build`):
//   npx tsx docs/design/kegwall-v2/tools/capture-baseline.mts <out-dir> [name-filter]
// Set KEGWALL_CHROMIUM=/path/to/chrome if Playwright's pinned browser isn't installed.
// The out-dir's parent receives a temporary data dir, removed on exit. Re-run it after each
// milestone to produce the matching "after" set.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const REPO = process.cwd();
const { chromium } = await import(`${REPO}/node_modules/@playwright/test/index.mjs`);
const { buildApp } = await import(`${REPO}/src/server/app.ts`);
const { createBeer } = await import(`${REPO}/src/server/db/beers.ts`);
const { createTap } = await import(`${REPO}/src/server/db/taps.ts`);
const { createKeg, recordPourTx } = await import(`${REPO}/src/server/db/kegs.ts`);
const { upsertMonitor, bindMonitorToTap } = await import(`${REPO}/src/server/db/monitors.ts`);
const { createDrinker, createUser } = await import(`${REPO}/src/server/db/users.ts`);
const { createWall } = await import(`${REPO}/src/server/routes/crud.ts`);
const { setWallDevices } = await import(`${REPO}/src/server/db/wallDevices.ts`);
const { createAutomation } = await import(`${REPO}/src/server/db/automations.ts`);
const { getTemplate } = await import(`${REPO}/src/server/automation/templates.ts`);

const OUT = process.argv[2]!;
const ONLY = process.argv[3] ?? '';
mkdirSync(OUT, { recursive: true });
const log: string[] = [];

const dataDir = mkdtempSync(join(resolve(OUT, '..'), 'data-'));
process.env.NODE_ENV = 'test';
const app = await buildApp({ dataDir, webDir: `${REPO}/dist/web`, startSources: false });
const base = await app.listen({ port: 0, host: '127.0.0.1' });
const db = app.ctx.db;
const browser = await chromium.launch(process.env.KEGWALL_CHROMIUM ? { executablePath: process.env.KEGWALL_CHROMIUM } : {});

const VP = {
  tv720: { width: 1280, height: 720 }, tv1080: { width: 1920, height: 1080 },
  tv4k: { width: 3840, height: 2160 }, desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 }, tabletL: { width: 1024, height: 768 },
  tabletP: { width: 800, height: 1280 }, mobile: { width: 390, height: 844 },
};

async function shot(name: string, url: string, vp: { width: number; height: number }, opts: {
  ctx?: any; full?: boolean; before?: (p: any) => Promise<void>; wait?: number; scheme?: 'dark' | 'light';
} = {}) {
  if (ONLY && !name.includes(ONLY)) return;
  const ctx = opts.ctx ?? await browser.newContext({ viewport: vp, colorScheme: opts.scheme ?? 'dark' });
  const page = await ctx.newPage();
  if (opts.ctx) await page.setViewportSize(vp);
  try {
    await page.goto(`${base}${url}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(opts.wait ?? 900);
    if (opts.before) await opts.before(page);
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: opts.full ?? false });
    log.push(`ok ${name} ${url}`);
  } catch (e) {
    log.push(`FAIL ${name} ${url} ${(e as Error).message.split('\n')[0]}`);
    try { await page.screenshot({ path: join(OUT, `${name}.png`) }); } catch {}
  }
  await page.close();
  if (!opts.ctx) await ctx.close();
}

// ---- before any login user exists: first-run setup + display pairing ----
await shot('admin-00-setup', '/admin/setup', VP.desktop);
await shot('display-pairing-tv1080', '/display', VP.tv1080);

// ---- synthetic taproom ----
const BEERS = [
  ['Citra Haze', 'Garage Brewing', 'Hazy IPA', 6.8, 45, 4, 0.83, 'Bright citrus and dank pine, brewed hazy.'],
  ['Vienna Nights', 'Garage Brewing', 'Vienna Lager', 5.0, 22, 11, 0.50, 'Toasty malt, clean amber lager.'],
  ['Belgian Sun', 'Abbey Road Ales', 'Belgian Tripel', 9.1, 28, 5, 0.94, 'Spicy, fruity, deceptively strong.'],
  ['Midnight Oats', 'Garage Brewing', 'Oatmeal Stout', 5.6, 32, 38, 0.04, 'Silky roast and dark chocolate finish.'],
  ['The Extraordinarily Long-Named Double Dry-Hopped Imperial West Coast IPA', 'Bottle Logic Brewing & Fermentation Laboratory', 'Double IPA', 8.4, 85, 7, 0.61, 'A stress test for every layout on the wall.'],
  ['Kriek Reserve', 'Wild Cellar', 'Fruited Sour', 6.0, 10, 22, 0.30, 'Tart cherry, oak, and funk.'],
  ['Helles Yeah', 'Garage Brewing', 'Munich Helles', 4.8, 18, 3, 0.72, 'Crisp, bready, endlessly drinkable.'],
  ['Campfire Porter', 'Smokestack', 'Smoked Porter', 6.2, 35, 30, 0.18, 'Beechwood smoke over cocoa.'],
  ['Weiss Guy', 'Garage Brewing', 'Hefeweizen', 5.2, 12, 4, 1.0, 'Banana, clove, cloudy.'],
  ['Orchard Dry', 'Hillside Cider', 'Cider', 6.5, null, null, 0.40, null],
  ['Old Thunder', 'Garage Brewing', 'English Barleywine', 11.5, 60, 18, 0.09, 'Toffee, figs, warming.'],
  ['Gourd Times', 'Garage Brewing', 'Pumpkin Ale', 5.5, 20, 14, 0.0, 'Seasonal — kicked.'],
] as const;
const SIZE = 19000;
const taps: any[] = []; const kegs: any[] = [];
const DEVICES = ['A', 'B', 'C', 'D'].map((d) => ({ type: 'kegtron_pro' as const, identifier: `shot-pro-${d}` }));
BEERS.forEach(([name, brewery, style, abv, ibu, srm, , description], i) => {
  const beer = createBeer(db, { name, brewery, style, abv, ibu, srm, description });
  const tap = createTap(db, { number: i + 1 });
  const keg = createKeg(db, { beerId: beer.id, sizeMl: SIZE, volStartMl: SIZE, tapId: tap.id });
  const mon = upsertMonitor(db, { ...DEVICES[Math.floor(i / 3)]!, portIndex: i % 3 }, { serial: `SHOT-${i}` });
  bindMonitorToTap(db, mon.id, tap.id);
  taps.push(tap); kegs.push(keg);
});
const people = ['Dan', 'Sam', 'Alex Rivera', 'Priya', 'Jordan', 'Mo'].map((n, i) =>
  createDrinker(db, { displayName: n, avatarColor: ['#c8963e', '#4e7a4e', '#3e6ec8', '#b04a6a', '#7a5ac8', '#2f9a8f'][i] }));
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
for (let day = 45; day >= 1; day--) {
  const n = 2 + Math.floor(rnd() * 7);
  for (let p = 0; p < n; p++) {
    const k = kegs[Math.floor(rnd() * 11)]!;
    const ts = new Date(Date.now() - day * 86_400_000 + (16 + rnd() * 6) * 3_600_000);
    recordPourTx(db, { kegId: k.id, ts: ts.toISOString(), volumeMl: 280 + Math.floor(rnd() * 260),
      durationMs: 4000 + Math.floor(rnd() * 6000), source: 'cloud',
      drinkerId: rnd() < 0.6 ? people[Math.floor(rnd() * people.length)]!.id : null });
  }
}
recordPourTx(db, { kegId: kegs[1].id, ts: new Date(Date.now() - 60_000).toISOString(), volumeMl: 355, durationMs: 5200, source: 'cloud' });
kegs.forEach((k, i) => db.prepare('UPDATE kegs SET vol_dispensed_ml = ? WHERE id = ?').run(Math.round(SIZE * (1 - (BEERS[i]![6] as number))), k.id));
db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(kegs[11].id);
createAutomation(db, { name: 'Banner on pour', trigger: { type: 'pour_completed' },
  actions: [{ type: 'wall_banner', text: '{{beer.name}} poured on tap {{tap.number}}', kind: 'celebrate', durationMs: 6000 }] });
const [kegLow] = getTemplate('keg_low')!.build({ thresholdPct: 15 }, { servingSizeMl: 473 });
createAutomation(db, kegLow!);
await createUser(db, { username: 'owner', displayName: 'Owner', password: 'design-audit-pw', role: 'admin' });
for (const d of DEVICES) for (let port = 0; port < 3; port++) {
  app.ctx.bus.emit('telemetry', { monitor: { ...d, portIndex: port }, temp: 2.8 + port * 0.3, humidity: null, ts: new Date().toISOString() });
}

const ids = taps.map((t) => t.id);
const header = { title: 'Garage Brewing Co.', subtitle: 'Fresh pours nightly', showClock: true, showTemp: true };
const ticker = 'Trivia night Thursday · Happy hour 4–6pm · New: Kriek Reserve on tap 6';
function wall(slug: string, config: Record<string, unknown>) {
  const w = createWall(db, { slug, name: 'Garage Brewing Co.', config: { header, ticker, showQr: true, ...config } });
  setWallDevices(db, w.id, DEVICES);
  return w;
}
const page8 = [{ tapIds: ids.slice(0, 8) }];
wall('main', { columns: 4, pages: page8, theme: { id: 'midnight-slate' } });
const LOOKS = ['classic', 'ledger', 'gallery', 'columns', 'chalkboard', 'editorial', 'neon', 'terminal', 'poster', 'departures', 'zen'];
for (const look of LOOKS) wall(`look-${look}`, { look, columns: 4, pages: page8 });
const THEMES = ['midnight-slate', 'cream', 'cellar-teal', 'taproom-green', 'amber-glow', 'arcade', 'taproom', 'chalkboard', 'bright', 'mono'];
for (const id of THEMES) wall(`theme-${id}`, { columns: 3, pages: [{ tapIds: ids.slice(0, 6) }], theme: { id } });
wall('taps4', { columns: 2, pages: [{ tapIds: ids.slice(0, 4) }] });
wall('taps12', { columns: 6, pages: [{ tapIds: ids }] });
wall('fill-keg', { columns: 4, pages: page8, fillStyle: 'keg' });
for (const t of ['full', 'compact', 'minimal']) wall(`tpl-${t}`, { columns: 4, pages: page8, cardTemplate: t });
wall('rotate', { columns: 4, pages: [{ tapIds: ids.slice(0, 6) }, { tapIds: ids.slice(6) }], rotationSeconds: 3 });
wall('saver', { columns: 4, pages: page8, displayPower: { screensaverAfterMinutes: 1, offAfterMinutes: null, cameraMotion: false } });
const TAKEOVERS = ['full', 'spotlight', 'split', 'dock', 'fill'];
for (const style of TAKEOVERS) wall(`pour-${style}`, { columns: 4, pages: page8, takeover: { style, minMl: 60 }, look: style === 'spotlight' ? 'ledger' : 'classic' });

// ---- public TV wall ----
for (const look of LOOKS) await shot(`wall-look-${look}-1080`, `/wall/look-${look}`, VP.tv1080);
for (const id of THEMES) await shot(`wall-theme-${id}-1080`, `/wall/theme-${id}`, VP.tv1080);
await shot('wall-main-720', '/wall/main', VP.tv720);
await shot('wall-main-1080', '/wall/main', VP.tv1080);
await shot('wall-main-4k', '/wall/main', VP.tv4k);
await shot('wall-look-ledger-720', '/wall/look-ledger', VP.tv720);
await shot('wall-look-gallery-4k', '/wall/look-gallery', VP.tv4k);
await shot('wall-taps4-1080', '/wall/taps4', VP.tv1080);
await shot('wall-taps12-1080', '/wall/taps12', VP.tv1080);
await shot('wall-fill-keg-1080', '/wall/fill-keg', VP.tv1080);
for (const t of ['full', 'compact', 'minimal']) await shot(`wall-tpl-${t}-1080`, `/wall/tpl-${t}`, VP.tv1080);
await shot('wall-rotate-mid-1080', '/wall/rotate', VP.tv1080, { wait: 4500 });
await shot('wall-screensaver-1080', '/wall/saver', VP.tv1080, {
  before: async (p) => { await p.clock.install(); await p.reload({ waitUntil: 'networkidle' }); await p.clock.fastForward('01:30'); await p.waitForTimeout(800); },
});
await shot('board-leaderboard-1080', '/board', VP.tv1080);

// ---- live pour: open every takeover wall, then drive a synthetic pour on tap 1 ----
if (!ONLY || ONLY.startsWith('pour')) {
  const ctx = await browser.newContext({ viewport: VP.tv1080, colorScheme: 'dark' });
  const pages: [string, any][] = [];
  for (const style of TAKEOVERS) {
    const p = await ctx.newPage(); await p.goto(`${base}/wall/pour-${style}`, { waitUntil: 'networkidle' }); pages.push([style, p]);
  }
  const mon = { ...DEVICES[0]!, portIndex: 0 };
  app.ctx.bus.emit('pour_started', { monitor: mon, ts: new Date().toISOString() });
  for (const ml of [90, 160, 236]) { app.ctx.bus.emit('pour_progress', { monitor: mon, curServMl: ml, ts: new Date().toISOString() }); await new Promise((r) => setTimeout(r, 500)); }
  await new Promise((r) => setTimeout(r, 900));
  for (const [s, p] of pages) { await p.screenshot({ path: join(OUT, `pour-${s}-active-1080.png`) }); log.push(`ok pour-${s}-active`); }
  app.ctx.bus.emit('pour_completed', { monitor: mon, volumeMl: 412, durationMs: 6100, source: 'udp', ts: new Date().toISOString() });
  await new Promise((r) => setTimeout(r, 700));
  for (const [s, p] of pages) { await p.screenshot({ path: join(OUT, `pour-${s}-complete-1080.png`) }); log.push(`ok pour-${s}-complete`); }
  await ctx.close();
}

// ---- public + touch ----
await shot('menu-mobile', '/menu', VP.mobile, { full: true });
await shot('menu-mobile-light', '/menu', VP.mobile, { scheme: 'light' });
await shot('menu-tablet', '/menu', VP.tabletP);
await shot('menu-desktop', '/menu', VP.desktop);
await shot('menu-claim-sheet', '/menu', VP.mobile, { before: async (p) => {
  const b = p.getByTestId('claim-sheet-pour').first(); if (await b.count()) { await b.click(); await p.waitForTimeout(2500); }
} });
await shot('tablet-kiosk-avatars', '/tablet/main', VP.tabletL);
await shot('tablet-kiosk-portrait', '/tablet/main', VP.tabletP);
await shot('tablet-kiosk-signup', '/tablet/main', VP.tabletL, { before: async (p) => { await p.getByTestId('tablet-signup-button').click(); await p.waitForTimeout(500); } });
await shot('tablet-kiosk-armed', '/tablet/main', VP.tabletL, { before: async (p) => {
  await p.getByTestId('tablet-avatar').first().click(); await p.waitForTimeout(300);
  const s = p.getByTestId('tablet-session-start'); if (await s.count()) await s.click(); await p.waitForTimeout(700);
} });

// ---- admin ----
await shot('admin-01-login', '/admin/login', VP.desktop);
const LOOKS_ADMIN = ['midnight', 'workshop', 'console'] as const;
async function adminCtx(look: string, vp = VP.desktop) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: look === 'workshop' ? 'light' : 'dark' });
  await ctx.addInitScript((l: string) => { try { localStorage.setItem('kegtron.adminTheme', l); } catch {} }, look);
  const r = await ctx.request.post(`${base}/api/auth/login`, { data: { username: 'owner', password: 'design-audit-pw' } });
  if (!r.ok()) log.push(`LOGIN FAIL ${r.status()}`);
  return ctx;
}
const ADMIN = [
  ['dashboard', '/admin'], ['welcome', '/admin/welcome'], ['beers', '/admin/beers'], ['taps', '/admin/taps'],
  ['kegs', '/admin/kegs'], ['suppliers', '/admin/suppliers'], ['monitors', '/admin/monitors'], ['walls', '/admin/walls'],
  ['displays', '/admin/displays'], ['presence', '/admin/presence'], ['automations', '/admin/automations'],
  ['games', '/admin/games'], ['pours', '/admin/pours'], ['people', '/admin/people'], ['stats', '/admin/stats'],
  ['logs', '/admin/logs'], ['settings', '/admin/settings'], ['notifications', '/admin/notifications'],
  ['doctor', '/admin/doctor'], ['home-assistant', '/admin/home-assistant'],
];
const mid = await adminCtx('midnight');
for (const [n, u] of ADMIN) await shot(`admin-${n}`, u, VP.desktop, { ctx: mid, full: true, wait: 1500 });
await shot('admin-wall-editor', '/admin/walls', VP.desktop, { ctx: mid, full: true, wait: 1200, before: async (p) => {
  await p.getByRole('button', { name: /^edit/i }).first().click(); await p.waitForTimeout(1500);
} });
await shot('admin-wall-editor-fold', '/admin/walls', VP.desktop, { ctx: mid, wait: 1200, before: async (p) => {
  await p.getByRole('button', { name: /^edit/i }).first().click(); await p.waitForTimeout(1500);
} });
await shot('admin-dashboard-laptop', '/admin', VP.laptop, { ctx: mid, wait: 1500 });
await shot('admin-dashboard-tablet', '/admin', VP.tabletL, { ctx: mid, wait: 1500 });
await shot('admin-dashboard-mobile', '/admin', VP.mobile, { ctx: mid, wait: 1500 });
await shot('admin-stats-mobile', '/admin/stats', VP.mobile, { ctx: mid, wait: 1500, full: true });
for (const look of ['workshop', 'console']) {
  const c = await adminCtx(look);
  for (const [n, u] of [['dashboard', '/admin'], ['taps', '/admin/taps'], ['stats', '/admin/stats']]) {
    await shot(`admin-${look}-${n}`, u!, VP.desktop, { ctx: c, wait: 1500 });
  }
  await c.close();
}
await mid.close();

writeFileSync(join(OUT, '_log.txt'), log.join('\n'));
console.log(log.filter((l) => !l.startsWith('ok')).join('\n') || 'all ok', `\n${log.length} shots`);
await browser.close(); await app.close();
rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
