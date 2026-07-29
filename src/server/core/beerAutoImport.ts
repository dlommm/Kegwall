import type Database from 'better-sqlite3';
import type { EventBus } from './events.js';
import type { SettingsStore } from '../db/settings.js';
import type { LogService } from './logService.js';
import { createBeer } from '../db/beers.js';

/**
 * Kegtron-first beer auto-import (design 6g): the device is the source of
 * truth — when a beer name appears on a Kegtron Pro port (`beer_seen`, see
 * shadow.ts) that the local library doesn't know, cache it automatically with
 * whatever facts the device shadow carries (name/maker/style/ABV/IBU/SRM).
 * Manual entry stays as the homebrew fallback. The wall gets a "saved to
 * library" banner. Gated by the `autoImportBeers` setting (default on).
 *
 * Note: the handoff describes an Untappd metadata pull here, but Untappd was
 * removed from this codebase (v4 API closed to new credentials) — the device
 * shadow already carries the full fact set, and catalog.beer search remains
 * available for manual enrichment in the beers form.
 */
export function attachBeerAutoImport(
  db: Database.Database,
  bus: EventBus,
  settings: SettingsStore,
  log: LogService,
): void {
  bus.on('beer_seen', (e) => {
    if (!settings.get('autoImportBeers')) return;
    const name = e.name.trim();
    if (!name) return;
    const existing = db.prepare('SELECT id FROM beers WHERE name = ? COLLATE NOCASE').get(name);
    if (existing) return;
    try {
      const beer = createBeer(db, {
        name,
        brewery: e.maker,
        style: e.style,
        abv: e.abv,
        ibu: e.ibu,
        srm: e.srm,
      });
      log.info('app', `Beer auto-imported from Kegtron — "${beer.name}" (saved to library)`);
      bus.emit('wall_banner', {
        text: `NEW: ${beer.name} just appeared — saved to the library`,
        kind: 'info',
      });
    } catch {
      // A concurrent insert or constraint hiccup shouldn't take the poller down.
    }
  });
}
