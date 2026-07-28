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
