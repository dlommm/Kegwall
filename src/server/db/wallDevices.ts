import type Database from 'better-sqlite3';

/** One Kegtron device assigned to a wall — the derived (type, identifier) grouping of
 * `monitors` rows (see web/lib/monitorDevices.ts for the UI-side counterpart). */
export interface WallDeviceRef {
  type: 'kegtron_pro' | 'kegtron_gen1';
  identifier: string;
}

export function listWallDevices(db: Database.Database, wallId: number): WallDeviceRef[] {
  return db.prepare(
    `SELECT monitor_type type, monitor_identifier identifier
       FROM wall_devices WHERE wall_id = ? ORDER BY monitor_type, monitor_identifier`)
    .all(wallId) as WallDeviceRef[];
}

/** Replace-set semantics: the wall's assignment becomes exactly `devices`, atomically. */
export function setWallDevices(
  db: Database.Database, wallId: number, devices: WallDeviceRef[],
): WallDeviceRef[] {
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM wall_devices WHERE wall_id = ?').run(wallId);
    const insert = db.prepare(
      'INSERT INTO wall_devices (wall_id, monitor_type, monitor_identifier) VALUES (?, ?, ?)');
    for (const d of devices) insert.run(wallId, d.type, d.identifier);
  });
  replace();
  return listWallDevices(db, wallId);
}

/** The tap ids a wall may show: DISTINCT bound, NON-HIDDEN taps across every port of
 * the wall's assigned devices. STRICT by design — a wall with no assigned devices
 * gets `[]` (shows nothing), not "all taps". Hidden taps (taps.hidden) are excluded
 * here so the wall payload AND the client's ws re-filter drop them in one place. */
export function allowedTapIdsForWall(db: Database.Database, wallId: number): number[] {
  return (db.prepare(
    `SELECT DISTINCT m.tap_id id FROM wall_devices wd
       JOIN monitors m ON m.type = wd.monitor_type AND m.identifier = wd.monitor_identifier
       JOIN taps t ON t.id = m.tap_id AND t.hidden = 0
      WHERE wd.wall_id = ? AND m.tap_id IS NOT NULL ORDER BY m.tap_id`)
    .all(wallId) as { id: number }[]).map((r) => r.id);
}
