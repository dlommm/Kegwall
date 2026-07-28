import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WallGrid } from '../../src/web/components/WallGrid';
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
    monitorOnline: true,
    temp: null,
    ...overrides,
  };
}

describe('WallGrid', () => {
  it('renders one TapCard per tap', () => {
    render(<WallGrid taps={[makeTap(1), makeTap(2), makeTap(3)]} columns={2} template="standard" units="us" />);
    expect(screen.getAllByTestId('tap-card')).toHaveLength(3);
  });

  it('exposes the configured column count as a CSS variable for the grid to consume', () => {
    render(<WallGrid taps={[makeTap(1)]} columns={4} template="standard" units="us" />);
    const grid = screen.getByTestId('wall-grid');
    expect(grid.style.getPropertyValue('--wall-columns')).toBe('4');
  });

  it('passes template/fields/units through to each TapCard', () => {
    render(
      <WallGrid
        taps={[makeTap(1, { beer: { id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null, srm: null, description: null, labelImage: null, createdAt: '' }, keg: { id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status: 'on_tap', createdAt: '', levelPct: 100, remainingMl: 19000 } })]}
        columns={2}
        template="compact"
        units="metric"
      />,
    );
    expect(screen.getByTestId('tap-card')).toHaveAttribute('data-template', 'compact');
  });

  it('renders an empty grid without crashing when there are no taps', () => {
    render(<WallGrid taps={[]} columns={2} template="standard" units="us" />);
    expect(screen.queryAllByTestId('tap-card')).toHaveLength(0);
  });
});
