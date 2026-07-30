import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { resolveWallPages, useRotatingPageIndex } from '../../src/web/lib/wallPages';
import type { TapState } from '../../src/server/core/state';

function makeTap(tapId: number, overrides: Partial<TapState> = {}): TapState {
  return {
    tapId,
    tapNumber: tapId,
    tapName: null,
    beer: null,
    keg: null,
    lastPour: null,
    pouring: false,
    curServMl: null,
    monitorOnline: true, hidden: false,
    temp: null,
    avgRating: null,
    nextUpBeerName: null,
    ...overrides,
  };
}

describe('resolveWallPages', () => {
  const taps = [makeTap(1), makeTap(2), makeTap(3)];

  it('returns a single all-taps page when config.pages is empty', () => {
    expect(resolveWallPages([], taps)).toEqual([taps]);
  });

  it('splits taps per page by tapIds', () => {
    const pages = resolveWallPages([{ tapIds: [1] }, { tapIds: [2, 3] }], taps);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.map((t) => t.tapId)).toEqual([1]);
    expect(pages[1]!.map((t) => t.tapId)).toEqual([2, 3]);
  });

  it('a page with empty tapIds shows every tap', () => {
    const pages = resolveWallPages([{ tapIds: [1] }, { tapIds: [] }], taps);
    expect(pages[1]!.map((t) => t.tapId)).toEqual([1, 2, 3]);
  });

  it('preserves the global tap order within a filtered page', () => {
    const pages = resolveWallPages([{ tapIds: [3, 1] }], taps);
    expect(pages[0]!.map((t) => t.tapId)).toEqual([1, 3]);
  });
});

describe('useRotatingPageIndex', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at page 0 and never starts a timer for a single page', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRotatingPageIndex(1, 15));
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never starts a timer for zero pages', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRotatingPageIndex(0, 15));
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('advances to the next page every rotationSeconds and wraps around', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRotatingPageIndex(3, 15));
    expect(result.current).toBe(0);

    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current).toBe(1);

    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current).toBe(2);

    act(() => { vi.advanceTimersByTime(15_000); });
    expect(result.current).toBe(0);
  });

  it('clears the timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useRotatingPageIndex(3, 15));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resets to page 0 when the page count shrinks to or below the current index', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ count }) => useRotatingPageIndex(count, 15),
      { initialProps: { count: 3 } },
    );
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current).toBe(2);

    rerender({ count: 2 });
    expect(result.current).toBe(0);
  });
});
