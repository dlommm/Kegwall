import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KegDepletionCards, formatKickDate } from '../../../src/web/routes/admin/KegDepletionCards';
import type { KegBurnStat } from '../../../src/server/db/stats';

function makeKeg(overrides: Partial<KegBurnStat> = {}): KegBurnStat {
  return {
    kegId: 1, beerName: 'Citra IPA', tapNumber: 3, srm: 6, levelPct: 62.5,
    remainingMl: 11875, dailyBurnMl: 950, projectedKickDate: '2026-08-09',
    ...overrides,
  };
}

describe('KegDepletionCards', () => {
  it('renders one card per active keg with the "Kicks around" phrasing', () => {
    render(<KegDepletionCards data={[makeKeg()]} units="metric" />);
    expect(screen.getAllByTestId('keg-depletion-card')).toHaveLength(1);
    expect(screen.getByText('Citra IPA')).toBeInTheDocument();
    expect(screen.getByTestId('keg-depletion-projection')).toHaveTextContent('Kicks around Aug 9');
  });

  it('shows "No recent pours" when projectedKickDate is null', () => {
    render(<KegDepletionCards data={[makeKeg({ projectedKickDate: null, dailyBurnMl: 0 })]} units="metric" />);
    expect(screen.getByTestId('keg-depletion-projection')).toHaveTextContent('No recent pours');
  });

  it('shows an empty state explaining what will appear when no kegs are active', () => {
    render(<KegDepletionCards data={[]} units="metric" />);
    expect(screen.getByTestId('keg-depletion-empty')).toHaveTextContent(/will appear/i);
  });

  it('formats a remaining-volume readout with units', () => {
    render(<KegDepletionCards data={[makeKeg({ remainingMl: 355, levelPct: 50 })]} units="us" />);
    expect(screen.getByText(/12\.0 oz left/)).toBeInTheDocument();
  });

  it('formatKickDate renders a short month/day label from a YYYY-MM-DD string', () => {
    expect(formatKickDate('2026-08-09')).toBe('Aug 9');
    expect(formatKickDate('2026-01-01')).toBe('Jan 1');
  });
});
