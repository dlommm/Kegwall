import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { WallHeader } from '../../src/web/components/WallHeader';

describe('WallHeader', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the title', () => {
    render(<WallHeader title="The Keg Cave" showClock={false} showTemp={false} tempC={null} units="us" />);
    expect(screen.getByTestId('wall-header-title')).toHaveTextContent('The Keg Cave');
  });

  it('renders an optional logo when logoUrl is provided', () => {
    render(
      <WallHeader
        title="The Keg Cave"
        logoUrl="/logo.png"
        showClock={false}
        showTemp={false}
        tempC={null}
        units="us"
      />,
    );
    expect(screen.getByTestId('wall-header-logo')).toHaveAttribute('src', '/logo.png');
  });

  it('omits the logo element when no logoUrl is given', () => {
    render(<WallHeader title="The Keg Cave" showClock={false} showTemp={false} tempC={null} units="us" />);
    expect(screen.queryByTestId('wall-header-logo')).not.toBeInTheDocument();
  });

  it('hides the clock when showClock is false', () => {
    render(<WallHeader title="x" showClock={false} showTemp={false} tempC={null} units="us" />);
    expect(screen.queryByTestId('wall-header-clock')).not.toBeInTheDocument();
  });

  it('shows and updates the clock every 30s when showClock is true', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T10:00:00'));

    render(<WallHeader title="x" showClock showTemp={false} tempC={null} units="us" />);
    const first = screen.getByTestId('wall-header-clock').textContent;
    expect(first).toBeTruthy();

    act(() => {
      vi.setSystemTime(new Date('2026-07-28T10:05:00'));
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByTestId('wall-header-clock').textContent).not.toBe(first);
  });

  it('hides the temp readout when showTemp is false even with a tempC value', () => {
    render(<WallHeader title="x" showClock={false} showTemp={false} tempC={4} units="us" />);
    expect(screen.queryByTestId('wall-header-temp')).not.toBeInTheDocument();
  });

  it('hides the temp readout when showTemp is true but no tempC is available', () => {
    render(<WallHeader title="x" showClock={false} showTemp tempC={null} units="us" />);
    expect(screen.queryByTestId('wall-header-temp')).not.toBeInTheDocument();
  });

  it('shows the temp readout formatted per units when showTemp is true and tempC is available', () => {
    render(<WallHeader title="x" showClock={false} showTemp tempC={4} units="us" />);
    expect(screen.getByTestId('wall-header-temp')).toHaveTextContent('39°F');
  });

  it('shows the temp readout in Celsius for metric units', () => {
    render(<WallHeader title="x" showClock={false} showTemp tempC={4} units="metric" />);
    expect(screen.getByTestId('wall-header-temp')).toHaveTextContent('4°C');
  });

  it('renders the ticker line when provided', () => {
    render(<WallHeader title="x" showClock={false} showTemp={false} tempC={null} units="us" ticker="Trivia at 7pm" />);
    expect(screen.getByTestId('wall-header-ticker')).toHaveTextContent('Trivia at 7pm');
  });

  it('omits the ticker line when absent', () => {
    render(<WallHeader title="x" showClock={false} showTemp={false} tempC={null} units="us" />);
    expect(screen.queryByTestId('wall-header-ticker')).not.toBeInTheDocument();
  });
});
