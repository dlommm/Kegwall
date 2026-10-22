// Pixel diff between two capture.ts runs (Kegwall V2, M0). Compares every PNG present in both
// folders inside headless Chromium (canvas getImageData — no image library needed), writes a
// red-highlighted diff image for each changed shot plus an index.html report, and exits 1 when
// any shot changes more than the threshold.
//
//   npx tsx scripts/visual/diff.ts <before-dir> <after-dir> [--out <dir>] [--max-pct 0.5]
//
// A pixel counts as changed when any channel differs by more than 24/255 — enough to ignore
// anti-aliasing and JPEG-like noise from font hinting, small enough to catch real changes.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const outArg = flag('--out');
const maxPct = Number(flag('--max-pct') ?? '0.5');
const [beforeDir, afterDir] = args.map((a) => resolve(a));
if (!beforeDir || !afterDir) {
  console.error('usage: diff.ts <before-dir> <after-dir> [--out <dir>] [--max-pct 0.5]');
  process.exit(2);
}
const OUT = resolve(outArg ?? join(afterDir, '_diff'));
mkdirSync(OUT, { recursive: true });

const names = readdirSync(beforeDir).filter((f) => f.endsWith('.png'));
const missing = names.filter((n) => !existsSync(join(afterDir, n)));
const added = readdirSync(afterDir).filter((f) => f.endsWith('.png') && !names.includes(f));

const browser = await chromium.launch(process.env.KEGWALL_CHROMIUM ? { executablePath: process.env.KEGWALL_CHROMIUM } : {});
const page = await browser.newPage();
await page.setContent('<canvas id="a"></canvas><canvas id="b"></canvas>');

// Runs in the page: returns the changed fraction and a PNG data URL of the diff overlay.
const COMPARE = `async ([a, b]) => {
  const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  const read = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
  const da = read(ia), db = read(ib);
  const out = new ImageData(w, h);
  let changed = 0;
  for (let p = 0; p < da.data.length; p += 4) {
    const d = Math.max(Math.abs(da.data[p] - db.data[p]), Math.abs(da.data[p+1] - db.data[p+1]), Math.abs(da.data[p+2] - db.data[p+2]));
    const g = (db.data[p] + db.data[p+1] + db.data[p+2]) / 3 * 0.35;
    if (d > 24) { changed++; out.data[p] = 255; out.data[p+1] = 0; out.data[p+2] = 0; }
    else { out.data[p] = g; out.data[p+1] = g; out.data[p+2] = g; }
    out.data[p+3] = 255;
  }
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(out, 0, 0);
  return { pct: (changed / (w * h)) * 100, sizeChanged: ia.width !== ib.width || ia.height !== ib.height, diff: c.toDataURL('image/png') };
}`;

type Row = { name: string; pct: number; sizeChanged: boolean };
const rows: Row[] = [];
for (const name of names.filter((n) => !missing.includes(n))) {
  const url = (dir: string) => `data:image/png;base64,${readFileSync(join(dir, name)).toString('base64')}`;
  const r = await page.evaluate(`(${COMPARE})(${JSON.stringify([url(beforeDir), url(afterDir)])})`) as
    { pct: number; sizeChanged: boolean; diff: string };
  rows.push({ name, pct: r.pct, sizeChanged: r.sizeChanged });
  if (r.pct > 0) writeFileSync(join(OUT, name), Buffer.from(r.diff.split(',')[1]!, 'base64'));
}
await browser.close();

rows.sort((x, y) => y.pct - x.pct);
const over = rows.filter((r) => r.pct > maxPct || r.sizeChanged);
const rel = (dir: string, n: string) => `file://${join(dir, n)}`;
writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Visual diff</title>
<style>body{font:14px system-ui;background:#111;color:#eee;margin:16px}table{border-collapse:collapse}
td{padding:6px;vertical-align:top;border-top:1px solid #333}img{width:420px}.bad{color:#ff6b6b}</style>
<h1>${over.length} of ${rows.length} shots over ${maxPct}%</h1>
${missing.length ? `<p class="bad">Missing in after: ${missing.join(', ')}</p>` : ''}
${added.length ? `<p>New in after: ${added.join(', ')}</p>` : ''}
<table>${rows.map((r) => `<tr><td class="${r.pct > maxPct || r.sizeChanged ? 'bad' : ''}">${r.name}<br>${r.pct.toFixed(3)}%${r.sizeChanged ? ' · size changed' : ''}</td>
<td><img src="${rel(beforeDir, r.name)}"></td><td><img src="${rel(afterDir, r.name)}"></td><td>${r.pct > 0 ? `<img src="${r.name}">` : ''}</td></tr>`).join('')}</table>`);

for (const r of rows) if (r.pct > 0) console.log(`${r.pct > maxPct || r.sizeChanged ? 'OVER ' : '     '}${r.pct.toFixed(3).padStart(8)}%  ${r.name}${r.sizeChanged ? ' (size changed)' : ''}`);
if (missing.length) console.log(`missing in after: ${missing.join(', ')}`);
if (added.length) console.log(`new in after: ${added.join(', ')}`);
console.log(`${over.length}/${rows.length} over ${maxPct}% -> ${join(OUT, 'index.html')}`);
process.exit(over.length || missing.length ? 1 : 0);
