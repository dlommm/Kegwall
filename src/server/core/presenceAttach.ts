import type Database from 'better-sqlite3';
import type { EventBus } from './events.js';
import { PresenceRegistry, type PresenceZoneConfig } from './presence.js';
import { parseWallConfig } from './wallConfig.js';

/** Wires PresenceRegistry to the app: builds zones from the walls table (via
 * parseWallConfig so legacy screensaver configs count), rebuilds them on any
 * walls_changed push (same signal ws.ts relays to kiosks), and wakes every zone on a
 * pour — the /ws feed has no per-wall routing (see ws.ts's broadcast comment), and
 * resolving tap→wall here would duplicate wall_devices scoping for marginal benefit,
 * so a 1 a.m. pour lights every wall. Malformed stored config falls back to zone
 * defaults (timers off) rather than crashing boot. */
export function attachPresence(db: Database.Database, bus: EventBus): PresenceRegistry {
  const registry = new PresenceRegistry(bus);
  const loadZones = (): PresenceZoneConfig[] => {
    const rows = db.prepare('SELECT id, slug, config FROM walls').all() as
      Array<{ id: number; slug: string; config: string }>;
    return rows.map((r) => {
      let saver: number | null = null;
      let off: number | null = null;
      try {
        const cfg = parseWallConfig(JSON.parse(r.config));
        saver = cfg.displayPower.screensaverAfterMinutes;
        off = cfg.displayPower.offAfterMinutes;
      } catch { /* unparseable config ⇒ inert zone */ }
      return { wallId: r.id, slug: r.slug, screensaverAfterMinutes: saver, offAfterMinutes: off };
    });
  };
  registry.configure(loadZones());
  bus.on('state_changed', (e) => { if (e.scope === 'walls') registry.configure(loadZones()); });
  bus.on('pour_started', () => registry.motion(null, 'pour'));
  bus.on('pour_completed', () => registry.motion(null, 'pour'));
  return registry;
}
