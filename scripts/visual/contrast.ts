// Contrast check (Kegwall V2): renders every V2 wall look in every theme and measures each
// piece of text against what is actually behind it (elementsFromPoint, so a keg fill or a
// beer-color field under the text counts), including inherited opacity. Fails when body text
// is under 4.5:1 or large text (≥ 24px, or ≥ 18.66px bold) under 3:1.
//
//   npm run build && npx tsx scripts/visual/contrast.ts [look-filter]
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { buildApp } from '../../src/server/app.js';
import { createWall } from '../../src/server/routes/crud.js';
import { setWallDevices } from '../../src/server/db/wallDevices.js';
import { DEVICES, THEMES, seedTaproom } from './seed.js';

/** The looks drawn on the V2 stage; each milestone adds the looks it redraws. */
export const STAGE_LOOKS = [
  'just-tapped', 'classic', 'ledger', 'columns', 'gallery', 'chalkboard', 'editorial', 'neon',
  'terminal', 'poster', 'departures', 'zen', 'handles', 'tally',
] as const;

const ONLY = process.argv[2] ?? '';
const dataDir = mkdtempSync(join(tmpdir(), 'kw-contrast-'));
process.env.NODE_ENV = 'test';
const app = await buildApp({ dataDir, webDir: 'dist/web', startSources: false });
const base = await app.listen({ port: 0, host: '127.0.0.1' });
const { tapIds } = await seedTaproom(app);
const looks = STAGE_LOOKS.filter((l) => l.includes(ONLY));
for (const look of looks) for (const theme of THEMES) {
  const w = createWall(app.ctx.db, {
    slug: `c-${look}-${theme}`, name: 'Garage Brewing Co.',
    config: {
      look, theme: { id: theme }, showQr: true, ticker: 'Trivia night Thursday',
      header: { showClock: true, showTemp: true }, pages: [{ tapIds }],
    },
  });
  setWallDevices(app.ctx.db, w.id, DEVICES);
}

// Runs in the page. Returns one entry per failing text element.
const MEASURE = `() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const opacityOf = (el) => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const out = [];
  for (const el of document.querySelectorAll('[data-look] *')) {
    if (el.closest('[aria-hidden="true"]')) continue; // decorative (e.g. the giant tap numeral)
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    const fg = parse(cs.color); if (!fg) continue;
    const x = Math.min(r.left + r.width / 2, innerWidth - 1), y = Math.min(r.top + r.height / 2, innerHeight - 1);
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    const stack = document.elementsFromPoint(x, y);
    const from = Math.max(0, stack.indexOf(el));
    for (const under of stack.slice(from)) {
      const c = parse(getComputedStyle(under).backgroundColor);
      if (c && c.a >= 0.99) { bg = c; break; }
    }
    const alpha = fg.a * opacityOf(el);
    const seen = { r: bg.r + (fg.r - bg.r) * alpha, g: bg.g + (fg.g - bg.g) * alpha, b: bg.b + (fg.b - bg.b) * alpha };
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const got = ratio(seen, bg);
    if (got < need) out.push({ text: el.textContent.trim().slice(0, 40), size: Math.round(size), got: Math.round(got * 100) / 100, need });
  }
  return out;
}`;

const browser = await chromium.launch(process.env.KEGWALL_CHROMIUM ? { executablePath: process.env.KEGWALL_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
let failures = 0;
for (const look of looks) for (const theme of THEMES) {
  await page.goto(`${base}/wall/c-${look}-${theme}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-look]', { timeout: 10_000 });
  await page.waitForTimeout(400);
  const bad = await page.evaluate(`(${MEASURE})()`) as { text: string; size: number; got: number; need: number }[];
  if (bad.length) {
    failures += bad.length;
    console.log(`FAIL ${look} × ${theme}`);
    for (const b of bad.slice(0, 8)) console.log(`     ${b.got}:1 < ${b.need}:1  ${b.size}px  "${b.text}"`);
    if (bad.length > 8) console.log(`     … and ${bad.length - 8} more`);
  } else {
    console.log(`ok   ${look} × ${theme}`);
  }
}
await browser.close();
await app.close();
rmSync(dataDir, { recursive: true, force: true });
console.log(failures ? `${failures} text elements below WCAG contrast` : 'all text meets WCAG contrast');
process.exit(failures ? 1 : 0);
