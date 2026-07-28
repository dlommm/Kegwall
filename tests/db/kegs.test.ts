import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import {
  createKeg, getActiveKegForTap, applyDispense, recordPourTx, swapKeg, listKegs,
  getLatestKickedKegForTap,
} from '../../src/server/db/kegs.js';
import { ConflictError } from '../../src/server/core/errors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
let beerId: number;
let tapId: number;
beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  beerId = createBeer(db, { name: 'Test Ale' }).id;
  tapId = createTap(db, { number: 1 }).id;
});

describe('kegs repo', () => {
  it('creates a keg on a tap and finds it as active', () => {
    const keg = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    expect(getActiveKegForTap(db, tapId)?.id).toBe(keg.id);
  });

  it('applyDispense sets absolute dispensed volume, clamped at 0', () => {
    const keg = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    expect(applyDispense(db, keg.id, 2500).volDispensedMl).toBe(2500);
    expect(applyDispense(db, keg.id, -5).volDispensedMl).toBe(0);
  });

  it('recordPourTx inserts pour and increments keg atomically', () => {
    const keg = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    const { pour, keg: after } = recordPourTx(db, {
      kegId: keg.id, ts: '2026-07-27T01:00:00.000Z', volumeMl: 400,
      durationMs: 6000, source: 'cloud',
    });
    expect(pour.volumeMl).toBe(400);
    expect(after.volDispensedMl).toBe(400);
    const count = db.prepare('SELECT COUNT(*) c FROM pours').get() as any;
    expect(count.c).toBe(1);
  });

  it('swapKeg kicks old keg and taps new one in a transaction', () => {
    createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    const newBeer = createBeer(db, { name: 'Fresh Pils' }).id;
    const fresh = swapKeg(db, { tapId, newBeerId: newBeer, sizeMl: 19000, volStartMl: 19000 });
    expect(fresh.status).toBe('on_tap');
    expect(getActiveKegForTap(db, tapId)?.beerId).toBe(newBeer);
    expect(listKegs(db, { status: 'kicked' })).toHaveLength(1);
  });

  it('createKeg refuses a second on_tap keg on an already-occupied tap', () => {
    createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    expect(() =>
      createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId }),
    ).toThrow(ConflictError);
    // the original keg is still the sole active keg on the tap
    expect(getActiveKegForTap(db, tapId)).not.toBeNull();
    expect(listKegs(db, { status: 'on_tap' })).toHaveLength(1);
  });

  it('createKeg allows a new keg on a tap once the prior keg is no longer on_tap', () => {
    const first = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(first.id);
    const second = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    expect(getActiveKegForTap(db, tapId)?.id).toBe(second.id);
  });

  it('createKeg without a tapId never conflicts (unassigned kegs)', () => {
    const a = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000 });
    const b = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000 });
    expect(a.tapId).toBeNull();
    expect(b.tapId).toBeNull();
  });

  it('getLatestKickedKegForTap returns null with no kicked history, then the most recent kick', () => {
    expect(getLatestKickedKegForTap(db, tapId)).toBeNull();

    const first = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(first.id);
    expect(getLatestKickedKegForTap(db, tapId)?.id).toBe(first.id);

    const second = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
    db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(second.id);
    expect(getLatestKickedKegForTap(db, tapId)?.id).toBe(second.id);
  });

  it('getLatestKickedKegForTap ignores kicked kegs belonging to other taps', () => {
    const otherTapId = createTap(db, { number: 2 }).id;
    const keg = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId: otherTapId });
    db.prepare(`UPDATE kegs SET status = 'kicked' WHERE id = ?`).run(keg.id);
    expect(getLatestKickedKegForTap(db, tapId)).toBeNull();
  });
});
