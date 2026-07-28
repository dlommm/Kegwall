import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import {
  createKeg, getActiveKegForTap, applyDispense, recordPourTx, swapKeg, listKegs,
  getLatestKickedKegForTap, listOnDeckForTap,
} from '../../src/server/db/kegs.js';
import { ConflictError, NotFoundError } from '../../src/server/core/errors.js';
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

  describe('on-deck kegs', () => {
    it('createKeg accepts status on_deck alongside an existing on_tap keg without conflicting', () => {
      const active = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
      const onDeck = createKeg(db, { beerId, sizeMl: 20000, volStartMl: 20000, tapId, status: 'on_deck' });
      expect(onDeck.status).toBe('on_deck');
      expect(getActiveKegForTap(db, tapId)?.id).toBe(active.id);
    });

    it('listOnDeckForTap returns on-deck kegs for a tap in queue order, excluding other statuses/taps', () => {
      const otherTapId = createTap(db, { number: 2 }).id;
      const first = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId, status: 'on_deck' });
      const second = createKeg(db, { beerId, sizeMl: 20000, volStartMl: 20000, tapId, status: 'on_deck' });
      createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId: otherTapId, status: 'on_deck' });
      createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId }); // on_tap, excluded

      expect(listOnDeckForTap(db, tapId).map((k) => k.id)).toEqual([first.id, second.id]);
    });

    it('listOnDeckForTap returns an empty array for a tap with no queued kegs', () => {
      expect(listOnDeckForTap(db, tapId)).toEqual([]);
    });

    it('swapKeg promotes an on-deck keg via fromKegId instead of creating a fresh row', () => {
      const current = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
      const queued = createKeg(db, { beerId, sizeMl: 20000, volStartMl: 20000, tapId, status: 'on_deck' });

      const promoted = swapKeg(db, { tapId, fromKegId: queued.id });
      expect(promoted.id).toBe(queued.id);
      expect(promoted.status).toBe('on_tap');
      expect(getActiveKegForTap(db, tapId)?.id).toBe(queued.id);
      expect(getLatestKickedKegForTap(db, tapId)?.id).toBe(current.id);
      expect(listOnDeckForTap(db, tapId)).toEqual([]);
      // no new row was created for the promotion — still just the original two
      expect(listKegs(db)).toHaveLength(2);
    });

    it('swapKeg with fromKegId 404s for an on-deck keg that does not belong to the target tap', () => {
      const otherTapId = createTap(db, { number: 2 }).id;
      const queued = createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId: otherTapId, status: 'on_deck' });
      expect(() => swapKeg(db, { tapId, fromKegId: queued.id })).toThrow(NotFoundError);
    });

    it('swapKeg still requires beer/size/volume when not promoting an on-deck keg', () => {
      expect(() => swapKeg(db, { tapId } as any)).toThrow();
    });

    it('the unique active-keg index still rejects a second on_tap keg after a promotion', () => {
      createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId });
      const queued = createKeg(db, { beerId, sizeMl: 20000, volStartMl: 20000, tapId, status: 'on_deck' });
      swapKeg(db, { tapId, fromKegId: queued.id });
      expect(() => createKeg(db, { beerId, sizeMl: 19000, volStartMl: 19000, tapId })).toThrow(ConflictError);
    });
  });
});
