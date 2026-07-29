import type Database from 'better-sqlite3';
import { NotFoundError, ConflictError, ValidationError } from '../core/errors.js';

export type KegStatus = 'on_tap' | 'kicked' | 'archived' | 'on_deck';

/** The 7 keg-asset ids KegFill (web) can render -- kept in sync BY HAND with
 * `src/web/lib/kegAssets.ts`'s `KEG_ASSET_IDS` and migration 005's CHECK constraint (same
 * convention already used for `KegStatus` vs. `kegs.status`'s CHECK). `Keg.kegType` mirrors
 * the nullable `kegs.keg_type` column: `null` means "auto-match by sizeMl". */
export type KegType =
  | 'half-barrel' | 'quarter-barrel' | 'sixth-barrel' | 'fifty-liter'
  | 'cornelius' | 'slim-quarter' | 'mini-keg';

export interface Keg {
  id: number; beerId: number; tapId: number | null; sizeMl: number;
  volStartMl: number; volDispensedMl: number; dateTapped: string | null;
  status: KegStatus; createdAt: string; kegType: KegType | null;
}

export interface Pour {
  id: number; kegId: number; ts: string; volumeMl: number;
  durationMs: number | null; source: 'cloud' | 'udp' | 'ble'; drinkerId: number | null;
}

/** `keg.levelPct`'s formula, extracted (Phase 5 Task 3) so the automation engine's
 * `keg_level_crosses` trigger (`automation/engine.ts`) computes the EXACT same number
 * `StateManager.getTapStates()` does, rather than risking the two formulas drifting
 * apart — the engine detects a threshold crossing by comparing this value across
 * consecutive `volume_update` events, so it must match the presentation layer's own
 * number precisely. Clamped to [0,100]; `volStartMl <= 0` (shouldn't happen — kegs are
 * always created with a positive size — but defensive) reads as fully empty rather than
 * dividing by zero. */
export function computeLevelPct(volStartMl: number, volDispensedMl: number): number {
  return volStartMl > 0
    ? Math.max(0, Math.min(100, Math.round(((volStartMl - volDispensedMl) / volStartMl) * 1000) / 10))
    : 0;
}

/** `keg.remainingMl`'s formula — same extraction rationale as `computeLevelPct` above. */
export function computeRemainingMl(volStartMl: number, volDispensedMl: number): number {
  return Math.max(0, volStartMl - volDispensedMl);
}

function rowToKeg(r: any): Keg {
  return {
    id: r.id, beerId: r.beer_id, tapId: r.tap_id, sizeMl: r.size_ml,
    volStartMl: r.vol_start_ml, volDispensedMl: r.vol_dispensed_ml,
    dateTapped: r.date_tapped, status: r.status, createdAt: r.created_at,
    kegType: r.keg_type ?? null,
  };
}

export function createKeg(db: Database.Database, input: {
  beerId: number; sizeMl: number; volStartMl: number;
  tapId?: number | null; dateTapped?: string;
  /** Defaults to 'on_tap'. 'on_deck' queues the keg behind whatever's currently on_tap
   * for `tapId` (a swap-wizard "queue this for next" keg, see the Task 1 brief) — it does
   * NOT go through the active-tap conflict check below, and `idx_kegs_tap_active` (scoped
   * to `WHERE status = 'on_tap'`) doesn't apply to it either, so any number of on_deck
   * kegs can share a tap_id. Promote one to on_tap via `swapKeg`'s `fromKegId`. */
  status?: 'on_tap' | 'on_deck';
  /** Manual KegFill asset override (migration 005's `kegs.keg_type`). Omitted/`null`
   * means "auto-match by sizeMl" — see `web/lib/kegAssets.ts`'s `resolveKegAsset`. */
  kegType?: KegType | null;
}): Keg {
  const status = input.status ?? 'on_tap';
  // Only swapKeg (which kicks the incumbent first, inside its own transaction)
  // is allowed to put an on_tap keg on an occupied tap; a bare create must not — the
  // rest of the pipeline (getActiveKegForTap, ingest, wall display) assumes
  // exactly one on_tap keg per tap. idx_kegs_tap_active also enforces this at
  // the DB layer, but we check here first so the API returns a clean 409
  // instead of a raw SqliteError.
  if (status === 'on_tap' && input.tapId != null && getActiveKegForTap(db, input.tapId)) {
    throw new ConflictError(`tap ${input.tapId} already has an active keg`);
  }
  const res = db.prepare(`INSERT INTO kegs
      (beer_id, tap_id, size_ml, vol_start_ml, date_tapped, status, created_at, keg_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.beerId, input.tapId ?? null, input.sizeMl, input.volStartMl,
      input.dateTapped ?? new Date().toISOString(), status, new Date().toISOString(),
      input.kegType ?? null);
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

/**
 * Most recently kicked keg for a tap. `kegs` has no `kicked_at` column and a kick (see
 * `routes/crud.ts`'s `PATCH /api/kegs/:id` and `swapKeg` above) only ever flips
 * `status`, never re-inserts the row — so the highest `id` among a tap's `status =
 * 'kicked'` rows is the best available proxy for "most recently kicked" (a tap's keg
 * lifecycle is create -> optionally kick -> replace, so the newest kicked row is always
 * the one that was on_tap immediately before whatever replaced it, or before the tap
 * went empty). `StateManager.getTapStates()` falls back to this only when
 * `getActiveKegForTap` finds nothing, so a kicked keg with no replacement tapped still
 * surfaces as `status: 'kicked'` on the wall instead of reading as a generic empty tap.
 */
export function getLatestKickedKegForTap(db: Database.Database, tapId: number): Keg | null {
  const r = db.prepare(
    `SELECT * FROM kegs WHERE tap_id = ? AND status = 'kicked' ORDER BY id DESC LIMIT 1`,
  ).get(tapId);
  return r ? rowToKeg(r) : null;
}

/** Kegs queued behind a tap's current on_tap keg, in queue (creation) order — the swap
 * wizard's on-deck list (Task 1 brief / Task 5 UI). */
export function listOnDeckForTap(db: Database.Database, tapId: number): Keg[] {
  return db.prepare(
    `SELECT * FROM kegs WHERE tap_id = ? AND status = 'on_deck' ORDER BY id`,
  ).all(tapId).map(rowToKeg);
}

/** Removes a queued on-deck keg from a tap's queue (the admin swap wizard's on-deck
 * "remove" action, Task 5 brief). Deliberately scoped to `status = 'on_deck'` only — an
 * on_tap/kicked/archived keg is real history (pours may reference it via `pours.keg_id`,
 * which has no ON DELETE clause and would FK-violate anyway), so this throws
 * `ValidationError` rather than deleting it. 404s for an unknown id, matching every other
 * single-resource repo function's not-found convention. */
export function removeOnDeckKeg(db: Database.Database, id: number): void {
  const keg = getKeg(db, id);
  if (!keg) throw new NotFoundError(`keg ${id}`);
  if (keg.status !== 'on_deck') {
    throw new ValidationError(`keg ${id} is not on-deck (status: ${keg.status}) and cannot be removed this way`);
  }
  db.prepare('DELETE FROM kegs WHERE id = ?').run(id);
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
  tapId: number;
  /** Promotes an already-queued on-deck keg to on_tap instead of creating a fresh row —
   * must belong to `tapId` and currently be status 'on_deck', or this 404s. When set,
   * `newBeerId`/`sizeMl`/`volStartMl`/`kegType` are ignored (the promoted keg keeps the
   * values it was created with). */
  fromKegId?: number;
  newBeerId?: number; sizeMl?: number; volStartMl?: number;
  /** Manual KegFill asset override for a freshly-tapped keg (ignored when promoting via
   * `fromKegId` — see above). Omitted/`null` means "auto-match by sizeMl". */
  kegType?: KegType | null;
}): Keg {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE kegs SET status = 'kicked' WHERE tap_id = ? AND status = 'on_tap'`)
      .run(input.tapId);

    if (input.fromKegId != null) {
      const queued = db.prepare(
        `SELECT id FROM kegs WHERE id = ? AND tap_id = ? AND status = 'on_deck'`,
      ).get(input.fromKegId, input.tapId);
      if (!queued) throw new NotFoundError(`on-deck keg ${input.fromKegId} for tap ${input.tapId}`);
      db.prepare(`UPDATE kegs SET status = 'on_tap', date_tapped = ? WHERE id = ?`)
        .run(new Date().toISOString(), input.fromKegId);
      return input.fromKegId;
    }

    if (input.newBeerId == null || input.sizeMl == null || input.volStartMl == null) {
      throw new ValidationError('newBeerId, sizeMl, and volStartMl are required unless promoting an on-deck keg via fromKegId');
    }
    const res = db.prepare(`INSERT INTO kegs
        (beer_id, tap_id, size_ml, vol_start_ml, date_tapped, created_at, keg_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(input.newBeerId, input.tapId, input.sizeMl, input.volStartMl,
        new Date().toISOString(), new Date().toISOString(), input.kegType ?? null);
    return Number(res.lastInsertRowid);
  });
  return getKeg(db, tx())!;
}
