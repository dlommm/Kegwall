import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { StatsPage } from '../../../src/web/routes/admin/StatsPage';
import {
  getPoursByDay, getHourHistogram, getActiveKegStats, getBeersByVolume,
  getStatsTemps, getLeaderboard, listMonitors, getKegCosts, getMonthlySpend, getPourHistory,
  getBeerHistory, getPourerHistory, getSensors, getSources, doctorUdpHistory,
  getAnalyticsKpis, getHourHeatmap,
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
  getBeerHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getPourerHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getSensors: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getSources: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  doctorUdpHistory: vi.fn().mockResolvedValue({ ok: true, data: { hours: 24, devices: [] } }),
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
    expect(row).toHaveTextContent('$131'); // paid
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

  it('renders the Beer-history table on the Beers tab', async () => {
    (getBeerHistory as Mock).mockResolvedValue({
      ok: true,
      data: [{ beerId: 1, beerName: 'Citra IPA', firstTap: '2026-06-01T00:00:00Z', kegs: 2, totalMl: 38000, avgRating: 4.3, ratingCount: 12, claimPct: 68 }],
    });
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-beers'));
    const row = screen.getByTestId('beer-history-row');
    expect(row).toHaveTextContent('Citra IPA');
    expect(row).toHaveTextContent('★ 4.3 (12)');
    expect(row).toHaveTextContent('68%');
  });

  it('renders the Pourer-history table on the People tab', async () => {
    (getPourerHistory as Mock).mockResolvedValue({
      ok: true,
      data: [{ drinkerId: 1, displayName: 'Sam', pours: 127, volumeMl: 46000, avgPourMl: 362, avgQuality: 91, favorite: 'Citra IPA', lastPour: '2026-08-01T00:00:00Z' }],
    });
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-people'));
    const row = screen.getByTestId('pourer-history-row');
    expect(row).toHaveTextContent('Sam');
    expect(row).toHaveTextContent('127');
    expect(row).toHaveTextContent('Citra IPA');
  });

  it('renders the Devices tab with ingest sources + UDP coverage from real data', async () => {
    (getSources as Mock).mockResolvedValue({
      ok: true, data: [{ name: 'kegtron_udp', registered: true, healthy: true, detail: 'streaming', lastEventAt: '2026-08-01T00:00:00Z' }],
    });
    (doctorUdpHistory as Mock).mockResolvedValue({
      ok: true, data: { hours: 24, devices: [{ serial: 'KT-9', totalPackets: 8600, firstSeen: 'x', lastSeen: '2026-08-01T00:00:00Z', coveragePct: 99, gaps: [] }] },
    });
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-devices'));
    expect(screen.getByTestId('ingest-source-row')).toHaveTextContent('kegtron_udp');
    const udp = screen.getByTestId('udp-device-row');
    expect(udp).toHaveTextContent('KT-9');
    expect(udp).toHaveTextContent('8,600');
    expect(udp).toHaveTextContent('99%');
  });

  it('renders the Sensor-history table on the Temps tab', async () => {
    (getSensors as Mock).mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: 'Keezer', kind: 'kegtron', tempC: 3, humidity: null, lastSeen: '2026-08-01T00:00:00Z', min7dC: 2, max7dC: 4 }],
    });
    renderAdminPage(<StatsPage />, adminContext('admin', 'metric'));
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-temps'));
    const row = screen.getByTestId('sensor-history-row');
    expect(row).toHaveTextContent('Keezer · KEGTRON');
    expect(row).toHaveTextContent('2°C – 4°C');
  });

  it('offers CSV export chips on the Raw tab, admin-only sets included for admins', async () => {
    (getPourHistory as Mock).mockResolvedValue({
      ok: true, data: [{ id: 1, ts: 'x', tapNumber: 1, beerName: 'A', drinkerName: 'B', volumeMl: 400, quality: 90, source: 'udp' }],
    });
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-raw'));
    expect(screen.getByTestId('raw-export-pour-history')).toHaveTextContent('Pour history · CSV (1)');
    // Admin sees the owner-cost datasets too.
    expect(screen.getByTestId('raw-export-keg-costs')).toBeInTheDocument();
    expect(screen.getByTestId('raw-export-monthly-spend')).toBeInTheDocument();
  });

  it('hides owner-cost CSV export chips from a viewer', async () => {
    renderAdminPage(<StatsPage />, adminContext('viewer'));
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-raw'));
    expect(screen.queryByTestId('raw-export-keg-costs')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-export-pour-history')).toBeInTheDocument();
  });

  it('derives a Highlights list on the Overview tab', async () => {
    (getBeersByVolume as Mock).mockResolvedValue({
      ok: true, data: [{ beerName: 'Citra IPA', srm: 6, volumeMl: 46000, pourCount: 90 }],
    });
    renderAdminPage(<StatsPage />, adminContext('admin', 'metric'));
    await flush();
    expect(screen.getByTestId('analytics-highlights')).toHaveTextContent('Citra IPA poured the most');
  });

  it('shows the admin monthly-spend table on the Kegs tab', async () => {
    (getMonthlySpend as Mock).mockResolvedValue({
      ok: true, data: [{ month: '2026-06', kegs: 3, spendCents: 39000, pricePerPintCents: 131 }],
    });
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('analytics-tab-kegs'));
    const row = screen.getByTestId('monthly-spend-row');
    expect(row).toHaveTextContent('June 2026');
    expect(row).toHaveTextContent('$390');
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

  it('labels the KPI row with the shared range when the switcher matches the KPI window', async () => {
    renderAdminPage(<StatsPage />);
    await flush();
    // Default range 30d: KPIs/heatmap fetched with 30 and labeled as 30.
    expect(getAnalyticsKpis).toHaveBeenCalledWith(30);
    expect(getHourHeatmap).toHaveBeenCalledWith(30);
    expect(screen.getByTestId('analytics-kpis-range')).toHaveTextContent('KPIs · last 30 days');

    fireEvent.click(screen.getByTestId('stats-range-90'));
    await flush();
    expect(getAnalyticsKpis).toHaveBeenCalledWith(90);
    expect(getHourHeatmap).toHaveBeenCalledWith(90);
    expect(screen.getByTestId('analytics-kpis-range')).toHaveTextContent('KPIs · last 90 days');
  });

  it('7d range: KPIs and heatmap follow the switcher to a real 7-day window, matching the charts', async () => {
    renderAdminPage(<StatsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('stats-range-7'));
    await flush();
    // The charts cover 7 days…
    expect(getPoursByDay).toHaveBeenCalledWith(7);
    expect(getBeersByVolume).toHaveBeenCalledWith(7);
    // …and so do the KPI row + heatmap (routes/featurePack.ts's rangeSchema accepts '7';
    // regression: it used to stop at 30, so the 7d switcher silently showed 30-day KPIs).
    expect(getAnalyticsKpis).toHaveBeenCalledWith(7);
    expect(getHourHeatmap).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('analytics-kpis-range')).toHaveTextContent('KPIs · last 7 days');
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
