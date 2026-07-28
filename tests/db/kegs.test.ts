import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer } from '../../src/server/db/beers.js';
import { createTap } from '../../src/server/db/taps.js';
import {
  createKeg, getActiveKegForTap, applyDispense, recordPourTx, swapKeg, listKegs,
} from '../../src/server/db/kegs.js';
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
});
