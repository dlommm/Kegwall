import { describe, expect, it } from 'vitest';
import {
  isEmptyTap, isLowTap, servingsLeftPhrase, tapsHeadline, tapsSwapFirst,
} from '../../src/web/lib/tapsSay';

const tap = (tapNumber: number, over: Partial<Parameters<typeof tapsHeadline>[0][number]> = {}) => ({
  tapNumber, name: `Beer ${tapNumber}`, hasBeer: true, isKicked: false, levelPct: 60, servings: 24,
  servingNoun: 'pint' as const, ...over,
});

describe('the Taps page sentence', () => {
  it('says all is well in one line', () => {
    expect(tapsHeadline([tap(1), tap(2), tap(3)])).toBe('Three taps, all pouring.');
    expect(tapsHeadline([])).toBe('No taps yet.');
  });

  it('names an empty tap and counts the nearly-done kegs after it', () => {
    const taps = [tap(1), tap(4, { levelPct: 4, servings: 1.2 }), tap(7, { levelPct: 12, servings: 5 }),
      tap(12, { isKicked: true, servings: 0 })];
    expect(tapsHeadline(taps)).toBe('Four taps. Tap 12 is empty and two more kegs are nearly done.');
    expect(tapsSwapFirst(taps)).toBe('Swap Beer 4 on tap 4 first; it has about a pint left.');
  });

  it('leads with the low kegs when nothing is empty', () => {
    expect(tapsHeadline([tap(1), tap(2, { levelPct: 10, servings: 0.4 })]))
      .toBe('Two taps. One keg is nearly done.');
    expect(tapsSwapFirst([tap(2, { levelPct: 10, servings: 0.4, servingNoun: 'pour' })]))
      .toBe('Swap Beer 2 on tap 2 soon; it has under a pour left.');
  });

  it('treats a tap with no keg as empty, never as low', () => {
    const none = tap(5, { hasBeer: false, servings: null, levelPct: 0 });
    expect(isEmptyTap(none)).toBe(true);
    expect(isLowTap(none)).toBe(false);
    expect(tapsHeadline([none, tap(6, { hasBeer: false, servings: null })])).toBe('Two taps. Two are empty.');
  });

  it('rounds what is left the way a bartender would say it', () => {
    expect(servingsLeftPhrase(5.6, 'pint')).toBe('about six pints');
    expect(servingsLeftPhrase(1.3, 'pour')).toBe('about a pour');
  });
});
