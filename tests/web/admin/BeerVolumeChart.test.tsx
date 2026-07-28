import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BeerVolumeChart, formatBeerTooltip } from '../../../src/web/routes/admin/BeerVolumeChart';
import { srmToColor } from '../../../src/web/lib/srm';
import type { BeerVolumeStat } from '../../../src/server/db/stats';

function makeData(): BeerVolumeStat[] {
  return [
    { beerName: 'Stout', srm: 35, volumeMl: 900, pourCount: 3 },
    { beerName: 'IPA', srm: 8, volumeMl: 600, pourCount: 2 },
  ];
}

describe('BeerVolumeChart', () => {
  it('renders one horizontal bar per beer, tinted by that beer\'s SRM color', () => {
    const { container } = render(<BeerVolumeChart data={makeData()} units="metric" />);
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('fill', srmToColor(35).liquid);
    expect(bars[1]).toHaveAttribute('fill', srmToColor(8).liquid);
  });

  it('shows an empty state explaining what will appear when there is no volume data', () => {
    render(<BeerVolumeChart data={[]} units="metric" />);
    expect(screen.getByTestId('beer-volume-empty')).toHaveTextContent(/will appear/i);
  });

  it('formats the tooltip with exact volume (with units) and pour count', () => {
    expect(formatBeerTooltip({ beerName: 'IPA', srm: 8, volumeMl: 600, pourCount: 2 }, 'metric'))
      .toBe('600 mL · 2 pours');
  });
});
