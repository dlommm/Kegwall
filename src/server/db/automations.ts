import type Database from 'better-sqlite3';
import { z, ZodError } from 'zod';
import { NotFoundError, ValidationError } from '../core/errors.js';
import {
  TriggerSchema, ConditionSchema, ActionSchema, AlertConfigSchema, AutomationRuleConfigSchema,
  type AutomationRule, type AutomationRuleInput, type AlertConfig,
} from '../core/automationSchema.js';

/** Row shape as stored in the `automations` table (migration 001) — three JSON text
 * columns (`trigger`, `conditions`, `actions`), `enabled`/`is_alert` as SQLite 0/1
 * integers, `last_fired_at` nullable ISO text. See `core/automationSchema.ts`'s top doc
 * comment for why `alertConfig` has no column of its own and instead rides inside the
 * `trigger` column's JSON as `{ trigger, alertConfig? }`. */
export interface AutomationRow {
  id: number;
  name: string;
  enabled: number;
  is_alert: number;
  trigger: string;
  conditions: string;
  actions: string;
  last_fired_at: string | null;
}

interface TriggerEnvelope {
  trigger: unknown;
  alertConfig?: unknown;
}

function formatZodError(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(value)'}: ${i.message}`).join('; ');
}

/** Parses `value` against `schema`, rethrowing a zod failure as this repo's `ValidationError`
 * (rather than letting a raw `ZodError` escape) so every write/read path through this file
 * fails the same documented way — see the Task 1 report for why this repo wraps rather than
 * following `db/settings.ts`'s bare-`.parse()` precedent. */
function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, context: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`${context}: ${formatZodError(result.error)}`);
  }
  return result.data;
}

/**
 * Decodes a raw `automations` row into the logical `AutomationRule` shape, unpacking the
 * `trigger` column's `{ trigger, alertConfig? }` envelope. Every JSON.parse/schema.parse
 * failure — corrupt JSON or a shape that no longer matches the current schema (e.g. after
 * a future trigger-kind rename) — surfaces as `ValidationError`, never a raw `SyntaxError`
 * or `ZodError`, so callers only ever need to handle one error type from this module.
 */
export function rowToRule(row: AutomationRow): AutomationRule {
  let envelope: TriggerEnvelope;
  try {
    envelope = JSON.parse(row.trigger);
  } catch {
    throw new ValidationError(`automation ${row.id}: trigger column is not valid JSON`);
  }

  const trigger = parseOrThrow(TriggerSchema, envelope.trigger, `automation ${row.id} trigger`);
  const alertConfig: AlertConfig | undefined = envelope.alertConfig === undefined
    ? undefined
    : parseOrThrow(AlertConfigSchema, envelope.alertConfig, `automation ${row.id} alertConfig`);

  let conditionsJson: unknown;
  let actionsJson: unknown;
  try {
    conditionsJson = JSON.parse(row.conditions);
  } catch {
    throw new ValidationError(`automation ${row.id}: conditions column is not valid JSON`);
  }
  try {
    actionsJson = JSON.parse(row.actions);
  } catch {
    throw new ValidationError(`automation ${row.id}: actions column is not valid JSON`);
  }

  const conditions = parseOrThrow(z.array(ConditionSchema), conditionsJson, `automation ${row.id} conditions`);
  const actions = parseOrThrow(z.array(ActionSchema), actionsJson, `automation ${row.id} actions`);

  const rule: AutomationRule = {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    isAlert: !!row.is_alert,
    trigger,
    conditions,
    actions,
    lastFiredAt: row.last_fired_at,
  };
  if (alertConfig !== undefined) rule.alertConfig = alertConfig;
  return rule;
}

/**
 * Validates a write payload (`AutomationRuleInput`, or a full `AutomationRule` — extra
 * `id`/`lastFiredAt` keys are silently stripped by the zod object schema) against
 * `AutomationRuleConfigSchema` and encodes it into the four writable column values.
 * Shared by `createAutomation`, `updateAutomation`'s merge, and `ruleToRow`.
 */
function encodeColumns(input: unknown): {
  name: string; enabled: number; is_alert: number; trigger: string; conditions: string; actions: string;
} {
  const parsed = parseOrThrow(AutomationRuleConfigSchema, input, 'automation');
  const envelope: TriggerEnvelope = { trigger: parsed.trigger };
  if (parsed.alertConfig) envelope.alertConfig = parsed.alertConfig;
  return {
    name: parsed.name,
    enabled: parsed.enabled ? 1 : 0,
    is_alert: parsed.isAlert ? 1 : 0,
    trigger: JSON.stringify(envelope),
    conditions: JSON.stringify(parsed.conditions),
    actions: JSON.stringify(parsed.actions),
  };
}

/** The inverse of `rowToRule` — encodes a full `AutomationRule` (id and all) back into row
 * form. Exists primarily so `rowToRule(ruleToRow(rule))` is a clean round-trip check (this
 * task's repo CRUD test), but it's also how `createAutomation`/`updateAutomation` could
 * re-derive a row if ever needed outside a fresh `SELECT`. */
export function ruleToRow(rule: AutomationRule): AutomationRow {
  const cols = encodeColumns(rule);
  return { id: rule.id, ...cols, last_fired_at: rule.lastFiredAt };
}

export function getAutomation(db: Database.Database, id: number): AutomationRule | null {
  const row = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as AutomationRow | undefined;
  return row ? rowToRule(row) : null;
}

export function listAutomations(
  db: Database.Database,
  opts: { enabledOnly?: boolean } = {},
): AutomationRule[] {
  const rows = (opts.enabledOnly
    ? db.prepare('SELECT * FROM automations WHERE enabled = 1 ORDER BY name')
    : db.prepare('SELECT * FROM automations ORDER BY name')
  ).all() as AutomationRow[];
  return rows.map(rowToRule);
}

export function createAutomation(db: Database.Database, input: AutomationRuleInput): AutomationRule {
  const cols = encodeColumns(input);
  const res = db.prepare(`INSERT INTO automations (name, enabled, is_alert, trigger, conditions, actions)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(cols.name, cols.enabled, cols.is_alert, cols.trigger, cols.conditions, cols.actions);
  return getAutomation(db, Number(res.lastInsertRowid))!;
}

/**
 * Partial update: any field omitted (`undefined`) keeps its existing stored value —
 * matching this codebase's established merge idiom (`db/taps.ts#updateTap`,
 * `db/beers.ts#updateBeer`). `alertConfig` is the one nullable-on-write field: pass an
 * explicit `null` to clear it (mirrors `taps.ts`'s `defaultDrinkerId` — "explicit null,
 * not field omitted"), or a value to replace it; omitting the key (or passing `undefined`)
 * leaves whatever is already stored untouched. The merged result is re-validated as a
 * whole via `encodeColumns`, so e.g. flipping `isAlert` to `true` on a rule with no
 * `alertConfig` (and none supplied in this same call) still throws `ValidationError`.
 */
export function updateAutomation(
  db: Database.Database,
  id: number,
  input: Partial<Omit<AutomationRuleInput, 'alertConfig'>> & { alertConfig?: AlertConfig | null },
): AutomationRule {
  const existing = getAutomation(db, id);
  if (!existing) throw new NotFoundError(`automation ${id}`);

  const merged = {
    name: input.name ?? existing.name,
    enabled: input.enabled ?? existing.enabled,
    isAlert: input.isAlert ?? existing.isAlert,
    trigger: input.trigger ?? existing.trigger,
    conditions: input.conditions ?? existing.conditions,
    actions: input.actions ?? existing.actions,
    alertConfig: input.alertConfig === undefined ? existing.alertConfig : (input.alertConfig ?? undefined),
  };
  const cols = encodeColumns(merged);
  db.prepare(`UPDATE automations SET name = ?, enabled = ?, is_alert = ?, trigger = ?,
      conditions = ?, actions = ? WHERE id = ?`)
    .run(cols.name, cols.enabled, cols.is_alert, cols.trigger, cols.conditions, cols.actions, id);
  return getAutomation(db, id)!;
}

export function setEnabled(db: Database.Database, id: number, enabled: boolean): AutomationRule {
  const existing = getAutomation(db, id);
  if (!existing) throw new NotFoundError(`automation ${id}`);
  db.prepare('UPDATE automations SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return getAutomation(db, id)!;
}

/** Stamps `last_fired_at` — called by Task 3's engine every time a rule's actions run.
 * Defaults `ts` to "now" (ISO 8601, UTC) when not given. */
export function touchLastFired(db: Database.Database, id: number, ts: string = new Date().toISOString()): AutomationRule {
  const existing = getAutomation(db, id);
  if (!existing) throw new NotFoundError(`automation ${id}`);
  db.prepare('UPDATE automations SET last_fired_at = ? WHERE id = ?').run(ts, id);
  return getAutomation(db, id)!;
}

/**
 * `notifications.automation_id REFERENCES automations(id)` with no `ON DELETE` clause, and
 * this app runs with `foreign_keys = ON` (see `db/db.ts`) — a bare `DELETE` here would
 * raise a raw `SqliteError` for any rule with notification history. Rather than
 * `db/taps.ts#deleteTap`'s "block the delete" precedent, this follows
 * `db/users.ts#deleteUser`'s "null out the reference, keep the history" precedent instead:
 * notifications are a log (an alert that already fired should stay visible in the
 * notification center after its rule is deleted or edited away), not a live reference that
 * would go stale, so orphaning `automation_id` is the correct behavior, not a workaround.
 */
export function deleteAutomation(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE notifications SET automation_id = NULL WHERE automation_id = ?').run(id);
    db.prepare('DELETE FROM automations WHERE id = ?').run(id);
  });
  tx();
}
