import type Database from 'better-sqlite3';
import type { EventBus } from './events.js';
import { getBeer } from '../db/beers.js';

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
      });
    }
  });

  bus.on('keg_kicked', (e) => {
    const beer = getBeer(db, e.beerId);
    bus.emit('wall_banner', {
      text: `THAT'S THE END OF ${(beer?.name ?? 'THE KEG').toUpperCase()} — KEG KICKED 🫡`,
      kind: 'celebrate',
    });
  });
}
