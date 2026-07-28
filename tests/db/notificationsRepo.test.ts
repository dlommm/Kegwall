import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import {
  insertNotification, listNotifications, ackNotification, ackAll, unackedCount, pruneNotifications,
} from '../../src/server/db/notificationsRepo.js';
import { createAutomation } from '../../src/server/db/automations.js';
import { NotFoundError } from '../../src/server/core/errors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

describe('notificationsRepo: insert', () => {
  it('inserts with explicit fields and defaults acked to false', () => {
    const n = insertNotification(db, {
      severity: 'warning', title: 'Keg low', body: 'IPA is at 12%',
    });
    expect(n.id).toBeGreaterThan(0);
    expect(n.severity).toBe('warning');
    expect(n.title).toBe('Keg low');
    expect(n.body).toBe('IPA is at 12%');
    expect(n.acked).toBe(false);
    expect(n.automationId).toBeNull();
    expect(typeof n.ts).toBe('string');
  });

  it('defaults severity to info, body to null, and ts to now', () => {
    const before = Date.now();
    const n = insertNotification(db, { title: 'Just info' });
    expect(n.severity).toBe('info');
    expect(n.body).toBeNull();
    expect(new Date(n.ts).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('links to an automation via automationId', () => {
    const rule = createAutomation(db, {
      name: 'Keg low', trigger: { type: 'keg_kicked' },
    });
    const n = insertNotification(db, { automationId: rule.id, title: 'Fired' });
    expect(n.automationId).toBe(rule.id);
  });

  it('accepts an explicit ts (for backfill / test determinism)', () => {
    const n = insertNotification(db, { title: 'x', ts: '2020-01-01T00:00:00.000Z' });
    expect(n.ts).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('notificationsRepo: listNotifications pagination (newest first)', () => {
  function seed(n: number): number[] {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(insertNotification(db, {
        title: `n${i}`, ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      }).id);
    }
    return ids;
  }

  it('returns newest first, capped at the default limit', () => {
    const ids = seed(5);
    const list = listNotifications(db);
    expect(list.map((n) => n.id)).toEqual([...ids].reverse());
  });

  it('respects an explicit limit', () => {
    seed(5);
    const list = listNotifications(db, { limit: 2 });
    expect(list).toHaveLength(2);
    expect(list[0]!.title).toBe('n4');
    expect(list[1]!.title).toBe('n3');
  });

  it('pages with `before` (exclusive cursor on id), each page newest-first with no overlap', () => {
    const ids = seed(5); // ids[0..4], oldest to newest
    const page1 = listNotifications(db, { limit: 2 });
    expect(page1.map((n) => n.id)).toEqual([ids[4], ids[3]]);

    const page2 = listNotifications(db, { limit: 2, before: page1[page1.length - 1]!.id });
    expect(page2.map((n) => n.id)).toEqual([ids[2], ids[1]]);

    const page3 = listNotifications(db, { limit: 2, before: page2[page2.length - 1]!.id });
    expect(page3.map((n) => n.id)).toEqual([ids[0]]);
  });

  it('an empty table returns an empty list, not an error', () => {
    expect(listNotifications(db)).toEqual([]);
  });
});

describe('notificationsRepo: ack / unackedCount', () => {
  it('ackNotification marks a single notification acked and returns it', () => {
    const n = insertNotification(db, { title: 'x' });
    expect(n.acked).toBe(false);
    const acked = ackNotification(db, n.id);
    expect(acked.acked).toBe(true);
    expect(listNotifications(db)[0]!.acked).toBe(true);
  });

  it('ackNotification throws NotFoundError for a missing id', () => {
    expect(() => ackNotification(db, 999)).toThrow(NotFoundError);
  });

  it('unackedCount reflects only unacked notifications', () => {
    insertNotification(db, { title: 'a' });
    const b = insertNotification(db, { title: 'b' });
    insertNotification(db, { title: 'c' });
    expect(unackedCount(db)).toBe(3);
    ackNotification(db, b.id);
    expect(unackedCount(db)).toBe(2);
  });

  it('ackAll marks every unacked notification acked and returns the count affected', () => {
    insertNotification(db, { title: 'a' });
    const b = insertNotification(db, { title: 'b' });
    ackNotification(db, b.id);
    insertNotification(db, { title: 'c' });
    expect(unackedCount(db)).toBe(2);
    const affected = ackAll(db);
    expect(affected).toBe(2);
    expect(unackedCount(db)).toBe(0);
  });

  it('ackAll on an already-clean table returns 0', () => {
    expect(ackAll(db)).toBe(0);
  });
});

describe('notificationsRepo: pruneNotifications', () => {
  it('deletes notifications older than olderThanDays and returns the count removed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    const oldOne = insertNotification(db, { title: 'old', ts: '2026-04-01T00:00:00.000Z' }); // ~118d ago
    const recentOne = insertNotification(db, { title: 'recent', ts: '2026-07-01T00:00:00.000Z' }); // ~27d ago

    const removed = pruneNotifications(db, 90);
    expect(removed).toBe(1);
    const remainingIds = listNotifications(db).map((n) => n.id);
    expect(remainingIds).toEqual([recentOne.id]);
    expect(remainingIds).not.toContain(oldOne.id);
    vi.useRealTimers();
  });

  it('defaults olderThanDays to 90', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    insertNotification(db, { title: 'ancient', ts: '2025-01-01T00:00:00.000Z' });
    insertNotification(db, { title: 'fresh', ts: '2026-07-27T00:00:00.000Z' });

    const removed = pruneNotifications(db);
    expect(removed).toBe(1);
    expect(listNotifications(db).map((n) => n.title)).toEqual(['fresh']);
    vi.useRealTimers();
  });

  it('a prune with nothing old enough removes nothing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    insertNotification(db, { title: 'fresh', ts: '2026-07-27T00:00:00.000Z' });
    expect(pruneNotifications(db, 90)).toBe(0);
    vi.useRealTimers();
  });
});
