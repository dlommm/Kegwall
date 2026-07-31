import type Database from 'better-sqlite3';
import type { EventBus, MonitorRef } from './events.js';
import type { LogService } from './logService.js';
import {
  addWallDevice, deviceAssignedAnywhere, wallsWithNoDevices, type WallDeviceRef,
} from '../db/wallDevices.js';

/**
 * One-shot Kegtron→wall auto-assignment (first-run wizard epic, plan step 6).
 *
 * Fresh installs hit a dead-wall gap: `wall_devices` scoping is STRICT (a wall with
 * no devices shows NOTHING), monitors are created only by ingest, and the wizard may
 * run before any Kegtron has ever reported. This closes the gap in every ordering:
 * when a Kegtron device comes online (or already was at attach time) and is not
 * explicitly assigned anywhere, attach it to every wall that currently has zero
 * devices.
 *
 * Deliberately idempotent and self-disabling — no settings flag, no "wizard
 * completed" state:
 *   - a device assigned to ANY wall is never touched again (an admin's explicit
 *     choice wins permanently);
 *   - a wall with ANY device is never touched (only empty walls are "unclaimed").
 * The only surprise case is a multi-wall admin deliberately keeping an empty wall —
 * the next brand-new device attaches to it. That's logged, and Walls → edit is the
 * obvious undo.
 */
export function attachWallAutoAssign(db: Database.Database, bus: EventBus, log: LogService): void {
  const consider = (monitor: MonitorRef): void => {
    if (monitor.type !== 'kegtron_pro' && monitor.type !== 'kegtron_gen1') return;
    const ref: WallDeviceRef = { type: monitor.type, identifier: monitor.identifier };
    if (deviceAssignedAnywhere(db, ref)) return;
    const empty = wallsWithNoDevices(db);
    if (empty.length === 0) return;
    for (const wallId of empty) addWallDevice(db, wallId, ref);
    log.info('app', `Auto-assigned new Kegtron device ${ref.type}:${ref.identifier} to wall(s) ${empty.join(', ')} — adjust in Walls → edit`);
    bus.emit('state_changed', { scope: 'taps', ts: new Date().toISOString() });
  };

  bus.on('device_online', (e) => consider(e.monitor));

  // Attach-time sweep: covers "wall created AFTER the device was already online" —
  // device_online won't re-fire for a device that's been up all along.
  const known = db.prepare(
    "SELECT DISTINCT type, identifier FROM monitors WHERE type IN ('kegtron_pro', 'kegtron_gen1')",
  ).all() as { type: WallDeviceRef['type']; identifier: string }[];
  for (const row of known) consider({ type: row.type, identifier: row.identifier, portIndex: 0 });
}
