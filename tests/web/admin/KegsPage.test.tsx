import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { KegsPage } from '../../../src/web/routes/admin/KegsPage';
import { listKegHistory, listSuppliers, updateKeg } from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listKegHistory: vi.fn(),
  listSuppliers: vi.fn(),
  updateKeg: vi.fn(),
}));

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

const KEG = {
  id: 5, status: 'on_tap' as const, beerId: 1, beerName: 'Amber', tapId: 2, tapNumber: 2, tapName: null,
  sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: '2026-08-01', kegType: null,
  costCents: null, depositCents: null, supplierId: null, supplierName: null, purchasedAt: null, createdAt: '2026-08-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  (listKegHistory as Mock).mockResolvedValue({ ok: true, data: [KEG] });
  (listSuppliers as Mock).mockResolvedValue({ ok: true, data: [{ id: 9, name: 'Craft Dist.' }] });
  (updateKeg as Mock).mockResolvedValue({ ok: true, data: {} });
});

describe('KegsPage', () => {
  it('lists kegs and adds a supplier + cost to a keg after the fact', async () => {
    render(<KegsPage />);
    await flush();
    expect(screen.getByTestId('keg-row-5')).toBeInTheDocument();
    expect(screen.getByTestId('keg-supplier-5')).toHaveTextContent('—');

    fireEvent.click(screen.getByTestId('keg-edit-5'));
    fireEvent.change(screen.getByTestId('keg-edit-cost-5'), { target: { value: '131.00' } });
    fireEvent.change(screen.getByTestId('keg-edit-supplier-5'), { target: { value: '9' } });
    await act(async () => { fireEvent.click(screen.getByTestId('keg-save-5')); });
    await flush();

    expect(updateKeg).toHaveBeenCalledWith(5, expect.objectContaining({ supplierId: 9, costCents: 13100 }));
  });

  it('filters by status (an on-tap keg is hidden under the Kicked filter)', async () => {
    render(<KegsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('kegs-filter-kicked'));
    expect(screen.getByTestId('kegs-empty')).toBeInTheDocument();
  });
});
