import { describe, it, expect } from 'vitest';
import {
  isNewTap, isLowTap, onTapCount, filterMenuTaps,
} from '../../src/web/lib/menuFilter';
import type { TapState } from '../../src/server/core/state';

function tap(id: number, over: Partial<TapState['keg']> | null, beer = true): TapState {
  const keg = over === null ? null : {
    id, beerId: 1, tapId: id, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0,
    dateTapped: null, status: 'on_tap' as const, createdAt: '', kegType: null, costCents: null,
    depositCents: null, supplierId: null, purchasedAt: null, levelPct: 50, remainingMl: 9500, ...over,
  };
  return {
    tapId: id, tapNumber: id, tapName: null,
    beer: beer ? { id: 1, name: 'Beer', brewery: null, style: null, abv: null, ibu: null, srm: 5, description: null, labelImage: null, createdAt: '', markupOverridePct: null, exclusiveSupplierId: null } : null,
    keg, lastPour: null, pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null, avgRating: null, nextUpBeerName: null,
  };
}

const NOW = new Date('2026-08-02T12:00:00Z');

describe('menuFilter', () => {
  it('counts only taps with a beer on an un-kicked keg', () => {
    const taps = [tap(1, {}), tap(2, { status: 'kicked', levelPct: 0 }), tap(3, null), tap(4, {}, false)];
    expect(onTapCount(taps)).toBe(1);
  });

  it('flags a recently-tapped keg as new (within 7 days) but not an old one', () => {
    expect(isNewTap(tap(1, { dateTapped: '2026-07-30T00:00:00Z' }), NOW)).toBe(true);
    expect(isNewTap(tap(1, { dateTapped: '2026-06-01T00:00:00Z' }), NOW)).toBe(false);
    expect(isNewTap(tap(1, { dateTapped: null }), NOW)).toBe(false);
  });

  it('flags a keg at or below 15% as low', () => {
    expect(isLowTap(tap(1, { levelPct: 12 }))).toBe(true);
    expect(isLowTap(tap(1, { levelPct: 40 }))).toBe(false);
  });

  it('filterMenuTaps narrows to new / low / all', () => {
    const taps = [
      tap(1, { dateTapped: '2026-07-30T00:00:00Z', levelPct: 80 }),
      tap(2, { dateTapped: '2026-01-01T00:00:00Z', levelPct: 10 }),
    ];
    expect(filterMenuTaps(taps, 'all', NOW).map((t) => t.tapId)).toEqual([1, 2]);
    expect(filterMenuTaps(taps, 'new', NOW).map((t) => t.tapId)).toEqual([1]);
    expect(filterMenuTaps(taps, 'low', NOW).map((t) => t.tapId)).toEqual([2]);
  });
});
