import type Database from 'better-sqlite3';
import type { EventBus } from './events.js';
import { getBeer } from '../db/beers.js';
import { getTap } from '../db/taps.js';

/**
 * Milestone takeovers (design 6f, the celebration slice): built-in wall
 * moments that need no automation rule —
 *  - every 100th recorded pour on the house board ("POUR #400 🍻"),
 *  - a keg kicking ("THAT'S THE END OF <BEER> — KEG KICKED").
 * Both ride the existing `wall_banner` celebrate path (BannerLane on every
 * wall). Attached AFTER StateManager so the pour row exists when we count.
 */
export const POUR_MILESTONE_EVERY = 100;

export function attachMilestones(db: Database.Database, bus: EventBus): void {
  bus.on('pour_completed', () => {
    const count = (db.prepare('SELECT COUNT(*) c FROM pours').get() as any).c as number;
    if (count > 0 && count % POUR_MILESTONE_EVERY === 0) {
      bus.emit('wall_banner', {
        text: `🍻 POUR #${count.toLocaleString('en-US')} ON THE HOUSE BOARD`,
        kind: 'celebrate',
        moment: 'milestone',
      });
      const last = db.prepare(`
        SELECT b.name beer, u.display_name pourer FROM pours p
        JOIN kegs k ON k.id = p.keg_id JOIN beers b ON b.id = k.beer_id
        LEFT JOIN users u ON u.id = p.drinker_id ORDER BY p.id DESC LIMIT 1
      `).get() as { beer: string | null; pourer: string | null } | undefined;
      bus.emit('wall_moment', {
        kind: 'milestone', scope: 'taproom', count, pourerName: last?.pourer ?? null, beerName: last?.beer ?? null,
        ts: new Date().toISOString(),
      });
    }
  });

  // Kegwall V2: a pourer's own round numbers (their 100th, 200th… pour).
  bus.on('pour_recorded', (e) => {
    if (e.pourerName && e.pourerPourCount && e.pourerPourCount % POUR_MILESTONE_EVERY === 0) {
      bus.emit('wall_moment', {
        kind: 'milestone', scope: 'pourer', count: e.pourerPourCount, pourerName: e.pourerName, beerName: null, ts: e.ts,
      });
    }
  });

  bus.on('keg_tapped', (e) => {
    const beer = getBeer(db, e.beerId);
    bus.emit('wall_moment', {
      kind: 'tapped', tapId: e.tapId, tapNumber: getTap(db, e.tapId)?.number ?? 0, beerName: beer?.name ?? null,
      brewery: beer?.brewery ?? null, style: beer?.style ?? null, abv: beer?.abv ?? null, srm: beer?.srm ?? null, ts: e.ts,
    });
  });

  bus.on('keg_kicked', (e) => {
    const beer = getBeer(db, e.beerId);
    bus.emit('wall_banner', {
      text: `THAT'S THE END OF ${(beer?.name ?? 'THE KEG').toUpperCase()} — KEG KICKED 🫡`,
      kind: 'celebrate',
      moment: 'kicked',
    });
    const next = db.prepare(`
      SELECT b.name name FROM kegs k JOIN beers b ON b.id = k.beer_id
      WHERE k.tap_id = ? AND k.status = 'on_deck' ORDER BY k.id LIMIT 1
    `).get(e.tapId) as { name: string } | undefined;
    bus.emit('wall_moment', {
      kind: 'kicked', tapId: e.tapId, tapNumber: getTap(db, e.tapId)?.number ?? 0, beerName: beer?.name ?? null,
      nextBeerName: next?.name ?? null, ts: e.ts,
    });
  });
}
