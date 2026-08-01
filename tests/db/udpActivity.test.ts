import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import {
  bumpUdpActivity, listUdpActivity, pruneUdpActivity, summarizeUdpActivity,
} from '../../src/server/db/udpActivity.js';

let db: Database.Database;
beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

describe('udpActivity buckets', () => {
  it('accumulates counts per (minute, serial) and lists since a cutoff', () => {
    bumpUdpActivity(db, '2026-07-31T14:30', 'dev427', 60);
    bumpUdpActivity(db, '2026-07-31T14:30', 'dev427', 5); // same bucket → adds
    bumpUdpActivity(db, '2026-07-31T14:31', 'malformed', 2);
    const rows = listUdpActivity(db, '2026-07-31T14:00');
    expect(rows).toEqual([
      { minute: '2026-07-31T14:30', serial: 'dev427', packets: 65 },
      { minute: '2026-07-31T14:31', serial: 'malformed', packets: 2 },
    ]);
    expect(listUdpActivity(db, '2026-07-31T14:31')).toHaveLength(1);
  });

  it('prunes old buckets', () => {
    bumpUdpActivity(db, '2020-01-01T00:00', 'dev427', 1);
    bumpUdpActivity(db, new Date().toISOString().slice(0, 16), 'dev427', 1);
    expect(pruneUdpActivity(db, 14)).toBe(1);
  });
});

describe('summarizeUdpActivity', () => {
  it('reports coverage and the largest gaps, including the tail gap to now', () => {
    const rows = [
      { minute: '2026-07-31T14:00', serial: 'dev427', packets: 240 },
      { minute: '2026-07-31T14:01', serial: 'dev427', packets: 240 },
      // 28-minute silence (IGMP ageing signature)
      { minute: '2026-07-31T14:30', serial: 'dev427', packets: 240 },
    ];
    const [d] = summarizeUdpActivity(rows, '2026-07-31T15:00');
    expect(d).toMatchObject({
      serial: 'dev427', totalPackets: 720,
      firstSeen: '2026-07-31T14:00', lastSeen: '2026-07-31T14:30',
    });
    // 3 active minutes over a 60-minute span.
    expect(d!.coveragePct).toBe(5);
    // Largest first: the 29min tail (14:30→15:00) then the 28min mid-gap.
    expect(d!.gaps[0]).toMatchObject({ from: '2026-07-31T14:30', to: '2026-07-31T15:00', minutes: 29 });
    expect(d!.gaps[1]).toMatchObject({ from: '2026-07-31T14:01', to: '2026-07-31T14:30', minutes: 28 });
  });

  it('an unbroken stream reports 100% coverage and no gaps', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      minute: `2026-07-31T14:0${i}`, serial: 'dev427', packets: 240,
    }));
    const [d] = summarizeUdpActivity(rows, '2026-07-31T14:10');
    expect(d!.coveragePct).toBe(100);
    expect(d!.gaps).toHaveLength(0);
  });

  it('splits devices and sorts by serial', () => {
    const rows = [
      { minute: '2026-07-31T14:00', serial: 'zzz', packets: 1 },
      { minute: '2026-07-31T14:00', serial: 'aaa', packets: 1 },
    ];
    const out = summarizeUdpActivity(rows, '2026-07-31T14:01');
    expect(out.map((d) => d.serial)).toEqual(['aaa', 'zzz']);
  });
});
