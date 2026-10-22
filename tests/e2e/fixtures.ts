import type { AppContext } from '../../src/server/context.js';
import type { MonitorRef } from '../../src/server/core/events.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import { createKeg, recordPourTx } from '../../src/server/db/kegs.js';
import { upsertMonitor, bindMonitorToTap } from '../../src/server/db/monitors.js';
import { createDrinker } from '../../src/server/db/users.js';
import { createWall, getWallBySlug } from '../../src/server/routes/crud.js';
import { setWallDevices } from '../../src/server/db/wallDevices.js';

/**
 * Deterministic seed data for the Playwright E2E specs — one fixture set so every spec
 * runs against the exact same taproom, not a second, drifted copy of `scripts/seed.ts`.
 *
 * Deliberately NOT randomized (unlike `scripts/seed.ts`'s pour history): every level and
 * every kicked/on-tap status here is fixed so screenshots and WS-update assertions are
 * reproducible run to run.
 */
export const E2E_BEERS = [
  {
    name: 'Citra Haze', brewery: 'Garage Brewing', style: 'Hazy IPA',
    abv: 6.8, ibu: 45, srm: 4, description: 'Bright citrus and dank pine, brewed hazy.',
  },
  {
    name: 'Vienna Nights', brewery: 'Garage Brewing', style: 'Vienna Lager',
    abv: 5.0, ibu: 22, srm: 11, description: 'Toasty malt, clean amber lager.',
  },
  {
    name: 'Belgian Sun', brewery: 'Garage Brewing', style: 'Belgian Tripel',
    abv: 9.1, ibu: 28, srm: 5, description: 'Spicy, fruity, deceptively strong.',
  },
  {
    name: 'Midnight Oats', brewery: 'Garage Brewing', style: 'Oatmeal Stout',
    abv: 5.6, ibu: 32, srm: 38, description: 'Silky roast and dark chocolate finish.',
  },
] as const;

// Out of a 19000 mL (half-barrel-ish) start volume: tap 0 -> 83.2%, tap 1 -> 50.0%
// (chosen as a clean round number a WS-pushed volume_update can land on exactly for the
// live-update assertion), tap 2 -> 94.2%, tap 3 is kicked below so its dispensed value
// is irrelevant to what's displayed (TapCard forces a kicked keg's liquid to 0%).
const KEG_SIZE_ML = 19000;
const DISPENSED_ML = [3200, 9500, 1100, 18200] as const;

export const E2E_MONITORS: {
  pro: MonitorRef & { type: 'kegtron_pro' };
  gen1: MonitorRef & { type: 'kegtron_gen1' };
} = {
  pro: { type: 'kegtron_pro', identifier: 'e2e-device-1', portIndex: 0 },
  gen1: { type: 'kegtron_gen1', identifier: 'aa:bb:cc:dd:ee:e2', portIndex: 0 },
};

/** Theme id -> wall slug. `taproom` keeps the plain `main` slug (what a real deployment
 * would use); the other three get a `main-<theme>` slug purely so the polish audit can
 * screenshot all four without needing an authenticated PATCH to swap `main`'s theme. */
export const E2E_THEME_SLUGS: Record<string, string> = {
  taproom: 'main',
  chalkboard: 'main-chalkboard',
  bright: 'main-bright',
  mono: 'main-mono',
};

export interface E2EFixtures {
  tapIds: number[];
  kegIds: number[];
  /** The tap/keg used for the live volume_update WS-update assertion (Citra Haze). */
  liveUpdateTapId: number;
  /** The recent, unclaimed pour used by the claim-flow assertion (on Vienna Nights). */
  unclaimedPourId: number;
  /** The tap/keg left permanently kicked, with no replacement, for the KICKED-state
   * visual audit (Midnight Oats — status flipped straight to 'kicked', no replacement
   * keg tapped, so StateManager's getLatestKickedKegForTap fallback surfaces it). */
  kickedTapId: number;
}

/**
 * Seeds 4 beers/taps/kegs (2 with monitors bound), 2 drinkers, 1 recent unclaimed pour,
 * and one wall per built-in theme (all sharing the same 4 taps — an empty `pages` array
 * means "all taps, single page", per the Task 5 wall-pages resolution logic) into
 * `ctx.db`. Synchronous — `better-sqlite3` is synchronous end to end, so callers don't
 * need to await this.
 */
export function seedE2EFixtures(ctx: AppContext): E2EFixtures {
  const { db } = ctx;

  const beers = E2E_BEERS.map((b) => createBeer(db, b));
  const taps = beers.map((_beer, i) => createTap(db, { number: i + 1 }));
  const kegs = beers.map((beer, i) => createKeg(db, {
    beerId: beer.id, sizeMl: KEG_SIZE_ML, volStartMl: KEG_SIZE_ML, tapId: taps[i]!.id,
  }));

  kegs.forEach((keg, i) => {
    db.prepare('UPDATE kegs SET vol_dispensed_ml = ? WHERE id = ?').run(DISPENSED_ML[i], keg.id);
  });

  // The Pro device gets 3 ports so every tap is fed by SOME device port — wall
  // scoping is strict (a wall shows only taps bound to its assigned devices), so an
  // unbound tap would silently vanish from every seeded wall.
  const proMonitor = upsertMonitor(db, E2E_MONITORS.pro, { serial: 'E2E-PRO-0' });
  bindMonitorToTap(db, proMonitor.id, taps[0]!.id);
  const proPort1 = upsertMonitor(db, { ...E2E_MONITORS.pro, portIndex: 1 }, { serial: 'E2E-PRO-0' });
  bindMonitorToTap(db, proPort1.id, taps[2]!.id);
  const proPort2 = upsertMonitor(db, { ...E2E_MONITORS.pro, portIndex: 2 }, { serial: 'E2E-PRO-0' });
  bindMonitorToTap(db, proPort2.id, taps[3]!.id);
  const gen1Monitor = upsertMonitor(db, E2E_MONITORS.gen1, { serial: 'E2E-GEN1-0' });
  bindMonitorToTap(db, gen1Monitor.id, taps[1]!.id);

  createDrinker(db, { displayName: 'Dan', avatarColor: '#c8963e' });
  createDrinker(db, { displayName: 'Sam', avatarColor: '#4e7a4e' });

  const { pour: unclaimedPour } = recordPourTx(db, {
    kegId: kegs[1]!.id, ts: new Date().toISOString(), volumeMl: 355,
    durationMs: 5200, source: 'cloud',
  });

  // Tap 3 (Midnight Oats): kick with no replacement — status flips straight to 'kicked',
  // the tap keeps no on_tap keg, so getTapStates() falls back to this row via
  // getLatestKickedKegForTap and the wall renders it drained/desaturated/stamped.
  db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(kegs[3]!.id);

  for (const [themeId, slug] of Object.entries(E2E_THEME_SLUGS)) {
    if (getWallBySlug(db, slug)) continue;
    const wall = createWall(db, {
      slug,
      name: 'Garage Brewing Co.',
      config: {
        columns: 2,
        theme: { id: themeId },
        showQr: true,
        header: { title: 'Garage Brewing Co.', showClock: true, showTemp: false },
        ticker: 'Trivia night Thursday · Happy hour 4-6pm daily · Ask about our loyalty punch card',
      },
    });
    // Both devices on every wall — strict scoping shows nothing otherwise.
    setWallDevices(db, wall.id, [
      { type: E2E_MONITORS.pro.type, identifier: E2E_MONITORS.pro.identifier },
      { type: E2E_MONITORS.gen1.type, identifier: E2E_MONITORS.gen1.identifier },
    ]);
  }

  return {
    tapIds: taps.map((t) => t.id),
    kegIds: kegs.map((k) => k.id),
    liveUpdateTapId: taps[0]!.id,
    unclaimedPourId: unclaimedPour.id,
    kickedTapId: taps[3]!.id,
  };
}
