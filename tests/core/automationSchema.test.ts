import { describe, it, expect } from 'vitest';
import {
  TriggerSchema, ConditionSchema, ActionSchema, AlertConfigSchema, AutomationRuleConfigSchema,
} from '../../src/server/core/automationSchema.js';

describe('TriggerSchema', () => {
  const validTriggers: unknown[] = [
    { type: 'pour_completed' },
    { type: 'pour_started' },
    { type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' },
    { type: 'keg_level_crosses', thresholdPct: 100, direction: 'above' },
    { type: 'keg_kicked' },
    { type: 'keg_tapped' },
    { type: 'device_online' },
    { type: 'device_offline' },
    { type: 'temp_crosses', value: 38, direction: 'above' },
    { type: 'humidity_crosses', value: 70, direction: 'above' },
    { type: 'humidity_crosses', value: 20, direction: 'below' },
    { type: 'schedule', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
    { type: 'schedule', time: '23:59', weekdays: [] },
    { type: 'app_startup' },
    { type: 'motion_detected' },
    { type: 'display_power_changed' },
    { type: 'display_power_changed', state: 'active' },
    { type: 'display_power_changed', state: 'screensaver' },
    { type: 'display_power_changed', state: 'off' },
  ];

  it.each(validTriggers)('accepts %j', (trigger) => {
    expect(() => TriggerSchema.parse(trigger)).not.toThrow();
  });

  const invalidTriggers: unknown[] = [
    { type: 'not_a_real_trigger' },
    {},
    { type: 'keg_level_crosses', thresholdPct: 15 }, // missing direction
    { type: 'keg_level_crosses', thresholdPct: 101, direction: 'below' }, // out of range
    { type: 'keg_level_crosses', thresholdPct: -1, direction: 'below' },
    { type: 'keg_level_crosses', thresholdPct: 15, direction: 'sideways' },
    { type: 'temp_crosses', value: 'hot', direction: 'above' },
    { type: 'humidity_crosses', value: 'damp', direction: 'above' },
    { type: 'humidity_crosses', value: 50 }, // missing direction
    { type: 'schedule', time: '9:00', weekdays: [1] }, // not zero-padded
    { type: 'schedule', time: '25:00', weekdays: [1] }, // invalid hour
    { type: 'schedule', time: '09:00', weekdays: [7] }, // out of 0-6 range
    { type: 'schedule', time: '09:00', weekdays: [-1] },
    { type: 'schedule', time: '09:00' }, // missing weekdays
    { type: 'pour_completed', extra: 'field-that-does-not-belong-does-not-fail-strictness' },
    { type: 'display_power_changed', state: 'sideways' }, // invalid state
  ];

  it.each(invalidTriggers)('rejects %j', (trigger) => {
    // (last valid-looking one above is intentionally NOT included in invalid — zod object
    // schemas strip unknown keys by default, so an extra field is not itself an error)
    if ((trigger as any)?.extra) {
      expect(() => TriggerSchema.parse(trigger)).not.toThrow();
      return;
    }
    expect(() => TriggerSchema.parse(trigger)).toThrow();
  });
});

describe('ConditionSchema', () => {
  const validConditions: unknown[] = [
    { type: 'tap_scope', tapIds: [1, 2] },
    { type: 'tap_scope', tapIds: [] },
    { type: 'beer_scope', beerIds: [3] },
    { type: 'time_window', start: '22:00', end: '08:00' },
    { type: 'weekday', days: [0, 6] },
    { type: 'value_compare', field: 'level_pct', op: 'lt', value: 15 },
    { type: 'value_compare', field: 'volume_ml', op: 'gte', value: 500 },
    { type: 'value_compare', field: 'temp', op: 'gt', value: 40 },
    { type: 'min_interval', minutes: 30 },
    { type: 'days_since_cleaned', days: 30 },
    { type: 'days_since_cleaned', days: 1 },
    { type: 'wall_scope', wallSlugs: ['main'] },
    { type: 'wall_scope', wallSlugs: ['main', 'patio'] },
  ];

  it.each(validConditions)('accepts %j', (condition) => {
    expect(() => ConditionSchema.parse(condition)).not.toThrow();
  });

  const invalidConditions: unknown[] = [
    { type: 'not_a_real_condition' },
    { type: 'tap_scope', tapIds: 'not-an-array' },
    { type: 'time_window', start: '22:00' }, // missing end
    { type: 'weekday', days: [7] },
    { type: 'value_compare', field: 'not_a_field', op: 'lt', value: 1 },
    { type: 'value_compare', field: 'level_pct', op: 'weird', value: 1 },
    { type: 'value_compare', field: 'level_pct', op: 'lt', value: 'nope' },
    { type: 'min_interval', minutes: 0 },
    { type: 'min_interval', minutes: -5 },
    { type: 'min_interval', minutes: 1.5 },
    { type: 'days_since_cleaned', days: 0 },
    { type: 'days_since_cleaned', days: -1 },
    { type: 'days_since_cleaned', days: 'thirty' },
    { type: 'wall_scope', wallSlugs: [] }, // empty = no restriction is NOT the semantics here
    { type: 'wall_scope', wallSlugs: [''] }, // empty string slug
    { type: 'wall_scope' }, // missing wallSlugs
  ];

  it.each(invalidConditions)('rejects %j', (condition) => {
    expect(() => ConditionSchema.parse(condition)).toThrow();
  });
});

describe('ActionSchema', () => {
  const validActions: unknown[] = [
    { type: 'notify', channels: ['in_app'], title: 'Keg low', body: '{{beer.name}} is low' },
    { type: 'notify', channels: ['in_app', 'discord'], title: 'x', body: '' },
    { type: 'webhook', url: 'https://example.com/hook', bodyTemplate: '{{pour.volume_ml}}' },
    { type: 'mqtt_publish', topic: 'kegtron/event/alert', payloadTemplate: '{"kegId":"{{keg.id}}"}' },
    { type: 'wall_banner', text: 'Cheers to {{drinker.name}}!', kind: 'celebrate' },
    { type: 'wall_banner', text: 'Low keg', kind: 'warning', durationMs: 8000 },
    { type: 'party_mode', minutes: 5 },
    { type: 'kegtron_reset_volume' },
    { type: 'display_power', state: 'active' },
    { type: 'display_power', state: 'off', wallSlugs: ['main'] },
    { type: 'display_power', state: 'screensaver', wallSlugs: ['main', 'patio'] },
  ];

  it.each(validActions)('accepts %j', (action) => {
    expect(() => ActionSchema.parse(action)).not.toThrow();
  });

  const invalidActions: unknown[] = [
    { type: 'notify', channels: [], title: 'x', body: 'y' }, // no channels
    { type: 'notify', channels: ['in_app'], body: 'y' }, // missing title
    { type: 'webhook', url: 'not-a-url', bodyTemplate: 'x' },
    { type: 'webhook', bodyTemplate: 'x' }, // missing url
    { type: 'mqtt_publish', topic: '', payloadTemplate: 'x' },
    { type: 'mqtt_publish', topic: 'kegtron/+/alert', payloadTemplate: 'x' }, // + wildcard
    { type: 'mqtt_publish', topic: 'kegtron/#', payloadTemplate: 'x' }, // # wildcard
    { type: 'mqtt_publish', topic: '$SYS/broker/load', payloadTemplate: 'x' }, // reserved $ topic
    { type: 'mqtt_publish', topic: 'keg\nron/x', payloadTemplate: 'x' }, // control char injection
    { type: 'wall_banner', text: 'hi', kind: 'sad' }, // invalid kind
    { type: 'party_mode', minutes: 0 },
    { type: 'party_mode' }, // missing minutes
    { type: 'not_a_real_action' },
    { type: 'display_power' }, // missing state
    { type: 'display_power', state: 'sideways' }, // invalid state
    { type: 'display_power', state: 'active', wallSlugs: [''] }, // empty string slug
  ];

  it.each(invalidActions)('rejects %j', (action) => {
    expect(() => ActionSchema.parse(action)).toThrow();
  });
});

describe('AlertConfigSchema', () => {
  it('defaults cooldownMinutes=60, autoResolve=true, notifyOnResolve=false', () => {
    const cfg = AlertConfigSchema.parse({ severity: 'warning' });
    expect(cfg).toEqual({
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
    });
  });

  it('requires severity', () => {
    expect(() => AlertConfigSchema.parse({})).toThrow();
  });

  it('rejects an unknown severity', () => {
    expect(() => AlertConfigSchema.parse({ severity: 'urgent' })).toThrow();
  });

  it('rejects a non-positive cooldownMinutes', () => {
    expect(() => AlertConfigSchema.parse({ severity: 'info', cooldownMinutes: 0 })).toThrow();
  });

  it('accepts explicit overrides', () => {
    const cfg = AlertConfigSchema.parse({
      severity: 'critical', cooldownMinutes: 15, autoResolve: false, notifyOnResolve: true,
    });
    expect(cfg).toEqual({
      cooldownMinutes: 15, autoResolve: false, notifyOnResolve: true, severity: 'critical',
    });
  });
});

describe('AutomationRuleConfigSchema', () => {
  const baseRule = {
    name: 'Banner on pour',
    trigger: { type: 'pour_completed' },
    actions: [{ type: 'wall_banner', text: 'Cheers!', kind: 'celebrate' }],
  };

  it('accepts a minimal non-alert rule and applies defaults', () => {
    const rule = AutomationRuleConfigSchema.parse(baseRule);
    expect(rule.enabled).toBe(true);
    expect(rule.isAlert).toBe(false);
    expect(rule.conditions).toEqual([]);
    expect(rule.alertConfig).toBeUndefined();
  });

  it('accepts a full alert rule with conditions, multiple actions, and alertConfig', () => {
    const rule = AutomationRuleConfigSchema.parse({
      name: 'Keg low',
      isAlert: true,
      trigger: { type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' },
      conditions: [{ type: 'tap_scope', tapIds: [1] }, { type: 'min_interval', minutes: 60 }],
      actions: [
        { type: 'notify', channels: ['in_app'], title: 'Keg low', body: '{{beer.name}} is low' },
        { type: 'mqtt_publish', topic: 'kegtron/event/alert', payloadTemplate: '{}' },
      ],
      alertConfig: { severity: 'warning' },
    });
    expect(rule.isAlert).toBe(true);
    expect(rule.alertConfig).toEqual({
      cooldownMinutes: 60, autoResolve: true, notifyOnResolve: false, severity: 'warning',
    });
    expect(rule.conditions).toHaveLength(2);
    expect(rule.actions).toHaveLength(2);
  });

  it('rejects an empty name', () => {
    expect(() => AutomationRuleConfigSchema.parse({ ...baseRule, name: '' })).toThrow();
  });

  it('rejects isAlert:true with no alertConfig', () => {
    expect(() => AutomationRuleConfigSchema.parse({ ...baseRule, isAlert: true })).toThrow();
  });

  it('rejects an invalid trigger', () => {
    expect(() => AutomationRuleConfigSchema.parse({ ...baseRule, trigger: { type: 'bogus' } }))
      .toThrow();
  });

  it('rejects an invalid condition inside the array', () => {
    expect(() => AutomationRuleConfigSchema.parse({
      ...baseRule, conditions: [{ type: 'min_interval', minutes: -1 }],
    })).toThrow();
  });

  it('rejects an invalid action inside the array', () => {
    expect(() => AutomationRuleConfigSchema.parse({
      ...baseRule, actions: [{ type: 'party_mode', minutes: -1 }],
    })).toThrow();
  });
});
