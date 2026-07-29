import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { StatsPage } from '../../../src/web/routes/admin/StatsPage';
import {
  getPoursByDay, getHourHistogram, getActiveKegStats, getBeersByVolume,
  getStatsTemps, getLeaderboard, listMonitors,
} from '../../../src/web/lib/adminApi';
import type { Monitor } from '../../../src/server/db/monitors';
import { renderAdminPage } from './renderAdminPage';

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
}));

function makeMonitor(id: number, overrides: Partial<Monitor> = {}): Monitor {
  return {
    id, type: 'kegtron_pro', identifier: `dev-${id}`, serial: null, portIndex: 0,
    tapId: null, lastSeen: null, meta: {}, name: null, ...overrides,
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
