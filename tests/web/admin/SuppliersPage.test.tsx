import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { SuppliersPage } from '../../../src/web/routes/admin/SuppliersPage';
import {
  listSuppliers, getSupplierStats, getSupplierPriceBook, createSupplier, deleteSupplier,
} from '../../../src/web/lib/adminApi';
import type { Supplier, PriceBookEntry } from '../../../src/web/lib/adminApi';
import { renderAdminPage } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listSuppliers: vi.fn(),
  getSupplierStats: vi.fn(),
  getSupplierPriceBook: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  deleteSupplier: vi.fn(),
}));

const NINE_TO_FIVE = { open: '09:00', close: '17:00' };
const EMPTY_DAYS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

function supplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 1, name: 'Joes Distributing', contactName: 'Pat', phone: '555-1', email: null,
    address: null, hours: null, deliveryNotes: 'Tuesdays', notes: null, createdAt: '', ...over,
  };
}

function entry(over: Partial<PriceBookEntry> = {}): PriceBookEntry {
  return {
    beerId: 1, beerName: 'Yuengling', sizeMl: 58674, lastPaidCents: 8000,
    lastPurchasedAt: '2026-06-01', isBestKnown: true, bestElsewhereCents: null, bestElsewhereSupplierName: null, ...over,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (listSuppliers as Mock).mockResolvedValue({ ok: true, data: [] });
  (getSupplierStats as Mock).mockResolvedValue({ ok: true, data: { supplierCount: 0, kegsPurchased: 0, ytdSpendCents: 0 } });
  (getSupplierPriceBook as Mock).mockResolvedValue({ ok: true, data: [] });
  (createSupplier as Mock).mockResolvedValue({ ok: true, data: supplier() });
  (deleteSupplier as Mock).mockResolvedValue({ ok: true, data: null });
});

describe('SuppliersPage', () => {
  it('shows header stats with YTD spend in dollars', async () => {
    (getSupplierStats as Mock).mockResolvedValue({ ok: true, data: { supplierCount: 3, kegsPurchased: 11, ytdSpendCents: 168400 } });
    renderAdminPage(<SuppliersPage />);
    expect(await screen.findByTestId('suppliers-summary')).toHaveTextContent('3 suppliers · 11 kegs purchased · $1,684 this year');
  });

  it('renders a supplier card with contact block, price book, and a best-price star', async () => {
    (listSuppliers as Mock).mockResolvedValue({ ok: true, data: [supplier()] });
    (getSupplierPriceBook as Mock).mockResolvedValue({
      ok: true,
      data: [entry({ isBestKnown: true, bestElsewhereCents: 8500, bestElsewhereSupplierName: 'Johns' })],
    });
    renderAdminPage(<SuppliersPage />);
    const card = await screen.findByTestId('supplier-card');
    expect(card).toHaveTextContent('Joes Distributing');
    expect(card).toHaveTextContent('Tuesdays');
    const row = screen.getByTestId('supplier-pricebook-row');
    expect(row).toHaveTextContent('Yuengling');
    expect(row).toHaveTextContent('★ $80.00');
    expect(row).toHaveTextContent('Johns: $85.00');
    expect(screen.getByTestId('supplier-badge-best')).toHaveTextContent('Best price on 1');
  });

  it('flags an only-source beer with the ONLY SOURCE badge', async () => {
    (listSuppliers as Mock).mockResolvedValue({ ok: true, data: [supplier()] });
    (getSupplierPriceBook as Mock).mockResolvedValue({ ok: true, data: [entry({ bestElsewhereCents: null })] });
    renderAdminPage(<SuppliersPage />);
    expect(await screen.findByTestId('supplier-badge-only')).toHaveTextContent('Only source for 1');
  });

  it('adds a supplier through the form', async () => {
    renderAdminPage(<SuppliersPage />);
    await flush();
    fireEvent.click(screen.getByTestId('suppliers-add-button'));
    fireEvent.change(screen.getByTestId('supplier-form-name'), { target: { value: 'New Bev' } });
    fireEvent.click(screen.getByTestId('supplier-form-save'));
    await flush();
    expect(createSupplier).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Bev' }));
  });

  it('shows an empty state when there are no suppliers', async () => {
    renderAdminPage(<SuppliersPage />);
    expect(await screen.findByTestId('suppliers-empty')).toBeInTheDocument();
  });

  it('shows a card’s weekly hours as compressed runs plus its note', async () => {
    (listSuppliers as Mock).mockResolvedValue({
      ok: true,
      data: [supplier({
        hours: {
          note: 'call ahead',
          days: {
            mon: NINE_TO_FIVE, tue: NINE_TO_FIVE, wed: NINE_TO_FIVE, thu: NINE_TO_FIVE,
            fri: NINE_TO_FIVE, sat: null, sun: null,
          },
        },
      })],
    });
    renderAdminPage(<SuppliersPage />);
    const hours = await screen.findByTestId('supplier-card-hours');
    expect(hours).toHaveTextContent('Mon–Fri');
    expect(hours).toHaveTextContent('9 AM–5 PM');
    expect(hours).toHaveTextContent('Sat–Sun');
    expect(hours).toHaveTextContent('call ahead');
    expect(screen.getByTestId('supplier-open-badge')).toBeInTheDocument();
  });

  it('shows no open/closed badge for a legacy note-only supplier', async () => {
    (listSuppliers as Mock).mockResolvedValue({
      ok: true,
      data: [supplier({ hours: { note: 'Mon-Fri 9-5', days: EMPTY_DAYS } })],
    });
    renderAdminPage(<SuppliersPage />);
    expect(await screen.findByTestId('supplier-card-hours')).toHaveTextContent('Mon-Fri 9-5');
    expect(screen.queryByTestId('supplier-open-badge')).not.toBeInTheDocument();
  });

  it('submits the weekly grid’s hours, with "Copy to all" stamping one day across the week', async () => {
    renderAdminPage(<SuppliersPage />);
    await flush();
    fireEvent.click(screen.getByTestId('suppliers-add-button'));
    fireEvent.change(screen.getByTestId('supplier-form-name'), { target: { value: 'New Bev' } });
    fireEvent.click(screen.getByTestId('supplier-hours-open-mon'));
    fireEvent.change(screen.getByTestId('supplier-hours-to-mon'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByTestId('supplier-hours-copy-mon'));
    fireEvent.change(screen.getByTestId('supplier-hours-note'), { target: { value: 'call ahead' } });
    fireEvent.click(screen.getByTestId('supplier-form-save'));
    await flush();
    expect(createSupplier).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New Bev',
      hours: {
        note: 'call ahead',
        days: {
          mon: { open: '09:00', close: '18:00' }, tue: { open: '09:00', close: '18:00' },
          wed: { open: '09:00', close: '18:00' }, thu: { open: '09:00', close: '18:00' },
          fri: { open: '09:00', close: '18:00' }, sat: { open: '09:00', close: '18:00' },
          sun: { open: '09:00', close: '18:00' },
        },
      },
    }));
  });

  it('prefills the hours grid when editing a supplier that already has hours', async () => {
    (listSuppliers as Mock).mockResolvedValue({
      ok: true,
      data: [supplier({ hours: { note: null, days: { ...EMPTY_DAYS, wed: NINE_TO_FIVE } } })],
    });
    renderAdminPage(<SuppliersPage />);
    fireEvent.click(await screen.findByTestId('supplier-edit'));
    expect(screen.getByTestId('supplier-hours-open-wed')).toBeChecked();
    expect(screen.getByTestId('supplier-hours-from-wed')).toHaveValue('09:00');
    expect(screen.getByTestId('supplier-hours-open-thu')).not.toBeChecked();
  });
});
