import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { KickedHistory } from '../../../src/web/routes/admin/KickedHistory';
import { listKegs } from '../../../src/web/lib/adminApi';
import type { Beer } from '../../../src/server/db/beers';
import type { Keg } from '../../../src/server/db/kegs';

vi.mock('../../../src/web/lib/adminApi', () => ({ listKegs: vi.fn() }));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeBeer(overrides: Partial<Beer> = {}): Beer {
  return {
    id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null,
    srm: 6, description: null, labelImage: null, createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

function makeKeg(overrides: Partial<Keg> = {}): Keg {
  return {
    id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 19000,
    dateTapped: null, status: 'kicked', createdAt: '2026-07-28T00:00:00.000Z', ...overrides,
  };
}

describe('KickedHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is collapsed by default and does not fetch anything until expanded', async () => {
    render(<KickedHistory tapId={1} beers={[]} units="us" refreshKey={0} />);
    expect(screen.getByTestId('kicked-history-toggle')).toHaveTextContent('Show kicked history');
    expect(screen.queryByTestId('kicked-history-list')).not.toBeInTheDocument();
    await flush();
    expect(listKegs).not.toHaveBeenCalled();
  });

  it('expanding fetches kicked kegs, filters to this tap, and caps at 5', async () => {
    const allKicked: Keg[] = [
      ...Array.from({ length: 3 }, (_, i) => makeKeg({ id: i + 1, tapId: 1 })),
      makeKeg({ id: 99, tapId: 2 }), // other tap, must be excluded
      ...Array.from({ length: 4 }, (_, i) => makeKeg({ id: i + 10, tapId: 1 })),
    ];
    (listKegs as Mock).mockResolvedValue({ ok: true, data: allKicked });
    render(<KickedHistory tapId={1} beers={[makeBeer()]} units="us" refreshKey={0} />);
    fireEvent.click(screen.getByTestId('kicked-history-toggle'));
    await flush();
    expect(listKegs).toHaveBeenCalledWith({ status: 'kicked' });
    expect(screen.getAllByTestId('kicked-history-row')).toHaveLength(5);
    expect(screen.getByTestId('kicked-history-toggle')).toHaveTextContent('Hide kicked history');
  });

  it('shows the beer name and formatted size per row', async () => {
    (listKegs as Mock).mockResolvedValue({
      ok: true, data: [makeKeg({ id: 1, tapId: 1, beerId: 1, sizeMl: 19000 })],
    });
    render(
      <KickedHistory tapId={1} beers={[makeBeer({ id: 1, name: 'Stout' })]} units="metric" refreshKey={0} />,
    );
    fireEvent.click(screen.getByTestId('kicked-history-toggle'));
    const row = await screen.findByTestId('kicked-history-row');
    expect(row).toHaveTextContent('Stout');
    expect(row).toHaveTextContent('19000 mL');
  });

  it('shows a quiet empty state when this tap has no kicked history', async () => {
    (listKegs as Mock).mockResolvedValue({ ok: true, data: [] });
    render(<KickedHistory tapId={1} beers={[]} units="us" refreshKey={0} />);
    fireEvent.click(screen.getByTestId('kicked-history-toggle'));
    expect(await screen.findByTestId('kicked-history-empty')).toHaveTextContent('No kicked kegs yet.');
  });

  it('collapsing hides the list again without refetching on re-expand', async () => {
    (listKegs as Mock).mockResolvedValue({ ok: true, data: [] });
    render(<KickedHistory tapId={1} beers={[]} units="us" refreshKey={0} />);
    fireEvent.click(screen.getByTestId('kicked-history-toggle'));
    await flush();
    fireEvent.click(screen.getByTestId('kicked-history-toggle'));
    expect(screen.queryByTestId('kicked-history-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('kicked-history-toggle')).toHaveTextContent('Show kicked history');
  });
});
