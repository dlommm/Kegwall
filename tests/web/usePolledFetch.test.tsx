import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePolledFetch } from '../../src/web/lib/usePolledFetch';

describe('usePolledFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks immediately on mount and again every interval', () => {
    const tick = vi.fn();
    renderHook(() => usePolledFetch(tick, { intervalMs: 1000 }));
    expect(tick).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(999); });
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(tick).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it('skips the immediate tick when immediate is false', () => {
    const tick = vi.fn();
    renderHook(() => usePolledFetch(tick, { intervalMs: 1000, immediate: false }));
    expect(tick).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled, and starts polling once enabled', () => {
    const tick = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => usePolledFetch(tick, { intervalMs: 1000, enabled }),
      { initialProps: { enabled: false } },
    );
    act(() => { vi.advanceTimersByTime(5000); });
    expect(tick).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('reports cancellation to in-flight continuations after unmount', () => {
    let probe: (() => boolean) | undefined;
    const { unmount } = renderHook(() => usePolledFetch((isCancelled) => {
      probe = isCancelled;
    }, { intervalMs: 1000 }));

    expect(probe!()).toBe(false);
    unmount();
    expect(probe!()).toBe(true);
  });

  it('stops ticking after unmount', () => {
    const tick = vi.fn();
    const { unmount } = renderHook(() => usePolledFetch(tick, { intervalMs: 1000 }));
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(tick).toHaveBeenCalledTimes(1); // only the immediate mount tick
  });

  it('restarts (with a fresh immediate tick) when restartKey changes', () => {
    const tick = vi.fn();
    const { rerender } = renderHook(
      ({ key }) => usePolledFetch(tick, { intervalMs: 1000, restartKey: key }),
      { initialProps: { key: 'a' } },
    );
    expect(tick).toHaveBeenCalledTimes(1);

    // Advance halfway; a restartKey change re-ticks immediately and resets the clock.
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ key: 'b' });
    expect(tick).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(999); });
    expect(tick).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(1); });
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('marks the previous cycle cancelled when restartKey changes', () => {
    const probes: (() => boolean)[] = [];
    const { rerender } = renderHook(
      ({ key }) => usePolledFetch((isCancelled) => {
        probes.push(isCancelled);
      }, { intervalMs: 1000, restartKey: key }),
      { initialProps: { key: 1 } },
    );
    rerender({ key: 2 });
    expect(probes).toHaveLength(2);
    expect(probes[0]!()).toBe(true); // the pre-restart cycle is dead
    expect(probes[1]!()).toBe(false); // the new cycle is live
  });

  it('always uses the latest tick closure without restarting the timer', () => {
    const calls: string[] = [];
    const { rerender } = renderHook(
      ({ label }) => usePolledFetch(() => { calls.push(label); }, { intervalMs: 1000 }),
      { initialProps: { label: 'first' } },
    );
    expect(calls).toEqual(['first']);

    rerender({ label: 'second' }); // new closure identity — must NOT re-tick immediately
    expect(calls).toEqual(['first']);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(calls).toEqual(['first', 'second']);
  });
});
