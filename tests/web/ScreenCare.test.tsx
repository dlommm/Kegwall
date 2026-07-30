import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ScreenCare } from '../../src/web/components/ScreenCare';
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

const DISABLED = { enabled: false, startAfterMinutes: 10 };

describe('ScreenCare', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children normally with no screensaver overlay by default', () => {
    render(
      <ScreenCare screensaver={DISABLED} taps={[]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByTestId('screensaver-overlay')).not.toBeInTheDocument();
  });

  it('drifts the layout by 1px on a 5-minute interval', () => {
    vi.useFakeTimers();
    render(
      <ScreenCare screensaver={DISABLED} taps={[]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    const wrapper = screen.getByTestId('screen-care');
    const initialTransform = wrapper.style.transform;

    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(wrapper.style.transform).not.toBe(initialTransform);
  });

  it('never activates the screensaver when disabled, even after a long wait', () => {
    vi.useFakeTimers();
    render(
      <ScreenCare screensaver={DISABLED} taps={[]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    act(() => { vi.advanceTimersByTime(60 * 60_000); });
    expect(screen.queryByTestId('screensaver-overlay')).not.toBeInTheDocument();
  });

  it('activates the screensaver startAfterMinutes after mount when enabled', () => {
    vi.useFakeTimers();
    render(
      <ScreenCare screensaver={{ enabled: true, startAfterMinutes: 10 }} taps={[makeTap(1)]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    expect(screen.queryByTestId('screensaver-overlay')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(screen.getByTestId('screensaver-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('screensaver-overlay')).toHaveTextContent('Taproom');
  });
});
