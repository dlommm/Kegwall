import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBanners } from '../../src/web/lib/useBanners';

describe('useBanners', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with an empty queue', () => {
    const { result } = renderHook(() => useBanners());
    expect(result.current.queue).toEqual([]);
  });

  it('push enqueues a banner defaulting to kind "info"', () => {
    const { result } = renderHook(() => useBanners());
    act(() => result.current.push('Free pours at 6pm'));
    expect(result.current.queue).toEqual([
      { id: expect.any(String), text: 'Free pours at 6pm', kind: 'info' },
    ]);
  });

  it('push accepts an explicit kind', () => {
    const { result } = renderHook(() => useBanners());
    act(() => result.current.push('Kicked: Citra IPA', 'warning'));
    expect(result.current.queue[0]?.kind).toBe('warning');
  });

  it('auto-dismisses the front banner after the hold duration and reveals the next', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBanners(8_000));

    act(() => result.current.push('First'));
    act(() => result.current.push('Second'));
    expect(result.current.queue.map((b) => b.text)).toEqual(['First', 'Second']);

    act(() => { vi.advanceTimersByTime(8_000); });
    expect(result.current.queue.map((b) => b.text)).toEqual(['Second']);

    act(() => { vi.advanceTimersByTime(8_000); });
    expect(result.current.queue).toEqual([]);
  });

  it('dismiss removes a banner immediately regardless of hold timer', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBanners(8_000));

    act(() => result.current.push('First'));
    const id = result.current.queue[0]!.id;
    act(() => result.current.dismiss(id));

    expect(result.current.queue).toEqual([]);
  });

  // Phase 5 Task 4: a server wall_banner action can carry its own durationMs (the plan's
  // `{type:'banner', text, kind, durationMs}` WS message) -- push() accepts an optional
  // per-banner override so a server-specified duration wins over the hook-level default.
  it('push accepts an optional per-banner holdMs override', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBanners(8_000));

    act(() => result.current.push('Short one', 'info', 2_000));
    act(() => { vi.advanceTimersByTime(1_999); });
    expect(result.current.queue).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.queue).toHaveLength(0);
  });

  it('a banner pushed with no override still uses the hook-level default hold', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBanners(8_000));

    act(() => result.current.push('Default hold'));
    act(() => { vi.advanceTimersByTime(7_999); });
    expect(result.current.queue).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.queue).toHaveLength(0);
  });

  it('does not reset the front banner hold timer just because another banner is queued behind it', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBanners(8_000));

    act(() => result.current.push('First'));
    act(() => { vi.advanceTimersByTime(5_000); });
    act(() => result.current.push('Second')); // queued behind — must not restart First's hold

    act(() => { vi.advanceTimersByTime(3_000); }); // First's original 8s elapses here
    expect(result.current.queue.map((b) => b.text)).toEqual(['Second']);
  });
});
