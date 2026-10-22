// Deterministic synthetic taproom for the visual harness (Kegwall V2, M0).
// Seeds 12 taps (one very long name, a cider with no IBU/SRM, a 4% and a 9% keg, one kicked
// keg), 45 days of pours, 6 pourers, 2 automations, one admin login, and one wall per
// look / theme / layout variant / takeover style the capture script photographs. Pure DB
// writes on an app built with `startSources: false` — no hardware, no notifications.
import type { FastifyInstance } from 'fastify';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createDrinker, createUser } from '../../src/server/db/users.js';
import { createWall } from '../../src/server/routes/crud.js';
import { setWallDevices } from '../../src/server/db/wallDevices.js';
import { createAutomation } from '../../src/server/db/automations.js';
import { getTemplate } from '../../src/server/automation/templates.js';

export const ADMIN_LOGIN = { username: 'owner', password: 'design-audit-pw' } as const;

export const LOOKS = [
  'classic', 'ledger', 'gallery', 'columns', 'chalkboard', 'editorial', 'neon', 'terminal',
  'poster', 'departures', 'zen',
] as const;
export const THEMES = [
  'midnight-slate', 'cream', 'cellar-teal', 'taproom-green', 'amber-glow', 'arcade', 'taproom',
  'chalkboard', 'bright', 'mono',
] as const;
export const TAKEOVERS = ['full', 'spotlight', 'split', 'dock', 'fill'] as const;

// name, brewery, style, abv, ibu, srm, fraction left, description
const BEERS: ReadonlyArray<readonly [string, string, string, number, number | null, number | null, number, string | null]> = [
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
];
const KEG_ML = 19000;
export const DEVICES = ['A', 'B', 'C', 'D'].map((d) => ({ type: 'kegtron_pro' as const, identifier: `shot-pro-${d}` }));

export interface SeededTaproom {
  tapIds: number[];
  /** Monitor ref feeding tap N (0-based), for driving synthetic pours on the bus. */
  monitorFor(tapIndex: number): { type: 'kegtron_pro'; identifier: string; portIndex: number };
}

export async function seedTaproom(app: FastifyInstance): Promise<SeededTaproom> {
  const db = app.ctx.db;
  const tapIds: number[] = [];
  const kegs: { id: number }[] = [];
  BEERS.forEach(([name, brewery, style, abv, ibu, srm, , description], i) => {
    const beer = createBeer(db, { name, brewery, style, abv, ibu, srm, description });
    const tap = createTap(db, { number: i + 1 });
    const keg = createKeg(db, { beerId: beer.id, sizeMl: KEG_ML, volStartMl: KEG_ML, tapId: tap.id });
    const mon = upsertMonitor(db, { ...DEVICES[Math.floor(i / 3)]!, portIndex: i % 3 }, { serial: `SHOT-${i}` });
    bindMonitorToTap(db, mon.id, tap.id);
    tapIds.push(tap.id);
    kegs.push(keg);
  });

  const colors = ['#c8963e', '#4e7a4e', '#3e6ec8', '#b04a6a', '#7a5ac8', '#2f9a8f'];
  const people = ['Dan', 'Sam', 'Alex Rivera', 'Priya', 'Jordan', 'Mo'].map((displayName, i) =>
    createDrinker(db, { displayName, avatarColor: colors[i] }));

  // Fixed-seed LCG so every run seeds the same pour history (relative to "now").
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let day = 45; day >= 1; day--) {
    const n = 2 + Math.floor(rnd() * 7);
    for (let p = 0; p < n; p++) {
      const keg = kegs[Math.floor(rnd() * 11)]!;
      const ts = new Date(Date.now() - day * 86_400_000 + (16 + rnd() * 6) * 3_600_000);
      recordPourTx(db, {
        kegId: keg.id, ts: ts.toISOString(), volumeMl: 280 + Math.floor(rnd() * 260),
        durationMs: 4000 + Math.floor(rnd() * 6000), source: 'cloud',
        drinkerId: rnd() < 0.6 ? people[Math.floor(rnd() * people.length)]!.id : null,
      });
    }
  }
  recordPourTx(db, { kegId: kegs[1]!.id, ts: new Date(Date.now() - 60_000).toISOString(), volumeMl: 355, durationMs: 5200, source: 'cloud' });
  kegs.forEach((k, i) => db.prepare('UPDATE kegs SET vol_dispensed_ml = ? WHERE id = ?')
    .run(Math.round(KEG_ML * (1 - BEERS[i]![6])), k.id));
  db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(kegs[11]!.id);

  createAutomation(db, {
    name: 'Banner on pour', trigger: { type: 'pour_completed' },
    actions: [{ type: 'wall_banner', text: '{{beer.name}} poured on tap {{tap.number}}', kind: 'celebrate', durationMs: 6000 }],
  });
  const [kegLow] = getTemplate('keg_low')!.build({ thresholdPct: 15 }, { servingSizeMl: 473 });
  createAutomation(db, kegLow!);
  await createUser(db, { ...ADMIN_LOGIN, displayName: 'Owner', role: 'admin' });
  for (const d of DEVICES) for (let port = 0; port < 3; port++) {
    app.ctx.bus.emit('telemetry', { monitor: { ...d, portIndex: port }, temp: 2.8 + port * 0.3, humidity: null, ts: new Date().toISOString() });
  }

  const header = { title: 'Garage Brewing Co.', subtitle: 'Fresh pours nightly', showClock: true, showTemp: true };
  const ticker = 'Trivia night Thursday · Happy hour 4–6pm · New: Kriek Reserve on tap 6';
  const wall = (slug: string, config: Record<string, unknown>) => {
    const w = createWall(db, { slug, name: 'Garage Brewing Co.', config: { header, ticker, showQr: true, ...config } });
    setWallDevices(db, w.id, DEVICES);
  };
  const page8 = [{ tapIds: tapIds.slice(0, 8) }];
  wall('main', { columns: 4, pages: page8, theme: { id: 'midnight-slate' } });
  for (const look of LOOKS) wall(`look-${look}`, { look, columns: 4, pages: page8 });
  for (const id of THEMES) wall(`theme-${id}`, { columns: 3, pages: [{ tapIds: tapIds.slice(0, 6) }], theme: { id } });
  wall('taps4', { columns: 2, pages: [{ tapIds: tapIds.slice(0, 4) }] });
  wall('taps12', { columns: 6, pages: [{ tapIds }] });
  wall('fill-keg', { columns: 4, pages: page8, fillStyle: 'keg' });
  for (const t of ['full', 'compact', 'minimal']) wall(`tpl-${t}`, { columns: 4, pages: page8, cardTemplate: t });
  wall('rotate', { columns: 4, pages: [{ tapIds: tapIds.slice(0, 6) }, { tapIds: tapIds.slice(6) }], rotationSeconds: 3 });
  wall('saver', { columns: 4, pages: page8, displayPower: { screensaverAfterMinutes: 1, offAfterMinutes: null, cameraMotion: false } });
  for (const style of TAKEOVERS) {
    wall(`pour-${style}`, { columns: 4, pages: page8, takeover: { style, minMl: 60 }, look: style === 'spotlight' ? 'ledger' : 'classic' });
  }

  return {
    tapIds,
    monitorFor: (i) => ({ ...DEVICES[Math.floor(i / 3)]!, portIndex: i % 3 }),
  };
}
