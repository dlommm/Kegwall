import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { formatRelativeTime, useRelativeTime } from '../../src/web/lib/useRelativeTime';

const NOW = new Date('2026-07-28T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('reports "just now" for anything under a minute old', () => {
    expect(formatRelativeTime('2026-07-28T11:59:59.500Z', NOW)).toBe('just now');
    expect(formatRelativeTime(NOW.toISOString(), NOW)).toBe('just now');
  });

  it('reports minutes for 1-59 minutes old', () => {
    expect(formatRelativeTime('2026-07-28T11:56:00.000Z', NOW)).toBe('4 min ago');
    expect(formatRelativeTime('2026-07-28T11:01:00.000Z', NOW)).toBe('59 min ago');
  });

  it('reports hours for 1-23 hours old', () => {
    expect(formatRelativeTime('2026-07-28T09:00:00.000Z', NOW)).toBe('3 hr ago');
  });

  it('reports days for a day or more, with correct pluralization', () => {
    expect(formatRelativeTime('2026-07-27T12:00:00.000Z', NOW)).toBe('1 day ago');
    expect(formatRelativeTime('2026-07-25T12:00:00.000Z', NOW)).toBe('3 days ago');
  });

  it('falls back to "just now" for an unparsable timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('just now');
  });
});

describe('useRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when there is no timestamp, and starts no timer', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRelativeTime(null));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('updates its text every 30s (default interval) via fake timers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fourMinAgo = new Date(NOW.getTime() - 4 * 60_000).toISOString();

    const { result } = renderHook(() => useRelativeTime(fourMinAgo));
    expect(result.current).toBe('4 min ago');

    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe('5 min ago');
  });

  it('honors a custom interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const oneMinAgo = new Date(NOW.getTime() - 60_000).toISOString();

    const { result } = renderHook(() => useRelativeTime(oneMinAgo, 5_000));
    expect(result.current).toBe('1 min ago');

    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe('2 min ago');
  });

  it('clears its interval on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useRelativeTime(NOW.toISOString()));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the previous interval and starts a fresh one when the timestamp changes', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ iso }) => useRelativeTime(iso), {
      initialProps: { iso: NOW.toISOString() },
    });
    expect(vi.getTimerCount()).toBe(1);

    rerender({ iso: new Date(NOW.getTime() + 1000).toISOString() });
    expect(vi.getTimerCount()).toBe(1);
  });
});
