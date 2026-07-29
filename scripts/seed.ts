import { createContext } from '../src/server/context.js';
import { createBeer } from '../src/server/db/beers.js';
import { createTap } from '../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../src/server/db/monitors.js';
import { createDrinker } from '../src/server/db/users.js';
import { createWall, getWallBySlug } from '../src/server/routes/crud.js';
import { setWallDevices } from '../src/server/db/wallDevices.js';
import { createAutomation, listAutomations } from '../src/server/db/automations.js';
import { getTemplate } from '../src/server/automation/templates.js';

const { db } = createContext(process.env.DATA_DIR ?? './data');

const beers = [
  { name: 'Citra Haze', brewery: 'Garage Brewing', style: 'Hazy IPA', abv: 6.8, ibu: 45, srm: 4 },
  { name: 'Vienna Nights', brewery: 'Garage Brewing', style: 'Vienna Lager', abv: 5.0, ibu: 22, srm: 11 },
  { name: 'Belgian Sun', brewery: 'Garage Brewing', style: 'Belgian Tripel', abv: 9.1, ibu: 28, srm: 5 },
  { name: 'Midnight Oats', brewery: 'Garage Brewing', style: 'Oatmeal Stout', abv: 5.6, ibu: 32, srm: 38 },
].map((b) => createBeer(db, b));

const dispensed = [3200, 9500, 1100, 15200];
// taps.number is UNIQUE; offset by existing tap count so re-running the seed
// (dev convenience, not just first-run) never collides — see brief Step 4:
// "second run adds more rows, never crashes".
const tapBase = (db.prepare('SELECT COUNT(*) c FROM taps').get() as { c: number }).c;
// Every tap gets a device port: taps 0/2/3 on a 3-port Kegtron Pro, tap 1 on a Gen 1.
// Wall scoping is strict (a wall shows only taps bound to its assigned devices), so an
// unbound tap would never appear on the seeded wall.
const kegs = beers.map((beer, i) => {
  const tap = createTap(db, { number: tapBase + i + 1 });
  const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
  const mon = i === 1
    ? upsertMonitor(db, {
        type: 'kegtron_gen1', identifier: 'aa:bb:cc:dd:ee:01', portIndex: 0,
      }, { serial: 'SEED-1' })
    : upsertMonitor(db, {
        type: 'kegtron_pro', identifier: 'seed-device-1', portIndex: i === 0 ? 0 : i - 1,
      }, { serial: 'SEED-0' });
  bindMonitorToTap(db, mon.id, tap.id);
  return keg;
});

createDrinker(db, { displayName: 'Dan', avatarColor: '#c8963e' });
createDrinker(db, { displayName: 'Sam', avatarColor: '#4e7a4e' });

// walls.slug is UNIQUE; guard re-runs the same way as the tap-number fix above
// (skip insert if 'main' already exists) so reseeding never crashes.
if (!getWallBySlug(db, 'main')) {
  createWall(db, { slug: 'main', name: 'Main Wall', config: { columns: 2 } });
}
// Replace-set is idempotent, so reseeding just reasserts the same assignment.
setWallDevices(db, getWallBySlug(db, 'main')!.id, [
  { type: 'kegtron_pro', identifier: 'seed-device-1' },
  { type: 'kegtron_gen1', identifier: 'aa:bb:cc:dd:ee:01' },
]);

// 30 days of pours, weighted to evenings
for (let day = 30; day >= 1; day--) {
  const pourCount = 2 + Math.floor(Math.random() * 5);
  for (let p = 0; p < pourCount; p++) {
    const keg = kegs[Math.floor(Math.random() * kegs.length)]!;
    const ts = new Date(Date.now() - day * 86_400_000 + (17 + Math.random() * 5) * 3_600_000);
    recordPourTx(db, {
      kegId: keg.id, ts: ts.toISOString(),
      volumeMl: 300 + Math.floor(Math.random() * 250),
      durationMs: 4000 + Math.floor(Math.random() * 6000), source: 'cloud',
    });
  }
}

// align dispensed totals to something visually interesting
kegs.forEach((keg, i) => {
  db.prepare('UPDATE kegs SET vol_dispensed_ml = ? WHERE id = ?').run(dispensed[i], keg.id);
});

// Phase 5 Task 4: 2 example automations, named distinctively enough to skip re-creating
// on a re-run (same "second run adds more rows, never crashes" guard as the tap-number/
// wall-slug fixes above — automations have no unique constraint of their own, so this
// checks by name before inserting).
const existingAutomationNames = new Set(listAutomations(db).map((a) => a.name));

if (!existingAutomationNames.has('Banner on pour')) {
  createAutomation(db, {
    name: 'Banner on pour',
    trigger: { type: 'pour_completed' },
    actions: [{
      type: 'wall_banner', text: '{{beer.name}} poured on tap {{tap.number}}', kind: 'celebrate', durationMs: 6000,
    }],
  });
}

const kegLowName = 'Keg low (below 15%)';
if (!existingAutomationNames.has(kegLowName)) {
  const [kegLowRule] = getTemplate('keg_low')!.build({ thresholdPct: 15 }, { servingSizeMl: 473 });
  createAutomation(db, kegLowRule!);
}

console.log('Seeded: 4 beers, 4 taps, 4 kegs, 2 monitors, 2 drinkers, 30 days of pours, 2 automations');
