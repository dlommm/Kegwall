import { describe, it, expect } from 'vitest';
import { buildTriage } from '../../src/web/lib/dashboardTriage';
import type { TapState } from '../../src/server/core/state';

function tap(tapId: number, over: Partial<TapState> = {}): TapState {
  return {
    tapId, tapNumber: tapId, tapName: null, beer: null, keg: null, lastPour: null,
    pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null,
    avgRating: null, nextUpBeerName: null, ...over,
  };
}

function keg(levelPct: number, status: 'on_tap' | 'kicked' = 'on_tap'): TapState['keg'] {
  return {
    id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0,
    dateTapped: null, status, createdAt: '', kegType: null, costCents: null,
    levelPct, remainingMl: 19000 * (levelPct / 100),
  };
}

const beer = (name: string) => ({
  id: 1, name, brewery: null, style: null, abv: null, ibu: null, srm: 5, description: null, labelImage: null, createdAt: '',
});

describe('buildTriage', () => {
  it('is empty when nothing needs attention', () => {
    expect(buildTriage({
      taps: [tap(1, { beer: beer('Full IPA'), keg: keg(80) })],
      unhealthySourceLabels: [], cleaningDueTapIds: [], undervolted: false,
    })).toEqual([]);
  });

  it('flags a low keg with a Swap action, including the next-up name', () => {
    const items = buildTriage({
      taps: [tap(2, { tapNumber: 2, beer: beer('Last Pils'), keg: keg(12), nextUpBeerName: 'Fresh Stout' })],
      unhealthySourceLabels: [], cleaningDueTapIds: [], undervolted: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ severity: 'warn', action: { label: 'Swap keg →', to: '/admin/taps' } });
    expect(items[0]!.message).toContain('Tap 2');
    expect(items[0]!.message).toContain('12%');
    expect(items[0]!.message).toContain('Next up: Fresh Stout');
  });

  it('ignores a kicked keg and a healthy keg', () => {
    const items = buildTriage({
      taps: [tap(1, { keg: keg(0, 'kicked') }), tap(2, { keg: keg(50) })],
      unhealthySourceLabels: [], cleaningDueTapIds: [], undervolted: false,
    });
    expect(items).toEqual([]);
  });

  it('ranks danger (undervoltage, unhealthy source) above warnings (low keg, cleaning)', () => {
    const items = buildTriage({
      taps: [tap(3, { tapNumber: 3, keg: keg(10) })],
      unhealthySourceLabels: ['Kegtron cloud'],
      cleaningDueTapIds: [3],
      undervolted: true,
    });
    expect(items.map((i) => i.severity)).toEqual(['danger', 'danger', 'warn', 'warn']);
    expect(items[0]!.id).toBe('undervolt');
    expect(items[1]!.action).toEqual({ label: 'Open doctor', to: '/admin/doctor' });
    expect(items.find((i) => i.id.startsWith('clean'))!.action).toEqual({ label: 'Log cleaning', to: '/admin/taps' });
  });
});
