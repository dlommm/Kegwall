import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PoursChart, formatPoursTooltip } from '../../../src/web/routes/admin/PoursChart';
import type { PoursByDay } from '../../../src/server/db/stats';

function makeData(): PoursByDay[] {
  return [
    { date: '2026-07-25', count: 0, volumeMl: 0 },
    { date: '2026-07-26', count: 3, volumeMl: 900 },
    { date: '2026-07-27', count: 5, volumeMl: 1500 },
  ];
}

describe('PoursChart', () => {
  it('renders one bar per day that has at least one pour', () => {
    // Recharts skips zero-height bars entirely (see node_modules/recharts/es6/cartesian/
    // Bar.js's "Filter out 0-dimension rectangles" comment) — 2026-07-25's count is 0
    // here, so only the other two days render a bar even though all three are in the data.
    const { container } = render(<PoursChart data={makeData()} units="metric" />);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
  });

  it('shows an empty state explaining what will appear when there are no pours at all', () => {
    const zeroed: PoursByDay[] = [
      { date: '2026-07-26', count: 0, volumeMl: 0 },
      { date: '2026-07-27', count: 0, volumeMl: 0 },
    ];
    render(<PoursChart data={zeroed} units="metric" />);
    expect(screen.getByTestId('pours-chart-empty')).toHaveTextContent(/pour/i);
    expect(screen.queryByTestId('pours-chart-empty')).toHaveTextContent(/will appear/i);
  });

  it('does not show the empty state once at least one pour exists', () => {
    render(<PoursChart data={makeData()} units="metric" />);
    expect(screen.queryByTestId('pours-chart-empty')).not.toBeInTheDocument();
  });

  it('formats the tooltip with an exact count and volume including units', () => {
    expect(formatPoursTooltip({ date: '2026-07-27', count: 1, volumeMl: 355 }, 'metric'))
      .toBe('1 pour · 355 mL');
    expect(formatPoursTooltip({ date: '2026-07-27', count: 5, volumeMl: 1500 }, 'us'))
      .toBe('5 pours · 50.7 oz');
  });
});
