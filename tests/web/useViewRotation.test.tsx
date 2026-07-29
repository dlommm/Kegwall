import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewRotation, type RotationView } from '../../src/web/lib/useViewRotation';

const VIEWS: RotationView[] = [
  { kind: 'wall', seconds: 15, enabled: true },
  { kind: 'leaderboard', seconds: 10, enabled: true },
];

describe('useViewRotation (design 4a)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('advances per each view\'s own seconds and wraps', () => {
    const { result } = renderHook(() => useViewRotation(VIEWS, false));
    expect(result.current).toBe(0);
    act(() => {
      vi.advanceTimersByTime(15_000 + 10);
    });
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(10_000 + 10);
    });
    expect(result.current).toBe(0);
  });

  it('holds still with a single view or an empty playlist', () => {
    const { result: single } = renderHook(() => useViewRotation([VIEWS[0]!], false));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(single.current).toBe(0);
    const { result: none } = renderHook(() => useViewRotation([], false));
    expect(none.current).toBe(0);
  });

  it('a live pour interrupts back to the wall view and holds there', () => {
    const { result, rerender } = renderHook(
      ({ interrupt }) => useViewRotation(VIEWS, interrupt),
      { initialProps: { interrupt: false } },
    );
    act(() => {
      vi.advanceTimersByTime(15_000 + 10);
    });
    expect(result.current).toBe(1); // on the leaderboard

    rerender({ interrupt: true });
    expect(result.current).toBe(0); // snapped back to the wall
    act(() => {
      vi.advanceTimersByTime(60_000); // timers frozen during the pour
    });
    expect(result.current).toBe(0);

    rerender({ interrupt: false });
    act(() => {
      vi.advanceTimersByTime(15_000 + 10); // resumes with the wall's full duration
    });
    expect(result.current).toBe(1);
  });
});
