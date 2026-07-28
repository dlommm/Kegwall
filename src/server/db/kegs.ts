import type Database from 'better-sqlite3';
import { NotFoundError, ConflictError } from '../core/errors.js';

export type KegStatus = 'on_tap' | 'kicked' | 'archived';

export interface Keg {
  id: number; beerId: number; tapId: number | null; sizeMl: number;
  volStartMl: number; volDispensedMl: number; dateTapped: string | null;
  status: KegStatus; createdAt: string;
}

export interface Pour {
  id: number; kegId: number; ts: string; volumeMl: number;
  durationMs: number | null; source: 'cloud' | 'udp' | 'ble'; drinkerId: number | null;
}

function rowToKeg(r: any): Keg {
  return {
    id: r.id, beerId: r.beer_id, tapId: r.tap_id, sizeMl: r.size_ml,
    volStartMl: r.vol_start_ml, volDispensedMl: r.vol_dispensed_ml,
    dateTapped: r.date_tapped, status: r.status, createdAt: r.created_at,
  };
}

export function createKeg(db: Database.Database, input: {
  beerId: number; sizeMl: number; volStartMl: number;
  tapId?: number | null; dateTapped?: string;
}): Keg {
  // Only swapKeg (which kicks the incumbent first, inside its own transaction)
  // is allowed to put a keg on an occupied tap; a bare create must not — the
  // rest of the pipeline (getActiveKegForTap, ingest, wall display) assumes
  // exactly one on_tap keg per tap. idx_kegs_tap_active also enforces this at
  // the DB layer, but we check here first so the API returns a clean 409
  // instead of a raw SqliteError.
  if (input.tapId != null && getActiveKegForTap(db, input.tapId)) {
    throw new ConflictError(`tap ${input.tapId} already has an active keg`);
  }
  const res = db.prepare(`INSERT INTO kegs
      (beer_id, tap_id, size_ml, vol_start_ml, date_tapped, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.beerId, input.tapId ?? null, input.sizeMl, input.volStartMl,
      input.dateTapped ?? new Date().toISOString(), new Date().toISOString());
  return getKeg(db, Number(res.lastInsertRowid))!;
}

export function getKeg(db: Database.Database, id: number): Keg | null {
  const r = db.prepare('SELECT * FROM kegs WHERE id = ?').get(id);
  return r ? rowToKeg(r) : null;
}

export function listKegs(db: Database.Database, filter: { status?: KegStatus } = {}): Keg[] {
  const rows = filter.status
    ? db.prepare('SELECT * FROM kegs WHERE status = ? ORDER BY created_at DESC').all(filter.status)
    : db.prepare('SELECT * FROM kegs ORDER BY created_at DESC').all();
  return rows.map(rowToKeg);
}

export function getActiveKegForTap(db: Database.Database, tapId: number): Keg | null {
  const r = db.prepare(`SELECT * FROM kegs WHERE tap_id = ? AND status = 'on_tap'`).get(tapId);
  return r ? rowToKeg(r) : null;
}

export function applyDispense(db: Database.Database, kegId: number, volDispensedMl: number): Keg {
  const keg = getKeg(db, kegId);
  if (!keg) throw new NotFoundError(`keg ${kegId}`);
  db.prepare('UPDATE kegs SET vol_dispensed_ml = ? WHERE id = ?')
    .run(Math.max(0, Math.round(volDispensedMl)), kegId);
  return getKeg(db, kegId)!;
}

export function recordPourTx(db: Database.Database, input: {
  kegId: number; ts: string; volumeMl: number; durationMs?: number | null;
  source: 'cloud' | 'udp' | 'ble'; drinkerId?: number | null;
}): { pour: Pour; keg: Keg } {
  const tx = db.transaction(() => {
    const res = db.prepare(`INSERT INTO pours (keg_id, ts, volume_ml, duration_ms, source, drinker_id)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.kegId, input.ts, input.volumeMl, input.durationMs ?? null,
        input.source, input.drinkerId ?? null);
    db.prepare('UPDATE kegs SET vol_dispensed_ml = vol_dispensed_ml + ? WHERE id = ?')
      .run(Math.round(input.volumeMl), input.kegId);
    return Number(res.lastInsertRowid);
  });
  const pourId = tx();
  const r = db.prepare('SELECT * FROM pours WHERE id = ?').get(pourId) as any;
  return {
    pour: {
      id: r.id, kegId: r.keg_id, ts: r.ts, volumeMl: r.volume_ml,
      durationMs: r.duration_ms, source: r.source, drinkerId: r.drinker_id,
    },
    keg: getKeg(db, input.kegId)!,
  };
}

export function swapKeg(db: Database.Database, input: {
  tapId: number; newBeerId: number; sizeMl: number; volStartMl: number;
}): Keg {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE kegs SET status = 'kicked' WHERE tap_id = ? AND status = 'on_tap'`)
      .run(input.tapId);
    const res = db.prepare(`INSERT INTO kegs
        (beer_id, tap_id, size_ml, vol_start_ml, date_tapped, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.newBeerId, input.tapId, input.sizeMl, input.volStartMl,
        new Date().toISOString(), new Date().toISOString());
    return Number(res.lastInsertRowid);
  });
  return getKeg(db, tx())!;
}
