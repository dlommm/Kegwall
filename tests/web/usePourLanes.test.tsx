import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TapState } from '../../src/server/core/state.js';
import {
  FINISH_HOLD_MS, LEAVE_MS, usePourLanes, type RecordedPour,
} from '../../src/web/wall/pour/usePourLanes';

function tap(id: number, over: Partial<TapState> = {}): TapState {
  return {
    tapId: id, tapNumber: id, tapName: null, beer: null,
    keg: { id, beerId: id, tapId: id, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 100, remainingMl: 19000 } as TapState['keg'],
    lastPour: null, pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null, avgRating: null,
    nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null, ...over,
  };
}
const TAKEOVER = { style: 'full' as const, minMl: 60, finish: 'plain' as const };
let clock = 1_000_000;
const now = () => clock;

beforeEach(() => { vi.useFakeTimers(); clock = 1_000_000; });
afterEach(() => { vi.useRealTimers(); });

function setup(initial: TapState[], recorded: RecordedPour[] = []) {
  return renderHook(({ taps, rec }) => usePourLanes(taps, TAKEOVER, rec, now), { initialProps: { taps: initial, rec: recorded } });
}

describe('usePourLanes', () => {
  it('opens a lane only once the pour passes the trigger', () => {
    const h = setup([tap(1, { pouring: true, curServMl: 30 })]);
    expect(h.result.current).toHaveLength(0);
    h.rerender({ taps: [tap(1, { pouring: true, curServMl: 90 })], rec: [] });
    expect(h.result.current).toHaveLength(1);
    expect(h.result.current[0]).toMatchObject({ tapId: 1, phase: 'pouring', measuredMl: 90 });
  });

  it('opens one lane per tap pouring at once, oldest first', () => {
    const h = setup([tap(1, { pouring: true, curServMl: 100 })]);
    clock += 500;
    h.rerender({ taps: [tap(1, { pouring: true, curServMl: 150 }), tap(6, { pouring: true, curServMl: 80 })], rec: [] });
    expect(h.result.current.map((l) => l.tapId)).toEqual([1, 6]);
  });

  it('never lets the measured volume go backwards', () => {
    const h = setup([tap(1, { pouring: true, curServMl: 200 })]);
    h.rerender({ taps: [tap(1, { pouring: true, curServMl: 150 })], rec: [] });
    expect(h.result.current[0]!.measuredMl).toBe(200);
  });

  it('finishes on the recorded volume, then leaves and is removed within 6 s', () => {
    const h = setup([tap(1, { pouring: true, curServMl: 236 })]);
    clock += 3000;
    const rec: RecordedPour[] = [{ tapId: 1, volumeMl: 412, durationMs: 6100, pourerName: 'Alex', pourerPourCount: 15, at: clock }];
    h.rerender({ taps: [tap(1, { pouring: false, curServMl: null })], rec });
    expect(h.result.current[0]).toMatchObject({ phase: 'finish', measuredMl: 236, recordedMl: 412, pourerName: 'Alex' });
    act(() => { vi.advanceTimersByTime(FINISH_HOLD_MS); });
    expect(h.result.current[0]!.phase).toBe('leaving');
    act(() => { vi.advanceTimersByTime(LEAVE_MS); });
    expect(h.result.current).toHaveLength(0);
    expect(FINISH_HOLD_MS + LEAVE_MS).toBeLessThanOrEqual(6000);
  });

  it('takes a recorded frame that arrives after the pour ended', () => {
    const h = setup([tap(1, { pouring: true, curServMl: 236 })]);
    h.rerender({ taps: [tap(1)], rec: [] });
    expect(h.result.current[0]!.recordedMl).toBeNull();
    clock += 400;
    h.rerender({ taps: [tap(1)], rec: [{ tapId: 1, volumeMl: 400, durationMs: null, pourerName: null, pourerPourCount: null, at: clock }] });
    expect(h.result.current[0]!.recordedMl).toBe(400);
  });

  it('ignores a recorded frame from an earlier pour on the same tap', () => {
    const old: RecordedPour = { tapId: 1, volumeMl: 999, durationMs: null, pourerName: null, pourerPourCount: null, at: clock - 5000 };
    const h = setup([tap(1, { pouring: true, curServMl: 120 })], [old]);
    h.rerender({ taps: [tap(1)], rec: [old] });
    expect(h.result.current[0]!.recordedMl).toBeNull();
  });

  it('never takes over for a kicked keg', () => {
    const kicked = tap(1, { pouring: true, curServMl: 300 });
    kicked.keg = { ...kicked.keg!, status: 'kicked' };
    expect(setup([kicked]).result.current).toHaveLength(0);
  });

  it('a new pour on a tap that is still finishing opens a fresh lane', () => {
    const h = setup([tap(1, { pouring: true, curServMl: 200 })]);
    h.rerender({ taps: [tap(1)], rec: [] });
    clock += 1000;
    h.rerender({ taps: [tap(1, { pouring: true, curServMl: 90 })], rec: [] });
    expect(h.result.current.map((l) => l.phase)).toEqual(['finish', 'pouring']);
  });
});
