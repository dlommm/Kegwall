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
  it('renders one row per active keg with its kick day', () => {
    render(<KegDepletionCards data={[makeKeg({ projectedKickDate: '2099-08-09' })]} units="metric" />);
    expect(screen.getAllByTestId('keg-depletion-card')).toHaveLength(1);
    expect(screen.getAllByText('Citra IPA')[0]).toBeInTheDocument();
    expect(screen.getByTestId('keg-depletion-projection')).toHaveTextContent('kicks Aug 9');
  });

  it('ranks a nearly empty keg with no pace first and names it in the lead sentence', () => {
    render(<KegDepletionCards
      data={[
        makeKeg({ kegId: 1, beerName: 'Citra IPA', projectedKickDate: '2099-08-09' }),
        makeKeg({ kegId: 2, beerName: 'Midnight Oats', levelPct: 4, remainingMl: 760, projectedKickDate: null, dailyBurnMl: 0 }),
      ]}
      units="metric"
    />);
    const rows = screen.getAllByTestId('keg-depletion-card');
    expect(rows[0]).toHaveTextContent('Midnight Oats');
    expect(rows[0]).toHaveTextContent('almost out');
    expect(screen.getByTestId('keg-depletion-lead')).toHaveTextContent('Midnight Oats is almost out');
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
    expect(screen.getAllByText(/12\.0 oz left/)[0]).toBeInTheDocument();
  });

  it('formatKickDate renders a short month/day label from a YYYY-MM-DD string', () => {
    expect(formatKickDate('2026-08-09')).toBe('Aug 9');
    expect(formatKickDate('2026-01-01')).toBe('Jan 1');
  });
});
