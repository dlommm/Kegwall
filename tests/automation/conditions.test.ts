import { describe, it, expect } from 'vitest';
import {
  isWithinTimeWindow, crossed, opposite, evaluateConditions, type ConditionEvalCtx,
} from '../../src/server/automation/conditions.js';
import type { Condition } from '../../src/server/core/automationSchema.js';

// Phase 5 Task 3: pure condition-matrix + time-window/crossing-direction helpers, unit
// tested standalone (no db/bus/engine needed) — the engine itself (tests/automation/
// engine.test.ts) re-tests these end-to-end through real bus events, but every branch of
// the AND-ed condition matrix is exhaustively covered here in isolation.

function baseCtx(overrides: Partial<ConditionEvalCtx> = {}): ConditionEvalCtx {
  return {
    tapId: null, beerId: null, levelPct: null, volumeMl: null, temp: null,
    ts: '2026-07-27T12:00:00.000Z', ...overrides,
  };
}

describe('isWithinTimeWindow', () => {
  it('matches a normal (non-wrapping) window inclusively at start, exclusively at end', () => {
    expect(isWithinTimeWindow(new Date('2026-01-01T09:00:00'), '09:00', '17:00')).toBe(true);
    expect(isWithinTimeWindow(new Date('2026-01-01T16:59:00'), '09:00', '17:00')).toBe(true);
    expect(isWithinTimeWindow(new Date('2026-01-01T17:00:00'), '09:00', '17:00')).toBe(false);
    expect(isWithinTimeWindow(new Date('2026-01-01T08:59:00'), '09:00', '17:00')).toBe(false);
  });

  it('handles an overnight (wrapping past midnight) window', () => {
    expect(isWithinTimeWindow(new Date('2026-01-01T22:00:00'), '22:00', '08:00')).toBe(true);
    expect(isWithinTimeWindow(new Date('2026-01-01T23:30:00'), '22:00', '08:00')).toBe(true);
    expect(isWithinTimeWindow(new Date('2026-01-01T00:00:00'), '22:00', '08:00')).toBe(true);
    expect(isWithinTimeWindow(new Date('2026-01-01T07:59:00'), '22:00', '08:00')).toBe(true);
    expect(isWithinTimeWindow(new Date('2026-01-01T08:00:00'), '22:00', '08:00')).toBe(false);
    expect(isWithinTimeWindow(new Date('2026-01-01T21:59:00'), '22:00', '08:00')).toBe(false);
  });
});

describe('crossed / opposite', () => {
  it('"below": true only when prev is at-or-above and curr is below', () => {
    expect(crossed(20, 10, 15, 'below')).toBe(true);
    expect(crossed(15, 10, 15, 'below')).toBe(true); // prev exactly at threshold counts
    expect(crossed(10, 5, 15, 'below')).toBe(false); // already below -- not a crossing
    expect(crossed(10, 20, 15, 'below')).toBe(false); // wrong direction
  });

  it('"above": true only when prev is at-or-below and curr is above', () => {
    expect(crossed(10, 20, 15, 'above')).toBe(true);
    expect(crossed(15, 20, 15, 'above')).toBe(true);
    expect(crossed(20, 25, 15, 'above')).toBe(false); // already above
    expect(crossed(20, 10, 15, 'above')).toBe(false); // wrong direction
  });

  it('opposite() flips the direction', () => {
    expect(opposite('below')).toBe('above');
    expect(opposite('above')).toBe('below');
  });
});

describe('evaluateConditions', () => {
  it('empty conditions list always matches', () => {
    expect(evaluateConditions([], baseCtx(), null, new Date())).toBe(true);
  });

  describe('tap_scope', () => {
    it('empty tapIds = no restriction (matches even a null tap context)', () => {
      const c: Condition = { type: 'tap_scope', tapIds: [] };
      expect(evaluateConditions([c], baseCtx({ tapId: null }), null, new Date())).toBe(true);
      expect(evaluateConditions([c], baseCtx({ tapId: 3 }), null, new Date())).toBe(true);
    });

    it('matches only a listed tapId; fails for null tap context', () => {
      const c: Condition = { type: 'tap_scope', tapIds: [1, 2] };
      expect(evaluateConditions([c], baseCtx({ tapId: 1 }), null, new Date())).toBe(true);
      expect(evaluateConditions([c], baseCtx({ tapId: 3 }), null, new Date())).toBe(false);
      expect(evaluateConditions([c], baseCtx({ tapId: null }), null, new Date())).toBe(false);
    });
  });

  describe('beer_scope', () => {
    it('empty beerIds = no restriction', () => {
      const c: Condition = { type: 'beer_scope', beerIds: [] };
      expect(evaluateConditions([c], baseCtx({ beerId: null }), null, new Date())).toBe(true);
    });

    it('matches only a listed beerId; fails for null beer context', () => {
      const c: Condition = { type: 'beer_scope', beerIds: [5] };
      expect(evaluateConditions([c], baseCtx({ beerId: 5 }), null, new Date())).toBe(true);
      expect(evaluateConditions([c], baseCtx({ beerId: 6 }), null, new Date())).toBe(false);
      expect(evaluateConditions([c], baseCtx({ beerId: null }), null, new Date())).toBe(false);
    });
  });

  describe('time_window', () => {
    it('gates on the event ts local time-of-day', () => {
      const c: Condition = { type: 'time_window', start: '09:00', end: '17:00' };
      expect(evaluateConditions([c], baseCtx({ ts: new Date(2026, 0, 1, 12, 0).toISOString() }), null, new Date())).toBe(true);
      expect(evaluateConditions([c], baseCtx({ ts: new Date(2026, 0, 1, 20, 0).toISOString() }), null, new Date())).toBe(false);
    });
  });

  describe('weekday', () => {
    it('empty days = every day', () => {
      const c: Condition = { type: 'weekday', days: [] };
      expect(evaluateConditions([c], baseCtx({ ts: new Date(2026, 0, 1).toISOString() }), null, new Date())).toBe(true);
    });

    it('matches only listed weekdays (0=Sunday..6=Saturday, per Date#getDay())', () => {
      const c: Condition = { type: 'weekday', days: [1, 2, 3, 4, 5] }; // Mon-Fri
      // 2026-01-05 is a Monday
      expect(evaluateConditions([c], baseCtx({ ts: new Date(2026, 0, 5).toISOString() }), null, new Date())).toBe(true);
      // 2026-01-04 is a Sunday
      expect(evaluateConditions([c], baseCtx({ ts: new Date(2026, 0, 4).toISOString() }), null, new Date())).toBe(false);
    });
  });

  describe('value_compare', () => {
    it.each([
      ['lt', 10, 15, true], ['lt', 15, 15, false], ['lt', 20, 15, false],
      ['lte', 15, 15, true], ['lte', 20, 15, false],
      ['gt', 20, 15, true], ['gt', 15, 15, false],
      ['gte', 15, 15, true], ['gte', 10, 15, false],
    ] as const)('%s: field value %d vs threshold %d -> %s', (op, fieldValue, threshold, expected) => {
      const c: Condition = { type: 'value_compare', field: 'level_pct', op, value: threshold };
      expect(evaluateConditions([c], baseCtx({ levelPct: fieldValue }), null, new Date())).toBe(expected);
    });

    it('reads the right ctx field per `field`', () => {
      const volCond: Condition = { type: 'value_compare', field: 'volume_ml', op: 'gt', value: 300 };
      expect(evaluateConditions([volCond], baseCtx({ volumeMl: 400 }), null, new Date())).toBe(true);
      expect(evaluateConditions([volCond], baseCtx({ volumeMl: 100 }), null, new Date())).toBe(false);

      const tempCond: Condition = { type: 'value_compare', field: 'temp', op: 'gt', value: 10 };
      expect(evaluateConditions([tempCond], baseCtx({ temp: 15 }), null, new Date())).toBe(true);
    });

    it('a null ctx field always fails the comparison (cannot compare)', () => {
      const c: Condition = { type: 'value_compare', field: 'temp', op: 'gte', value: 0 };
      expect(evaluateConditions([c], baseCtx({ temp: null }), null, new Date())).toBe(false);
    });
  });

  describe('min_interval', () => {
    it('passes when the rule has never fired (lastFiredAt null)', () => {
      const c: Condition = { type: 'min_interval', minutes: 30 };
      expect(evaluateConditions([c], baseCtx(), null, new Date('2026-01-01T12:00:00Z'))).toBe(true);
    });

    it('fails when not enough time has elapsed since lastFiredAt', () => {
      const c: Condition = { type: 'min_interval', minutes: 30 };
      const lastFiredAt = '2026-01-01T12:00:00Z';
      const now = new Date('2026-01-01T12:20:00Z'); // only 20 min elapsed
      expect(evaluateConditions([c], baseCtx(), lastFiredAt, now)).toBe(false);
    });

    it('passes once enough time has elapsed since lastFiredAt', () => {
      const c: Condition = { type: 'min_interval', minutes: 30 };
      const lastFiredAt = '2026-01-01T12:00:00Z';
      const now = new Date('2026-01-01T12:30:00Z'); // exactly 30 min elapsed
      expect(evaluateConditions([c], baseCtx(), lastFiredAt, now)).toBe(true);
    });
  });

  describe('days_since_cleaned', () => {
    it('is false when daysSinceCleaned is not set on the ctx (not applicable)', () => {
      const c: Condition = { type: 'days_since_cleaned', days: 30 };
      expect(evaluateConditions([c], baseCtx(), null, new Date())).toBe(false);
    });

    it('is false when daysSinceCleaned is null (monitor has no recorded cleaning date)', () => {
      const c: Condition = { type: 'days_since_cleaned', days: 30 };
      expect(evaluateConditions([c], baseCtx({ daysSinceCleaned: null }), null, new Date())).toBe(false);
    });

    it('is true once at least `days` have elapsed (inclusive)', () => {
      const c: Condition = { type: 'days_since_cleaned', days: 30 };
      expect(evaluateConditions([c], baseCtx({ daysSinceCleaned: 29 }), null, new Date())).toBe(false);
      expect(evaluateConditions([c], baseCtx({ daysSinceCleaned: 30 }), null, new Date())).toBe(true);
      expect(evaluateConditions([c], baseCtx({ daysSinceCleaned: 45 }), null, new Date())).toBe(true);
    });
  });

  it('ANDs every condition -- one failure fails the whole list', () => {
    const conditions: Condition[] = [
      { type: 'tap_scope', tapIds: [1] },
      { type: 'value_compare', field: 'level_pct', op: 'lt', value: 15 },
    ];
    expect(evaluateConditions(conditions, baseCtx({ tapId: 1, levelPct: 10 }), null, new Date())).toBe(true);
    expect(evaluateConditions(conditions, baseCtx({ tapId: 1, levelPct: 50 }), null, new Date())).toBe(false);
    expect(evaluateConditions(conditions, baseCtx({ tapId: 2, levelPct: 10 }), null, new Date())).toBe(false);
  });
});
