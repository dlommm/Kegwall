import { createContext } from '../src/server/context.js';
import { createBeer } from '../src/server/db/beers.js';
import { createTap } from '../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../src/server/db/monitors.js';
import { createDrinker } from '../src/server/db/users.js';
import { createWall, getWallBySlug } from '../src/server/routes/crud.js';

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
const kegs = beers.map((beer, i) => {
  const tap = createTap(db, { number: tapBase + i + 1 });
  const keg = createKeg(db, { beerId: beer.id, sizeMl: 19000, volStartMl: 19000, tapId: tap.id });
  if (i < 2) {
    const mon = upsertMonitor(db, {
      type: i === 0 ? 'kegtron_pro' : 'kegtron_gen1',
      identifier: i === 0 ? 'seed-device-1' : 'aa:bb:cc:dd:ee:01',
      portIndex: 0,
    }, { serial: `SEED-${i}` });
    bindMonitorToTap(db, mon.id, tap.id);
  }
  return keg;
});

createDrinker(db, { displayName: 'Dan', avatarColor: '#c8963e' });
createDrinker(db, { displayName: 'Sam', avatarColor: '#4e7a4e' });

// walls.slug is UNIQUE; guard re-runs the same way as the tap-number fix above
// (skip insert if 'main' already exists) so reseeding never crashes.
if (!getWallBySlug(db, 'main')) {
  createWall(db, { slug: 'main', name: 'Main Wall', config: { columns: 2 } });
}

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

console.log('Seeded: 4 beers, 4 taps, 4 kegs, 2 monitors, 2 drinkers, 30 days of pours');
