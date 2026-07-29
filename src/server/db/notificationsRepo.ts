import type Database from 'better-sqlite3';
import { NotFoundError } from '../core/errors.js';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface Notification {
  id: number;
  /** The automation that produced this notification, or `null` for one whose rule was
   * later deleted (`db/automations.ts#deleteAutomation` nulls this out rather than
   * cascading the delete — history is kept) or one inserted with no automation at all
   * (e.g. a channel's send-test path, Task 2). */
  automationId: number | null;
  ts: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  acked: boolean;
}

export interface NotificationInput {
  automationId?: number | null;
  /** Defaults to `'info'`, matching the column's own `DEFAULT 'info'`. */
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  /** ISO 8601 UTC. Defaults to "now" — overridable for backfill/import and for
   * deterministic tests (see `pruneNotifications`'s tests, which fake the clock instead,
   * but still rely on being able to stamp old `ts` values directly here). */
  ts?: string;
}

function rowToNotification(r: any): Notification {
  return {
    id: r.id,
    automationId: r.automation_id,
    ts: r.ts,
    severity: r.severity,
    title: r.title,
    body: r.body,
    acked: !!r.acked,
  };
}

function getNotification(db: Database.Database, id: number): Notification | null {
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  return row ? rowToNotification(row) : null;
}

export function insertNotification(db: Database.Database, input: NotificationInput): Notification {
  const res = db.prepare(`INSERT INTO notifications (automation_id, ts, severity, title, body, acked)
      VALUES (?, ?, ?, ?, ?, 0)`)
    .run(
      input.automationId ?? null,
      input.ts ?? new Date().toISOString(),
      input.severity ?? 'info',
      input.title,
      input.body ?? null,
    );
  return getNotification(db, Number(res.lastInsertRowid))!;
}

/**
 * Newest-first pagination. `before` is an EXCLUSIVE cursor on `id` (not `ts`): pass the
 * `id` of the last row from the previous page to get the next one. `id` (an autoincrement
 * rowid alias, strictly increasing with insertion order) is used instead of `ts` so a page
 * boundary is unambiguous even when two notifications share the same timestamp — a real
 * possibility here since `ts` has only millisecond resolution and an automation's actions
 * can fire several notify actions back to back.
 */
export function listNotifications(
  db: Database.Database,
  opts: { limit?: number; before?: number } = {},
): Notification[] {
  const limit = opts.limit ?? 50;
  const rows = (opts.before !== undefined
    ? db.prepare('SELECT * FROM notifications WHERE id < ? ORDER BY id DESC LIMIT ?').all(opts.before, limit)
    : db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit)
  );
  return rows.map(rowToNotification);
}

export function ackNotification(db: Database.Database, id: number): Notification {
  const existing = getNotification(db, id);
  if (!existing) throw new NotFoundError(`notification ${id}`);
  db.prepare('UPDATE notifications SET acked = 1 WHERE id = ?').run(id);
  return getNotification(db, id)!;
}

/** Marks every currently-unacked notification acked ("mark all read"). Returns the number
 * affected (0 on an already-clean table — not an error). */
export function ackAll(db: Database.Database): number {
  const res = db.prepare('UPDATE notifications SET acked = 1 WHERE acked = 0').run();
  return res.changes;
}

export function unackedCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) c FROM notifications WHERE acked = 0').get() as { c: number }).c;
}

/**
 * Deletes notifications older than `olderThanDays` (compared against `ts`, not insertion
 * order), default 90 per the plan. Age-based only — deliberately NOT scoped to `acked`
 * notifications: an unacked notification that's 90+ days old is stale regardless of
 * whether anyone dismissed it, and this repo has no separate "unacked retention forever"
 * requirement in the spec. Returns the number of rows removed.
 */
export function pruneNotifications(db: Database.Database, olderThanDays = 90): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const res = db.prepare('DELETE FROM notifications WHERE ts < ?').run(cutoff);
  return res.changes;
}
