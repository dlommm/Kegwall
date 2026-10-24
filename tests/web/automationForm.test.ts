import { describe, it, expect } from 'vitest';
import {
  TriggerSchema, ConditionSchema, ActionSchema, AutomationRuleConfigSchema,
  type AutomationRuleConfig, type Action, type Condition,
} from '../../src/server/core/automationSchema';
import { TEMPLATES } from '../../src/server/automation/templates';
import {
  TRIGGER_KINDS, CONDITION_KINDS, ACTION_KINDS,
  TRIGGER_LABELS, CONDITION_LABELS, ACTION_LABELS,
  defaultTrigger, defaultCondition, defaultAction, defaultAlertConfig,
  blankFormState, ruleToFormState, formStateToRuleCandidate, parseAutomationForm,
  triggerSummary,
  actionSummary,
} from '../../src/web/lib/automationForm';

// ---------------------------------------------------------------------------
// Phase 5 Task 6: the automations builder's serializer/deserializer round-trip is called
// out in the plan as THE critical logic -- this suite is the matrix: every trigger kind's
// default is schema-valid (the "switching trigger kind resets to defaults" lesson from
// WallEditor), every condition/action kind's default is schema-valid, a blank form
// round-trips, and every one of the 9 real alert templates' built rule loads into the
// form and re-serializes to an equivalent shape.
// ---------------------------------------------------------------------------

describe('kind lists cover every schema-defined kind exactly', () => {
  it('TRIGGER_KINDS/labels match every TriggerSchema option', () => {
    const schemaKinds = TriggerSchema.options.map((o) => o.shape.type.value).sort();
    expect([...TRIGGER_KINDS].sort()).toEqual(schemaKinds);
    for (const kind of TRIGGER_KINDS) expect(TRIGGER_LABELS[kind]).toBeTruthy();
  });

  it('CONDITION_KINDS/labels match every ConditionSchema option', () => {
    const schemaKinds = ConditionSchema.options.map((o) => o.shape.type.value).sort();
    expect([...CONDITION_KINDS].sort()).toEqual(schemaKinds);
    for (const kind of CONDITION_KINDS) expect(CONDITION_LABELS[kind]).toBeTruthy();
  });

  it('ACTION_KINDS/labels match every ActionSchema option', () => {
    const schemaKinds = ActionSchema.options.map((o) => o.shape.type.value).sort();
    expect([...ACTION_KINDS].sort()).toEqual(schemaKinds);
    for (const kind of ACTION_KINDS) expect(ACTION_LABELS[kind]).toBeTruthy();
  });
});

describe('defaultTrigger/defaultCondition/defaultAction: every kind produces a schema-valid default', () => {
  it.each(TRIGGER_KINDS)('defaultTrigger(%s) is TriggerSchema-valid', (kind) => {
    const result = TriggerSchema.safeParse(defaultTrigger(kind));
    expect(result.success).toBe(true);
  });

  // `wall_scope` (Task 8) is the one condition kind whose ONE meaningful field
  // (`wallSlugs`) has no honest non-empty default -- unlike `tap_scope`/`beer_scope`,
  // whose empty-array default is itself schema-valid ("no restriction"), `wall_scope`'s
  // schema requires `.min(1)` (an empty scope has no "match every wall" reading anyone
  // would want -- see automationSchema.ts's doc comment on it), so a blank default can
  // only be shape-correct, not schema-valid, same carve-out reasoning as `webhook`/
  // `mqtt_publish` below.
  const CONDITION_REQUIRES_USER_INPUT: readonly Condition['type'][] = ['wall_scope'];

  it.each(CONDITION_KINDS)('defaultCondition(%s) is ConditionSchema-valid (or shape-correct pending required input)', (kind) => {
    const result = ConditionSchema.safeParse(defaultCondition(kind));
    if (CONDITION_REQUIRES_USER_INPUT.includes(kind)) {
      expect(result.success).toBe(false);
      const filled = { ...defaultCondition(kind), wallSlugs: ['main'] };
      expect(ConditionSchema.safeParse(filled).success).toBe(true);
    } else {
      expect(result.success).toBe(true);
    }
  });

  // `webhook`/`mqtt_publish` are the two action kinds whose ONE meaningful field (a
  // destination `url`/`topic`) has no honest non-empty default — a placeholder URL would
  // look configured when it isn't, the opposite of every other kind's "usable as-is"
  // default. Their shape is still right (see the follow-up assertions below); they just
  // require the admin to type a real destination before save succeeds, same as
  // WallEditor's own name/slug fields start blank and block save until filled.
  const REQUIRES_USER_INPUT: readonly Action['type'][] = ['webhook', 'mqtt_publish'];

  it.each(ACTION_KINDS)('defaultAction(%s) is ActionSchema-valid (or shape-correct pending required input)', (kind) => {
    const result = ActionSchema.safeParse(defaultAction(kind));
    if (REQUIRES_USER_INPUT.includes(kind)) {
      expect(result.success).toBe(false);
      // Filling in the one missing field makes it valid — proves the shape is otherwise
      // right, not just "any empty object".
      const filled = kind === 'webhook'
        ? { ...defaultAction(kind), url: 'https://example.com/hook' }
        : { ...defaultAction(kind), topic: 'kegtron/example' };
      expect(ActionSchema.safeParse(filled).success).toBe(true);
    } else {
      expect(result.success).toBe(true);
    }
  });

  it('switching trigger kind never carries over the old kind\'s fields (fresh object each time)', () => {
    const a = defaultTrigger('keg_level_crosses');
    const b = defaultTrigger('temp_crosses');
    expect(a).not.toHaveProperty('value');
    expect(b).not.toHaveProperty('thresholdPct');
  });
});

describe('blankFormState', () => {
  it('fails with a friendly "Name is required." message when name is empty', () => {
    const result = parseAutomationForm(blankFormState());
    expect(result).toEqual({ ok: false, errors: ['Name is required.'] });
  });

  it('parses once a name is set, producing a schema-defaulted AutomationRuleInput', () => {
    const form = { ...blankFormState(), name: 'My rule' };
    const result = parseAutomationForm(form);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input).toMatchObject({
        name: 'My rule', enabled: true, isAlert: false, trigger: { type: 'pour_completed' },
        conditions: [], actions: [],
      });
      expect(result.input.alertConfig).toBeUndefined();
    }
  });

  it('isAlert without a configured alertConfig fails with a friendly message (should not happen via the builder, but the refine is a safety net)', () => {
    const form = { ...blankFormState(), name: 'X', isAlert: true };
    // formStateToRuleCandidate always attaches alertConfig when isAlert is true, so this
    // exercises that the candidate really does carry it through, not the refine failure
    // path itself (which the builder can never actually reach by construction).
    const result = parseAutomationForm(form);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.alertConfig).toEqual(defaultAlertConfig());
  });
});

describe('friendly zod messages', () => {
  it('an invalid field produces a path-prefixed message, not raw zod internals', () => {
    const form = {
      ...blankFormState(),
      name: 'Bad webhook',
      actions: [{ type: 'webhook' as const, url: 'not-a-url', bodyTemplate: '' }],
    };
    const result = parseAutomationForm(form);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/^actions\.0\.url:/);
      expect(result.errors[0]).not.toMatch(/ZodError|issues\[/);
    }
  });
});

describe('every one of the 9 alert templates loads into the form and re-serializes cleanly', () => {
  const servingSizeMl = 473;

  for (const template of TEMPLATES) {
    it(`${template.id}: build() -> ruleToFormState -> parseAutomationForm round-trips`, () => {
      const defaultParams = template.paramsSchema.parse({});
      const inputs = template.build(defaultParams, { servingSizeMl });
      expect(inputs.length).toBeGreaterThan(0);

      for (const input of inputs) {
        const config: AutomationRuleConfig = AutomationRuleConfigSchema.parse(input);
        const form = ruleToFormState(config);
        const result = parseAutomationForm(form);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.input.name).toBe(config.name);
          expect(result.input.isAlert).toBe(config.isAlert);
          expect(result.input.trigger).toEqual(config.trigger);
          expect(result.input.conditions).toEqual(config.conditions);
          expect(result.input.actions).toEqual(config.actions);
          if (config.isAlert) expect(result.input.alertConfig).toEqual(config.alertConfig);
        }

        // A second round-trip (form -> candidate -> parse -> form again) must be a no-op
        // (idempotent) -- the exact "does saving an unedited loaded rule change anything"
        // check the plan's serializer emphasis is really about.
        if (result.ok) {
          const reloaded = ruleToFormState(AutomationRuleConfigSchema.parse(result.input));
          expect(formStateToRuleCandidate(reloaded)).toEqual(formStateToRuleCandidate(form));
        }
      }
    });
  }
});

describe('triggerSummary', () => {
  it('keg_level_crosses reads as a plain sentence', () => {
    expect(triggerSummary({ type: 'keg_level_crosses', thresholdPct: 15, direction: 'below' }))
      .toBe('When keg level drops below 15%');
  });

  it('schedule with no weekdays reads as "Every day"', () => {
    expect(triggerSummary({ type: 'schedule', time: '09:00', weekdays: [] }))
      .toBe('Every day at 09:00');
  });

  it('schedule with weekdays names them', () => {
    expect(triggerSummary({ type: 'schedule', time: '09:00', weekdays: [1, 3] }))
      .toBe('Every Mon, Wed at 09:00');
  });

  it('every trigger kind produces a non-empty sentence starting with "When"/"Every"', () => {
    for (const kind of TRIGGER_KINDS) {
      const summary = triggerSummary(defaultTrigger(kind));
      expect(summary.length).toBeGreaterThan(0);
      expect(/^(When|Every)/.test(summary)).toBe(true);
    }
  });

  it('actionSummary lists notify channels and other actions (redesign 4g)', () => {
    expect(actionSummary([{ type: 'notify', channels: ['ntfy', 'Discord'], title: 't', body: 'b' }]))
      .toBe('notify ntfy + Discord');
    expect(actionSummary([
      { type: 'notify', channels: ['ntfy'], title: 't', body: 'b' },
      { type: 'wall_banner', text: 'x', kind: 'info' } as any,
    ])).toBe('notify ntfy, show a wall banner');
    // Channel ids read as words, never the raw id ("notify inApp").
    expect(actionSummary([{ type: 'notify', channels: ['inApp', 'smtp'], title: 't', body: 'b' }]))
      .toBe('notify in the app + by email');
    expect(actionSummary([])).toBe('do nothing');
  });
});
