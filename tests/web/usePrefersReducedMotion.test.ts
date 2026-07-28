import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrefersReducedMotion } from '../../src/web/lib/usePrefersReducedMotion';

type Listener = (event: MediaQueryListEvent) => void;

function mockMatchMedia(initialMatches: boolean) {
  let changeListener: Listener | undefined;
  const mql = {
    matches: initialMatches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn((event: string, listener: Listener) => {
      if (event === 'change') changeListener = listener;
    }),
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    mql,
    fireChange(matches: boolean) {
      mql.matches = matches;
      changeListener?.({ matches } as MediaQueryListEvent);
    },
  };
}

describe('usePrefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- deliberately restoring jsdom's undefined-by-default matchMedia
    delete window.matchMedia;
  });

  it('defaults to false when matchMedia is unavailable (no crash)', () => {
    // @ts-expect-error -- simulate an environment without matchMedia
    delete window.matchMedia;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('reflects an initial "reduce" preference', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('reflects an initial "no preference"', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('updates when the media query change event fires', () => {
    const { fireChange } = mockMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      fireChange(true);
    });
    expect(result.current).toBe(true);
  });

  it('unsubscribes on unmount', () => {
    const { mql } = mockMatchMedia(false);
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
