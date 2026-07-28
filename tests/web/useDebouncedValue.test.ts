import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from '../../src/web/lib/useDebouncedValue';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 300));
    expect(result.current).toBe('a');
  });

  it('does not update until the delay has elapsed', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe('a');
  });

  it('updates once the delay elapses', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('ab');
  });

  it('resets the timer on each change within the window, committing only the final value', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ value: 'abc' });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('a'); // 400ms total elapsed, but only 200ms since the last change
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe('abc');
  });
});
