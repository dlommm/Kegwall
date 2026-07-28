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
