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
    nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
    ...overrides,
  };
}

describe('ScreenCare', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children normally with no overlay when stage is "active"', () => {
    render(
      <ScreenCare stage="active" taps={[]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByTestId('screensaver-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('screen-off-overlay')).not.toBeInTheDocument();
  });

  it('drifts the layout by 1px on a 5-minute interval', () => {
    vi.useFakeTimers();
    render(
      <ScreenCare stage="active" taps={[]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    const wrapper = screen.getByTestId('screen-care');
    const initialTransform = wrapper.style.transform;

    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(wrapper.style.transform).not.toBe(initialTransform);
  });

  it('shows the screensaver overlay immediately when stage is "screensaver", with no activation timer', () => {
    render(
      <ScreenCare stage="screensaver" taps={[makeTap(1)]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    expect(screen.getByTestId('screensaver-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('screensaver-overlay')).toHaveTextContent('Taproom');
    expect(screen.queryByTestId('screen-off-overlay')).not.toBeInTheDocument();
  });

  it('shows the off overlay when stage is "off", and nothing else', () => {
    render(
      <ScreenCare stage="off" taps={[]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    expect(screen.getByTestId('screen-off-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('screensaver-overlay')).not.toBeInTheDocument();
  });

  it('calls onWake when the off overlay is tapped', () => {
    const onWake = vi.fn();
    render(
      <ScreenCare stage="off" taps={[]} title="Taproom" onWake={onWake}>
        <p>content</p>
      </ScreenCare>,
    );
    screen.getByTestId('screen-off-overlay').click();
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('tapping the off overlay without an onWake handler does not throw', () => {
    render(
      <ScreenCare stage="off" taps={[]} title="Taproom">
        <p>content</p>
      </ScreenCare>,
    );
    expect(() => screen.getByTestId('screen-off-overlay').click()).not.toThrow();
  });
});
