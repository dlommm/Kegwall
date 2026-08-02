import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { StatsPage } from '../../../src/web/routes/admin/StatsPage';
import {
  getPoursByDay, getHourHistogram, getActiveKegStats, getBeersByVolume,
  getStatsTemps, getLeaderboard, listMonitors, getKegCosts, getMonthlySpend, getPourHistory,
} from '../../../src/web/lib/adminApi';
import type { Monitor } from '../../../src/server/db/monitors';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  getPoursByDay: vi.fn(),
  getHourHistogram: vi.fn(),
  getActiveKegStats: vi.fn(),
  getBeersByVolume: vi.fn(),
  getStatsTemps: vi.fn(),
  getLeaderboard: vi.fn(),
  listMonitors: vi.fn(),
  getAnalyticsKpis: vi.fn().mockResolvedValue({ ok: true, data: { pours: 0, volumeMl: 0, kegsKicked: 0, avgQuality: null, costPerPintCents: null, valueOnTapCents: 0 } }),
  getHourHeatmap: vi.fn().mockResolvedValue({ ok: true, data: { grid: [] } }),
  getHostStatsHistory: vi.fn().mockResolvedValue({ ok: true, data: { points: [] } }),
  getKegCosts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getMonthlySpend: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getPourHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));

function makeMonitor(id: number, overrides: Partial<Monitor> = {}): Monitor {
  return {
    id, type: 'kegtron_pro', identifier: `dev-${id}`, serial: null, portIndex: 0,
    tapId: null, lastSeen: null, meta: {}, name: null, enabled: true, ...overrides,
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
  (getPoursByDay as Mock).mockResolvedValue({ ok: true, data: [] });
  (getHourHistogram as Mock).mockResolvedValue({ ok: true, data: [] });
  (getActiveKegStats as Mock).mockResolvedValue({ ok: true, data: [] });
  (getBeersByVolume as Mock).mockResolvedValue({ ok: true, data: [] });
  (getStatsTemps as Mock).mockResolvedValue({ ok: true, data: [] });
  (getLeaderboard as Mock).mockResolvedValue({ ok: true, data: [] });
  (listMonitors as Mock).mockResolvedValue({ ok: true, data: [] });
});

describe('StatsPage', () => {
  it('loads every stats endpoint on mount and renders the page once loaded', async () => {
    renderAdminPage(<StatsPage />);
    await flush();
    expect(getPoursByDay).toHaveBeenCalledWith(30);
    expect(getBeersByVolume).toHaveBeenCalledWith(30);
    expect(getHourHistogram).toHaveBeenCalled();
    expect(getActiveKegStats).toHaveBeenCalled();
    expect(getLeaderboard).toHaveBeenCalledWith('week');
    expect(screen.getByTestId('admin-stats-page')).toBeInTheDocument();
  });

  it('shows a loading state before the initial fetches settle', () => {
    renderAdminPage(<StatsPage />);
    expect(screen.getByTestId('stats-loading')).toBeInTheDocument();
  });

  it('shows the admin keg-cost table on the Kegs tab, with $/pint and value-left', async () => {
    (getKegCosts as Mock).mockResolvedValue({
      ok: true,
      data: [{
        kegId: 1, beerName: 'Yuengling', supplierName: 'Joes', status: 'on_tap',
        costCents: 13100, depositCents: 3000, sizeMl: 47318, volStartMl: 47318, volDispensedMl: 23659,
        purchasedAt: '2026-06-01', dateTapped: '2026-06-02', pouredPct: 50, pricePerPintCents: 131, valueLeftCents: 6550,
      }],
    });
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-kegs'));
    const row = screen.getByTestId('keg-cost-row');
    expect(row).toHaveTextContent('Yuengling');
    expect(row).toHaveTextContent('Joes');
    expect(row).toHaveTextContent('$131.00'); // paid
    expect(row).toHaveTextContent('$1.31'); // $/pint
    expect(row).toHaveTextContent('50%');
    expect(row).toHaveTextContent('$65.50'); // value left
  });

  it('hides the keg-cost + monthly-spend tables from a non-admin (viewer)', async () => {
    renderAdminPage(<StatsPage />, adminContext('viewer'));
    await flush();
    expect(getKegCosts).not.toHaveBeenCalled();
    expect(getMonthlySpend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('analytics-keg-costs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analytics-monthly-spend')).not.toBeInTheDocument();
  });

  it('renders the Pours-history table on the Pours tab and refetches with the range', async () => {
    (getPourHistory as Mock).mockResolvedValue({
      ok: true,
      data: [{
        id: 1, ts: '2026-08-01T18:00:00.000Z', tapNumber: 3, beerName: 'Citra IPA', drinkerName: 'Sam', volumeMl: 473, quality: 92, source: 'udp',
      }],
    });
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-pours'));
    const row = screen.getByTestId('pour-history-row');
    expect(row).toHaveTextContent('Citra IPA');
    expect(row).toHaveTextContent('Tap 3');
    expect(row).toHaveTextContent('Sam');
    expect(row).toHaveTextContent('UDP');
    // Range switcher refetches pour history too.
    fireEvent.click(screen.getByTestId('stats-range-90'));
    await flush();
    expect(getPourHistory).toHaveBeenCalledWith(90);
  });

  it('shows the admin monthly-spend table on the Kegs tab', async () => {
    (getMonthlySpend as Mock).mockResolvedValue({
      ok: true, data: [{ month: '2026-06', kegs: 3, spendCents: 39000, pricePerPintCents: 131 }],
    });
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-kegs'));
    const row = screen.getByTestId('monthly-spend-row');
    expect(row).toHaveTextContent('2026-06');
    expect(row).toHaveTextContent('$390.00');
    expect(row).toHaveTextContent('$1.31');
  });

  it('renders the 9-tab hub with Overview active, and switching tabs reveals another panel', async () => {
    renderAdminPage(<StatsPage />);
    await flush();
    expect(screen.getByTestId('analytics-tabs')).toBeInTheDocument();
    // Overview visible, Kegs & cost hidden by default.
    expect(screen.getByTestId('analytics-panel-overview')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('analytics-panel-kegs')).toHaveAttribute('hidden');
    fireEvent.click(screen.getByTestId('analytics-tab-kegs'));
    expect(screen.getByTestId('analytics-panel-kegs')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('analytics-panel-overview')).toHaveAttribute('hidden');
    expect(screen.getByTestId('analytics-tab-kegs')).toHaveAttribute('aria-selected', 'true');
  });

  it('the range switcher refetches pours and beers with the new days value for both', async () => {
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('stats-range-90'));
    await flush();
    expect(getPoursByDay).toHaveBeenCalledWith(90);
    expect(getBeersByVolume).toHaveBeenCalledWith(90);
  });

  it('the leaderboard window switcher refetches the leaderboard', async () => {
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('leaderboard-window-all'));
    await flush();
    expect(getLeaderboard).toHaveBeenCalledWith('all');
  });

  it('auto-selects the first Kegtron Pro monitor and fetches its temps, ignoring Gen 1 monitors', async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true,
      data: [
        makeMonitor(1, { type: 'kegtron_gen1' }),
        makeMonitor(2, { type: 'kegtron_pro' }),
      ],
    });
    renderAdminPage(<StatsPage />);
    await flush();
    expect(getStatsTemps).toHaveBeenCalledWith(2);
  });

  it('never calls getStatsTemps when there is no Kegtron Pro monitor', async () => {
    renderAdminPage(<StatsPage />);
    await flush();
    expect(getStatsTemps).not.toHaveBeenCalled();
    expect(screen.getByTestId('temp-chart-empty')).toBeInTheDocument();
  });
});
