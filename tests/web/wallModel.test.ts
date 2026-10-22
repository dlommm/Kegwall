import { describe, expect, it } from 'vitest';
import type { TapState } from '../../src/server/core/state.js';
import {
  markerLettersFor, servingNounFor, servingsLabelFor, wallTapModel,
} from '../../src/web/wall/wallModel';
import { wallHeadline } from '../../src/web/wall/headline';
import { contrastRatio, pickInk, INK_DARK, INK_LIGHT } from '../../src/web/lib/contrast';

const NOW = new Date(2026, 9, 22, 21, 0);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function tap(n: number, over: {
  name?: string; srm?: number | null; remainingMl?: number; status?: 'on_tap' | 'kicked';
  dateTapped?: string; tonight?: number; lastPourTs?: string; nextUp?: string | null; noKeg?: boolean;
} = {}): TapState {
  const sizeMl = 19000;
  const remainingMl = over.remainingMl ?? 9500;
  return {
    tapId: n, tapNumber: n, tapName: null,
    beer: {
      id: n, name: over.name ?? `Beer ${n}`, brewery: 'Garage', style: 'IPA', abv: 6, ibu: 40,
      srm: over.srm === undefined ? 6 : over.srm, description: null, labelImage: null, createdAt: '',
    } as TapState['beer'],
    keg: over.noKeg ? null : {
      id: n, beerId: n, tapId: n, sizeMl, volStartMl: sizeMl, volDispensedMl: sizeMl - remainingMl,
      dateTapped: over.dateTapped ?? hoursAgo(24 * 20), status: over.status ?? 'on_tap', createdAt: '',
      kegType: null, costCents: null, levelPct: (remainingMl / sizeMl) * 100, remainingMl,
    } as TapState['keg'],
    lastPour: over.lastPourTs ? { ts: over.lastPourTs, volumeMl: 400 } : null,
    pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null, avgRating: null,
    nextUpBeerName: over.nextUp ?? null,
    tonight: { pours: over.tonight ?? 0, volumeMl: (over.tonight ?? 0) * 450 },
    lastHourPours: 0, kickDate: null,
  };
}
const model = (t: TapState, servingSizeMl = 473) => wallTapModel(t, { units: 'us', servingSizeMl, now: NOW });

describe('wall tap model', () => {
  it('takes marker letters from the first two words, skipping a leading article', () => {
    expect(markerLettersFor('Citra Haze')).toBe('CH');
    expect(markerLettersFor('The Extraordinarily Long-Named Double IPA')).toBe('EL');
    expect(markerLettersFor('Weiss')).toBe('W');
    expect(markerLettersFor(null)).toBe('');
  });

  it('counts pints for pint-sized servings and pours otherwise', () => {
    expect(servingNounFor(473)).toBe('pint');
    expect(servingNounFor(568)).toBe('pint');
    expect(servingNounFor(355)).toBe('pour');
  });

  it("phrases what's left like a bartender", () => {
    expect(servingsLabelFor(32.4, 'pint', false)).toBe('≈ 32 pints left');
    expect(servingsLabelFor(1.2, 'pint', false)).toBe('≈ 1 pint left');
    expect(servingsLabelFor(0.6, 'pour', false)).toBe('Last pour');
    expect(servingsLabelFor(0, 'pint', false)).toBe('Empty');
    expect(servingsLabelFor(10, 'pint', true)).toBe('Kicked');
    expect(servingsLabelFor(null, 'pint', false)).toBe('No keg');
  });

  it('derives servings from the taproom serving size', () => {
    expect(model(tap(1, { remainingMl: 9460 })).servings).toBe(20);
    expect(model(tap(1, { remainingMl: 9460 }), 355).servingsLabel).toBe('≈ 27 pours left');
  });

  it('picks marker ink by contrast: dark on a pale lager, white on a stout', () => {
    expect(model(tap(1, { srm: 3 })).markerInk).toBe(INK_DARK);
    expect(model(tap(1, { srm: 38 })).markerInk).toBe(INK_LIGHT);
  });

  it('still colors a beer with no SRM (a cider)', () => {
    expect(model(tap(1, { srm: null })).beerColor).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('always picks an ink with at least 4.5:1 on any SRM color', () => {
    for (let srm = 1; srm <= 40; srm++) {
      const m = model(tap(1, { srm }));
      expect(contrastRatio(m.beerColor, pickInk(m.beerColor)), `SRM ${srm}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('wall headline', () => {
  it('leads with a keg that kicked today, and what replaces it', () => {
    const h = wallHeadline([
      model(tap(1)),
      model(tap(12, { name: 'Gourd Times', status: 'kicked', lastPourTs: hoursAgo(3), nextUp: 'Old Thunder' })),
    ], 'us', NOW);
    expect(h).toEqual({ lead: 'Gourd Times just kicked.', detail: 'Old Thunder is next on tap 12.' });
  });

  it('ignores a keg that kicked days ago', () => {
    const h = wallHeadline([
      model(tap(1, { name: 'Citra Haze' })),
      model(tap(12, { name: 'Gourd Times', status: 'kicked', lastPourTs: hoursAgo(80) })),
    ], 'us', NOW);
    expect(h.lead).toBe('1 beer on tap tonight.');
  });

  it('announces a keg tapped in the last two days, newest first', () => {
    const h = wallHeadline([
      model(tap(1, { name: 'Older New', dateTapped: hoursAgo(30) })),
      model(tap(2, { name: 'Citra Haze', dateTapped: hoursAgo(5) })),
    ], 'us', NOW);
    expect(h).toEqual({ lead: 'Just tapped: Citra Haze.', detail: 'Also new this week: Older New.' });
  });

  it('warns when a keg is almost gone', () => {
    const h = wallHeadline([
      model(tap(4, { name: 'Midnight Oats', remainingMl: 760, nextUp: 'Porter' })),
      model(tap(1)),
    ], 'us', NOW);
    expect(h).toEqual({ lead: 'Midnight Oats is almost gone, about 2 pints left.', detail: 'Porter is next on tap 4.' });
  });

  it("sums tonight's pours and names the busiest tap", () => {
    const h = wallHeadline([
      model(tap(1, { name: 'Citra Haze', tonight: 5 })),
      model(tap(2, { name: 'Vienna Nights', tonight: 9 })),
    ], 'us', NOW);
    expect(h.lead).toBe('14 pours tonight, 213 oz in all.');
    expect(h.detail).toBe('Vienna Nights is leading.');
  });

  it('handles an empty wall', () => {
    expect(wallHeadline([], 'us', NOW)).toEqual({ lead: 'Nothing on tap right now.', detail: null });
    expect(wallHeadline([model(tap(1, { noKeg: true }))], 'us', NOW).lead).toBe('Nothing on tap right now.');
  });
});
