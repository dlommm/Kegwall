import type Database from 'better-sqlite3';
import type { MonitorRef } from '../core/events.js';
import { NotFoundError } from '../core/errors.js';

export interface Monitor {
  id: number; type: 'kegtron_pro' | 'kegtron_gen1'; identifier: string;
  serial: string | null; portIndex: number; tapId: number | null;
  lastSeen: string | null; meta: Record<string, unknown>;
}

function rowToMonitor(r: any): Monitor {
  return {
    id: r.id, type: r.type, identifier: r.identifier, serial: r.serial,
    portIndex: r.port_index, tapId: r.tap_id, lastSeen: r.last_seen,
    meta: JSON.parse(r.meta),
  };
}

export function upsertMonitor(db: Database.Database, ref: MonitorRef,
  extra: { serial?: string; meta?: Record<string, unknown> } = {}): Monitor {
  db.prepare(`INSERT INTO monitors (type, identifier, port_index, serial, last_seen, meta)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(type, identifier, port_index) DO UPDATE SET
        last_seen = excluded.last_seen,
        serial = COALESCE(excluded.serial, monitors.serial),
        meta = CASE WHEN excluded.meta != '{}' THEN excluded.meta ELSE monitors.meta END`)
    .run(ref.type, ref.identifier, ref.portIndex, extra.serial ?? null,
      new Date().toISOString(), JSON.stringify(extra.meta ?? {}));
  return getMonitorByRef(db, ref)!;
}

export function getMonitorByRef(db: Database.Database, ref: MonitorRef): Monitor | null {
  const r = db.prepare(
    'SELECT * FROM monitors WHERE type = ? AND identifier = ? AND port_index = ?')
    .get(ref.type, ref.identifier, ref.portIndex);
  return r ? rowToMonitor(r) : null;
}

/** Lookup by the monitors table's own primary key — used by Task 9's kegtron routes
 * (`/api/kegtron/import/:monitorId`, `/api/kegtron/reset-volume/:monitorId`), which
 * address a monitor the same way `POST /api/monitors/:id/bind` does. */
export function getMonitorById(db: Database.Database, id: number): Monitor | null {
  const r = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id);
  return r ? rowToMonitor(r) : null;
}

export function listMonitors(db: Database.Database): Monitor[] {
  return db.prepare('SELECT * FROM monitors ORDER BY type, identifier, port_index')
    .all().map(rowToMonitor);
}

export function bindMonitorToTap(db: Database.Database, monitorId: number, tapId: number | null): Monitor {
  const res = db.prepare('UPDATE monitors SET tap_id = ? WHERE id = ?').run(tapId, monitorId);
  if (res.changes === 0) throw new NotFoundError(`monitor ${monitorId}`);
  return rowToMonitor(db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitorId));
}

export function resolveTapForRef(db: Database.Database, ref: MonitorRef): number | null {
  return getMonitorByRef(db, ref)?.tapId ?? null;
}

/**
 * Monitor identity reconciliation (Task 8, flagged as a HARD REQUIREMENT by the Task 6
 * review): Kegtron Pro cloud discovery upserts monitors keyed by the mdash device id
 * (see shadow.ts's `diffToEvents` -> `device_discovered.monitor.identifier`), while the
 * UDP streaming source only ever knows the device's `serialNum` (there is no device id
 * in the UDP packet, see udpSource.ts's header comment) — so without this lookup the two
 * sources resolve to DIFFERENT `monitors` rows for the exact same physical device/port,
 * which both breaks tap binding (two rows to bind instead of one) and defeats
 * `PourDeduper` (Task 5) entirely, since it keys on `(type, identifier, portIndex)` and
 * a mismatched identifier means cloud/UDP reports of the same physical pour never
 * collide.
 *
 * Looks up the CLOUD-discovered monitor row for a given `(serial, portIndex)` pair —
 * cloud discovery is what populates the `serial` column (see `upsertMonitor`'s
 * `extra.serial`, fed from `device_discovered.serial`). Returns that row's `MonitorRef`
 * (type + the cloud's mdash-device-id `identifier` + portIndex) so a caller (Task 8's
 * `KegtronUdpSource` wiring, via its constructor-injected `reconcile` option) can emit
 * events under the SAME ref cloud uses, letting `PourDeduper` actually collapse the
 * duplicate. Returns `null` when no cloud row has reported that serial+port yet (cloud
 * not configured, or hasn't discovered this device/port yet) — callers fall back to a
 * synthetic `udp:{serialNum}` identifier in that case so a cloudless UDP-only setup
 * still surfaces a bindable monitor rather than silently dropping events.
 *
 * Scoped to `type = 'kegtron_pro'` — Gen 1 monitors are identified by BLE MAC (see
 * `MonitorRef`'s doc comment in events.ts) and never populate `serial`, so this is
 * purely defensive, not expected to matter in practice.
 */
export function reconcileProMonitor(
  db: Database.Database, serialNum: string, portIndex: number,
): MonitorRef | null {
  const row = db.prepare(
    `SELECT identifier FROM monitors WHERE type = 'kegtron_pro' AND serial = ? AND port_index = ?`,
  ).get(serialNum, portIndex) as { identifier: string } | undefined;
  return row ? { type: 'kegtron_pro', identifier: row.identifier, portIndex } : null;
}
