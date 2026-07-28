import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HourHistogramRow, formatHourLabel } from '../../../src/web/routes/admin/HourHistogramRow';
import type { HourHistogram } from '../../../src/server/db/stats';

function makeData(): HourHistogram[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour === 18 ? 4 : 0 }));
}

describe('HourHistogramRow', () => {
  it('renders one bar per hour that has at least one pour', () => {
    // Recharts skips zero-height bars entirely (see node_modules/recharts/es6/cartesian/
    // Bar.js's "Filter out 0-dimension rectangles" comment) — every entry but hour 18 is
    // zero here, so exactly one bar renders even though all 24 hours are in the data.
    const { container } = render(<HourHistogramRow data={makeData()} />);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(1);
  });

  it('renders one bar for every hour when every hour has pours', () => {
    const allNonZero: HourHistogram[] = Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour + 1 }));
    const { container } = render(<HourHistogramRow data={allNonZero} />);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(24);
  });

  it('shows an empty state explaining what will appear when every hour is zero', () => {
    const zeroed: HourHistogram[] = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    render(<HourHistogramRow data={zeroed} />);
    expect(screen.getByTestId('hour-histogram-empty')).toHaveTextContent(/will appear/i);
  });

  it('does not show the empty state once at least one hour has pours', () => {
    render(<HourHistogramRow data={makeData()} />);
    expect(screen.queryByTestId('hour-histogram-empty')).not.toBeInTheDocument();
  });

  it('formats hour labels as 12-hour clock shorthand', () => {
    expect(formatHourLabel(0)).toBe('12a');
    expect(formatHourLabel(9)).toBe('9a');
    expect(formatHourLabel(12)).toBe('12p');
    expect(formatHourLabel(18)).toBe('6p');
    expect(formatHourLabel(23)).toBe('11p');
  });
});
