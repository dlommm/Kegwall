import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import {
  createAutomation, updateAutomation, deleteAutomation, listAutomations, getAutomation,
  setEnabled, touchLastFired, rowToRule, ruleToRow,
} from '../../src/server/db/automations.js';
import { insertNotification } from '../../src/server/db/notificationsRepo.js';
import { NotFoundError, ValidationError } from '../../src/server/core/errors.js';
import type { AutomationRule } from '../../src/server/core/automationSchema.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: Database.Database;
beforeEach(() => { db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-'))); });

const BANNER_ON_POUR = {
  name: 'Banner on pour',
  trigger: { type: 'pour_completed' as const },
  actions: [{ type: 'wall_banner' as const, text: 'Cheers!', kind: 'celebrate' as const }],
};

const KEG_LOW_ALERT = {
  name: 'Keg low',
  isAlert: true,
  trigger: { type: 'keg_level_crosses' as const, thresholdPct: 15, direction: 'below' as const },
  conditions: [
    { type: 'tap_scope' as const, tapIds: [1, 2] },
    { type: 'min_interval' as const, minutes: 60 },
  ],
  actions: [
    { type: 'notify' as const, channels: ['in_app'], title: 'Keg low', body: '{{beer.name}} is low' },
    { type: 'mqtt_publish' as const, topic: 'kegtron-dashboard/event/alert', payloadTemplate: '{}' },
  ],
  alertConfig: {
    cooldownMinutes: 30, autoResolve: true, notifyOnResolve: true, severity: 'warning' as const,
  },
};

describe('automations repo: create/get/list', () => {
  it('creates a minimal non-alert rule and applies schema defaults', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    expect(rule.id).toBeGreaterThan(0);
    expect(rule.name).toBe('Banner on pour');
    expect(rule.enabled).toBe(true);
    expect(rule.isAlert).toBe(false);
    expect(rule.conditions).toEqual([]);
    expect(rule.alertConfig).toBeUndefined();
    expect(rule.lastFiredAt).toBeNull();
    expect(rule.trigger).toEqual({ type: 'pour_completed' });
    expect(rule.actions).toEqual([{ type: 'wall_banner', text: 'Cheers!', kind: 'celebrate' }]);
  });

  it('creates a full alert rule with conditions, multiple actions, and alertConfig', () => {
    const rule = createAutomation(db, KEG_LOW_ALERT);
    expect(rule.isAlert).toBe(true);
    expect(rule.conditions).toHaveLength(2);
    expect(rule.actions).toHaveLength(2);
    expect(rule.alertConfig).toEqual({
      cooldownMinutes: 30, autoResolve: true, notifyOnResolve: true, severity: 'warning',
    });
  });

  it('getAutomation returns null for a missing id', () => {
    expect(getAutomation(db, 999)).toBeNull();
  });

  it('getAutomation round-trips a created rule exactly', () => {
    const created = createAutomation(db, KEG_LOW_ALERT);
    expect(getAutomation(db, created.id)).toEqual(created);
  });

  it('listAutomations lists all rules by default, enabledOnly filters disabled ones out', () => {
    const a = createAutomation(db, BANNER_ON_POUR);
    const b = createAutomation(db, { ...KEG_LOW_ALERT, enabled: false });
    const all = listAutomations(db);
    expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());

    const enabledOnly = listAutomations(db, { enabledOnly: true });
    expect(enabledOnly.map((r) => r.id)).toEqual([a.id]);
  });

  it('rejects a bad JSON shape on create (validation)', () => {
    expect(() => createAutomation(db, {
      name: 'Bad', trigger: { type: 'bogus_trigger' } as any,
    })).toThrow();
  });

  it('rejects isAlert:true with no alertConfig on create', () => {
    expect(() => createAutomation(db, {
      name: 'Bad alert', isAlert: true, trigger: { type: 'keg_kicked' },
    } as any)).toThrow(ValidationError);
  });

  it('rejects an empty name on create', () => {
    expect(() => createAutomation(db, { ...BANNER_ON_POUR, name: '' })).toThrow(ValidationError);
  });
});

describe('automations repo: update/delete/setEnabled/touchLastFired', () => {
  it('updates fields; omitted fields keep their existing stored value', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    const updated = updateAutomation(db, rule.id, { name: 'Banner renamed' });
    expect(updated.name).toBe('Banner renamed');
    expect(updated.trigger).toEqual(rule.trigger);
    expect(updated.actions).toEqual(rule.actions);
  });

  it('update can change trigger/conditions/actions wholesale', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    const updated = updateAutomation(db, rule.id, {
      trigger: { type: 'keg_kicked' },
      conditions: [{ type: 'tap_scope', tapIds: [3] }],
      actions: [{ type: 'party_mode', minutes: 5 }],
    });
    expect(updated.trigger).toEqual({ type: 'keg_kicked' });
    expect(updated.conditions).toEqual([{ type: 'tap_scope', tapIds: [3] }]);
    expect(updated.actions).toEqual([{ type: 'party_mode', minutes: 5 }]);
  });

  it('update can set isAlert + alertConfig together, and explicit null clears alertConfig', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    const withAlert = updateAutomation(db, rule.id, {
      isAlert: true, alertConfig: { severity: 'critical' } as any,
    });
    expect(withAlert.isAlert).toBe(true);
    expect(withAlert.alertConfig).toEqual({
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'critical',
    });

    const cleared = updateAutomation(db, rule.id, { isAlert: false, alertConfig: null as any });
    expect(cleared.isAlert).toBe(false);
    expect(cleared.alertConfig).toBeUndefined();
  });

  it('update throws ValidationError when isAlert:true with alertConfig cleared', () => {
    const rule = createAutomation(db, KEG_LOW_ALERT);
    expect(() => updateAutomation(db, rule.id, { alertConfig: null as any }))
      .toThrow(ValidationError);
  });

  it('update throws NotFoundError for a missing id', () => {
    expect(() => updateAutomation(db, 999, { name: 'x' })).toThrow(NotFoundError);
  });

  it('setEnabled toggles enabled and returns the updated rule', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    expect(setEnabled(db, rule.id, false).enabled).toBe(false);
    expect(setEnabled(db, rule.id, true).enabled).toBe(true);
    expect(getAutomation(db, rule.id)!.enabled).toBe(true);
  });

  it('setEnabled throws NotFoundError for a missing id', () => {
    expect(() => setEnabled(db, 999, true)).toThrow(NotFoundError);
  });

  it('touchLastFired stamps last_fired_at and returns the updated rule', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    expect(rule.lastFiredAt).toBeNull();
    const touched = touchLastFired(db, rule.id, '2026-07-28T12:00:00.000Z');
    expect(touched.lastFiredAt).toBe('2026-07-28T12:00:00.000Z');
    expect(getAutomation(db, rule.id)!.lastFiredAt).toBe('2026-07-28T12:00:00.000Z');
  });

  it('touchLastFired defaults to now() when no ts is given', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    const before = Date.now();
    const touched = touchLastFired(db, rule.id);
    expect(new Date(touched.lastFiredAt!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('touchLastFired throws NotFoundError for a missing id', () => {
    expect(() => touchLastFired(db, 999)).toThrow(NotFoundError);
  });

  it('deletes a rule with no notifications referencing it', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    deleteAutomation(db, rule.id);
    expect(getAutomation(db, rule.id)).toBeNull();
  });

  it('deleting a rule with notification history nulls automation_id rather than failing', () => {
    const rule = createAutomation(db, KEG_LOW_ALERT);
    const n = insertNotification(db, {
      automationId: rule.id, severity: 'warning', title: 'Keg low', body: 'IPA is low',
    });
    expect(() => deleteAutomation(db, rule.id)).not.toThrow();
    expect(getAutomation(db, rule.id)).toBeNull();
    const row = db.prepare('SELECT automation_id FROM notifications WHERE id = ?').get(n.id) as any;
    expect(row.automation_id).toBeNull();
  });
});

describe('automations repo: rowToRule/ruleToRow round-trip', () => {
  it('a full alert rule survives rowToRule(ruleToRow(rule)) exactly', () => {
    const created = createAutomation(db, KEG_LOW_ALERT);
    const row = ruleToRow(created);
    const roundTripped = rowToRule(row);
    expect(roundTripped).toEqual(created);
  });

  it('a minimal non-alert rule (no alertConfig, empty conditions) survives the round trip', () => {
    const created = createAutomation(db, BANNER_ON_POUR);
    expect(rowToRule(ruleToRow(created))).toEqual(created);
  });

  it('ruleToRow encodes alertConfig inside the trigger column envelope, not a bare trigger', () => {
    const created = createAutomation(db, KEG_LOW_ALERT);
    const row = ruleToRow(created);
    const envelope = JSON.parse(row.trigger);
    expect(envelope.trigger).toEqual(created.trigger);
    expect(envelope.alertConfig).toEqual(created.alertConfig);
  });

  it('rowToRule throws ValidationError on a corrupt trigger column', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    db.prepare('UPDATE automations SET trigger = ? WHERE id = ?').run('not json', rule.id);
    expect(() => getAutomation(db, rule.id)).toThrow(ValidationError);
  });

  it('rowToRule throws ValidationError when the stored trigger JSON no longer matches the schema', () => {
    const rule = createAutomation(db, BANNER_ON_POUR);
    db.prepare('UPDATE automations SET trigger = ? WHERE id = ?')
      .run(JSON.stringify({ trigger: { type: 'no_longer_a_real_trigger' } }), rule.id);
    expect(() => getAutomation(db, rule.id)).toThrow(ValidationError);
  });
});

// Type-level smoke check: AutomationRule as exported is assignable end to end. Not itself
// a runtime assertion — the import above (`AutomationRule`) is what typecheck exercises.
void (undefined as unknown as AutomationRule);
