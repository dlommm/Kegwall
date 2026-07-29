import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TapState } from '../../src/server/core/state';
import { useTakeover, TAKEOVER_COMPLETE_MS } from '../../src/web/lib/useTakeover';

function makeTap(tapId: number, overrides: Partial<TapState> = {}): TapState {
  return {
    tapId,
    tapNumber: tapId,
    tapName: null,
    beer: {
      id: tapId, name: `Beer ${tapId}`, brewery: null, style: 'IPA', abv: 6, ibu: 50, srm: 8, description: null, labelImage: null, createdAt: '',
    },
    keg: {
      id: tapId, beerId: tapId, tapId, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 4000, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 79, remainingMl: 15000,
    },
    lastPour: null,
    pouring: false,
    curServMl: null,
    monitorOnline: true,
    temp: null,
    avgRating: null,
    nextUpBeerName: null,
    ...overrides,
  };
}

const TAKEOVER = { style: 'full' as const, minMl: 60 };

describe('useTakeover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays idle with no pour, when disabled, and below the trigger threshold', () => {
    const quiet = [makeTap(1), makeTap(2)];
    const { result: idle } = renderHook(() => useTakeover(quiet, TAKEOVER));
    expect(idle.current.phase).toBe('idle');

    const pouringSmall = [makeTap(1, { pouring: true, curServMl: 30 })];
    const { result: belowThreshold } = renderHook(() => useTakeover(pouringSmall, TAKEOVER));
    expect(belowThreshold.current.phase).toBe('idle');

    const pouringBig = [makeTap(1, { pouring: true, curServMl: 300 })];
    const { result: off } = renderHook(() => useTakeover(pouringBig, { style: 'off', minMl: 60 }));
    expect(off.current.phase).toBe('idle');
  });

  it('activates once the live counter passes minMl and tracks it', () => {
    let taps = [makeTap(1, { pouring: true, curServMl: 30 })];
    const { result, rerender } = renderHook(({ t }) => useTakeover(t, TAKEOVER), {
      initialProps: { t: taps },
    });
    expect(result.current.phase).toBe('idle');

    taps = [makeTap(1, { pouring: true, curServMl: 120 })];
    rerender({ t: taps });
    expect(result.current.phase).toBe('active');
    expect(result.current.pourMl).toBe(120);

    taps = [makeTap(1, { pouring: true, curServMl: 250 })];
    rerender({ t: taps });
    expect(result.current.pourMl).toBe(250);
  });

  it('holds a 2.5s complete splash with the final volume, then goes idle', () => {
    let taps = [makeTap(1, { pouring: true, curServMl: 350 })];
    const { result, rerender } = renderHook(({ t }) => useTakeover(t, TAKEOVER), {
      initialProps: { t: taps },
    });
    expect(result.current.phase).toBe('active');

    taps = [makeTap(1, { pouring: false, curServMl: null })];
    rerender({ t: taps });
    expect(result.current.phase).toBe('complete');
    expect(result.current.pourMl).toBe(350);

    act(() => {
      vi.advanceTimersByTime(TAKEOVER_COMPLETE_MS + 10);
    });
    expect(result.current.phase).toBe('idle');
  });

  it('a new qualifying pour cuts the complete splash short', () => {
    let taps = [makeTap(1, { pouring: true, curServMl: 350 }), makeTap(2)];
    const { result, rerender } = renderHook(({ t }) => useTakeover(t, TAKEOVER), {
      initialProps: { t: taps },
    });
    taps = [makeTap(1), makeTap(2)];
    rerender({ t: taps });
    expect(result.current.phase).toBe('complete');

    taps = [makeTap(1), makeTap(2, { pouring: true, curServMl: 200 })];
    rerender({ t: taps });
    expect(result.current.phase).toBe('active');
    expect(result.current.tap?.tapId).toBe(2);

    // The stale complete timer must not knock the new takeover back to idle.
    act(() => {
      vi.advanceTimersByTime(TAKEOVER_COMPLETE_MS + 10);
    });
    expect(result.current.phase).toBe('active');
  });

  it('the first qualifying pour keeps the takeover when a second tap starts', () => {
    let taps = [makeTap(1, { pouring: true, curServMl: 200 }), makeTap(2)];
    const { result, rerender } = renderHook(({ t }) => useTakeover(t, TAKEOVER), {
      initialProps: { t: taps },
    });
    expect(result.current.tap?.tapId).toBe(1);

    taps = [
      makeTap(1, { pouring: true, curServMl: 260 }),
      makeTap(2, { pouring: true, curServMl: 500 }),
    ];
    rerender({ t: taps });
    expect(result.current.tap?.tapId).toBe(1);
    expect(result.current.pourMl).toBe(260);
  });

  it('ignores pours on a kicked keg', () => {
    const kickedKeg = makeTap(1, { pouring: true, curServMl: 300 });
    kickedKeg.keg = { ...kickedKeg.keg!, status: 'kicked' };
    const { result } = renderHook(() => useTakeover([kickedKeg], TAKEOVER));
    expect(result.current.phase).toBe('idle');
  });
});
