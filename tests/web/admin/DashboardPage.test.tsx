import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, screen } from '@testing-library/react';
import { DashboardPage } from '../../../src/web/routes/admin/DashboardPage';
import { getMenu } from '../../../src/web/lib/api';
import { useTapStates } from '../../../src/web/lib/useTapStates';
import {
  getActivity, getSources, getPoursSince, getSystemStats, listWalls, triggerReboot,
  getCleaningStatuses, getPoursByDay, getActiveKegStats, getSensors, type SystemStats,
} from '../../../src/web/lib/adminApi';
import type { TapState } from '../../../src/server/core/state';
import type { SourceStatus } from '../../../src/server/ingest/manager';
import type { ActivityEvent } from '../../../src/server/db/activity';
import type { Pour } from '../../../src/server/db/kegs';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/api', () => ({ getMenu: vi.fn() }));
vi.mock('../../../src/web/lib/useTapStates', () => ({ useTapStates: vi.fn() }));
vi.mock('../../../src/web/lib/adminApi', () => ({
  getActivity: vi.fn(),
  getSources: vi.fn(),
  getPoursSince: vi.fn(),
  getSystemStats: vi.fn(),
  listWalls: vi.fn(),
  triggerReboot: vi.fn(),
  getCleaningStatuses: vi.fn(),
  getPoursByDay: vi.fn(),
  getActiveKegStats: vi.fn(),
  getSensors: vi.fn(),
}));

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
    monitorOnline: true, hidden: false,
    temp: null,
    avgRating: null,
    nextUpBeerName: null,
    ...overrides,
  };
}

function makeSource(overrides: Partial<SourceStatus> = {}): SourceStatus {
  return {
    name: 'kegtron_udp', registered: true, healthy: true, detail: '', lastEventAt: null, ...overrides,
  };
}

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    ts: '2026-07-28T11:55:00.000Z', kind: 'pour', beerName: 'Citra IPA',
    tapNumber: 3, volumeMl: 473, ...overrides,
  };
}

function makePour(overrides: Partial<Pour> = {}): Pour {
  return {
    id: 1, kegId: 1, ts: '2026-07-28T11:00:00.000Z', volumeMl: 500,
    durationMs: null, source: 'udp', drinkerId: null, quality: null, rating: null, ratingTags: null, ...overrides,
  };
}

function makeStats(overrides: Partial<SystemStats> = {}): SystemStats {
  return {
    cpu: { loadPct: 12, cores: 4 },
    memory: { totalBytes: 8 * 1024 ** 3, availableBytes: 6 * 1024 ** 3, usedPct: 25 },
    disk: { totalBytes: 64 * 1024 ** 3, availableBytes: 32 * 1024 ** 3, usedPct: 50 },
    uptimeSec: 3600,
    cpuTempC: null,
    throttle: null,
    watts: null,
    rebootRequired: false,
    osManaged: false,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMenu as Mock).mockResolvedValue({ ok: true, data: { siteName: 'X', taps: [], units: 'us' } });
    (useTapStates as Mock).mockReturnValue({ taps: [], stale: false, connected: true, reconnectCount: 0 });
    (getActivity as Mock).mockResolvedValue({ ok: true, data: [] });
    (getSources as Mock).mockResolvedValue({ ok: true, data: [] });
    (getPoursSince as Mock).mockResolvedValue({ ok: true, data: [] });
    (getSystemStats as Mock).mockResolvedValue({ ok: true, data: makeStats() });
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [{ id: 1, slug: 'main', name: 'Main', config: {} }] });
    (triggerReboot as Mock).mockResolvedValue({ ok: true, data: { message: 'Rebooting' } });
    (getCleaningStatuses as Mock).mockResolvedValue({ ok: true, data: [] });
    (getPoursByDay as Mock).mockResolvedValue({ ok: true, data: [] });
    (getActiveKegStats as Mock).mockResolvedValue({ ok: true, data: [] });
    (getSensors as Mock).mockResolvedValue({ ok: true, data: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders one tap pill per tap, with level percent and beer name, from fixtures', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [
        makeTap(1, {
          tapNumber: 1,
          beer: {
            id: 1, name: 'Citra IPA', brewery: null, style: null, abv: null, ibu: null, srm: 6, description: null, labelImage: null, createdAt: '',
          },
          keg: {
            id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 4000, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 80, remainingMl: 15000,
          },
        }),
        makeTap(2),
      ],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<DashboardPage />);
    const pills = await screen.findAllByTestId('dashboard-tap-pill');
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent('Citra IPA');
    expect(pills[0]).toHaveTextContent('80%');
    expect(pills[1]).toHaveTextContent('Empty');
  });

  it('shows a kicked tap with a "Kicked" label instead of a level percent', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [
        makeTap(1, {
          beer: {
            id: 1, name: 'Stout', brewery: null, style: null, abv: null, ibu: null, srm: 35, description: null, labelImage: null, createdAt: '',
          },
          keg: {
            id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 19000, dateTapped: null, status: 'kicked', createdAt: '', kegType: null, costCents: null, levelPct: 0, remainingMl: 0,
          },
        }),
      ],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<DashboardPage />);
    const pill = await screen.findByTestId('dashboard-tap-pill');
    expect(pill).toHaveAttribute('data-kicked', 'true');
    expect(pill).toHaveTextContent('Kicked');
  });

  it('shows a quiet empty state when there are no taps', async () => {
    renderAdminPage(<DashboardPage />);
    expect(await screen.findByTestId('dashboard-card-taps')).toHaveTextContent('No taps set up yet.');
  });

  it("shows today's pour count and total volume in display units", async () => {
    (getPoursSince as Mock).mockResolvedValue({
      ok: true, data: [makePour({ volumeMl: 500 }), makePour({ id: 2, volumeMl: 500 })],
    });
    renderAdminPage(<DashboardPage />, adminContext('admin', 'metric'));
    expect(await screen.findByTestId('dashboard-pour-count')).toHaveTextContent('2');
    expect(screen.getByTestId('dashboard-pour-volume')).toHaveTextContent('1000 mL');
  });

  it('shows the On tap stat card with almost-gone/kicked counts', async () => {
    renderAdminPage(<DashboardPage />);
    expect(await screen.findByTestId('dashboard-card-on-tap')).toHaveTextContent('ON TAP');
    expect(screen.getByTestId('dashboard-on-tap-note')).toHaveTextContent('0 almost gone · 0 kicked');
  });

  it('renders a healthy, an unhealthy, and an unconfigured source badge distinctly', async () => {
    (getSources as Mock).mockResolvedValue({
      ok: true,
      data: [
        makeSource({ name: 'kegtron_cloud', registered: true, healthy: true, detail: 'polling ok' }),
        makeSource({ name: 'kegtron_udp', registered: true, healthy: false, detail: 'no packets' }),
        makeSource({ name: 'gen1_ble', registered: false, healthy: false, detail: '' }),
      ],
    });
    renderAdminPage(<DashboardPage />);
    const rows = await screen.findAllByTestId('dashboard-source-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('OK');
    expect(rows[1]).toHaveTextContent('Down');
    expect(rows[2]).toHaveTextContent('Not set up');
  });

  it('shows a relative lastEventAt for a source, and "No events yet" when null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    (getSources as Mock).mockResolvedValue({
      ok: true,
      data: [
        makeSource({ name: 'kegtron_cloud', lastEventAt: '2026-07-28T11:55:00.000Z' }),
        makeSource({ name: 'kegtron_udp', lastEventAt: null }),
      ],
    });
    renderAdminPage(<DashboardPage />);
    await flush();
    const rows = screen.getAllByTestId('dashboard-source-row');
    expect(rows[0]).toHaveTextContent('5 min ago');
    expect(rows[1]).not.toHaveTextContent('min ago');
  });

  it('fetches the activity feed and renders it as prose, newest-relevant fields first', async () => {
    (getActivity as Mock).mockResolvedValue({
      ok: true,
      data: [
        makeEvent({
          kind: 'pour', beerName: 'Citra IPA', tapNumber: 3, volumeMl: 473, ts: '2026-07-28T11:55:00.000Z',
        }),
        makeEvent({
          kind: 'keg_tapped', beerName: 'Pilsner', tapNumber: 1, volumeMl: null, ts: '2026-07-28T10:00:00.000Z',
        }),
      ],
    });
    renderAdminPage(<DashboardPage />);
    const rows = await screen.findAllByTestId('dashboard-activity-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Poured 16.0 oz of Citra IPA on tap 3');
    expect(rows[1]).toHaveTextContent('Tapped Pilsner on tap 1');
  });

  it('shows a quiet empty state when there is no activity yet', async () => {
    renderAdminPage(<DashboardPage />);
    expect(await screen.findByTestId('dashboard-activity-empty')).toHaveTextContent("Nothing’s happened yet.");
  });

  it('polls sources, activity, and pours every 60s and clears the interval on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = renderAdminPage(<DashboardPage />);

    await flush();
    expect(getSources).toHaveBeenCalledTimes(1);
    expect(getActivity).toHaveBeenCalledTimes(1);
    expect(getPoursSince).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getSources).toHaveBeenCalledTimes(2);
    expect(getActivity).toHaveBeenCalledTimes(2);
    expect(getPoursSince).toHaveBeenCalledTimes(2);

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });
    expect(getSources).toHaveBeenCalledTimes(2);
    expect(getActivity).toHaveBeenCalledTimes(2);
    expect(getPoursSince).toHaveBeenCalledTimes(2);
  });

  it('renders the SERVER HEALTH card with CPU/RAM/disk meter rows, hiding watts when null', async () => {
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-card-server-health')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-server-cpu')).toHaveTextContent('12%');
    expect(screen.getByTestId('dashboard-server-ram')).toHaveTextContent('25%');
    expect(screen.getByTestId('dashboard-server-disk')).toHaveTextContent('50%');
    const note = screen.getByTestId('dashboard-server-note');
    expect(note).toHaveTextContent('CPU 12% · RAM 25% · disk 50%');
    expect(note).not.toHaveTextContent('W');
  });

  it('shows the SoC temp in the header and watts in the note when the host reports them', async () => {
    (getSystemStats as Mock).mockResolvedValue({
      ok: true, data: makeStats({ cpuTempC: 52.3, watts: 6.4 }),
    });
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-server-health-temp')).toHaveTextContent('126');
    expect(screen.getByTestId('dashboard-server-note')).toHaveTextContent('6.4 W');
  });

  it('turns the disk meter amber past 60% capacity', async () => {
    (getSystemStats as Mock).mockResolvedValue({
      ok: true,
      data: makeStats({ disk: { totalBytes: 64 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, usedPct: 72 } }),
    });
    renderAdminPage(<DashboardPage />);
    await flush();
    const fill = screen.getByTestId('dashboard-server-disk').querySelector('.dashboard-meter-row__fill') as HTMLElement;
    expect(fill.style.background).toBe('var(--warn)');
  });

  it('shows the red undervoltage banner on the sticky since-boot flag', async () => {
    (getSystemStats as Mock).mockResolvedValue({
      ok: true,
      data: makeStats({
        throttle: {
          undervoltedNow: false, freqCappedNow: false, throttledNow: false,
          undervoltedSinceBoot: true, freqCappedSinceBoot: false, throttledSinceBoot: false,
        },
      }),
    });
    renderAdminPage(<DashboardPage />);
    await flush();
    const banner = screen.getByTestId('dashboard-undervolt-banner');
    expect(banner).toHaveTextContent('Power problem');
    expect(banner).toHaveTextContent('since it booted');
  });

  it('reboot banner: two-step confirm calls triggerReboot, and the button is absent when not osManaged', async () => {
    (getSystemStats as Mock).mockResolvedValue({
      ok: true, data: makeStats({ rebootRequired: true, osManaged: true }),
    });
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-reboot-banner')).toBeInTheDocument();
    expect(triggerReboot).not.toHaveBeenCalled();
    screen.getByTestId('dashboard-reboot-button').click();
    await flush();
    screen.getByTestId('dashboard-reboot-confirm').click();
    await flush();
    expect(triggerReboot).toHaveBeenCalledTimes(1);
  });

  it('reboot banner without osManaged shows no button at all', async () => {
    (getSystemStats as Mock).mockResolvedValue({
      ok: true, data: makeStats({ rebootRequired: true, osManaged: false }),
    });
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-reboot-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-reboot-button')).not.toBeInTheDocument();
  });

  it('surfaces a NEEDS ATTENTION card ranking an unhealthy source above a low keg', async () => {
    (useTapStates as Mock).mockReturnValue({
      taps: [
        makeTap(2, {
          tapNumber: 2,
          beer: {
            id: 1, name: 'Last Pils', brewery: null, style: null, abv: null, ibu: null, srm: 4, description: null, labelImage: null, createdAt: '',
          },
          keg: {
            id: 1, beerId: 1, tapId: 2, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 17000, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 11, remainingMl: 2000,
          },
        }),
      ],
      stale: false, connected: true, reconnectCount: 0,
    });
    (getSources as Mock).mockResolvedValue({
      ok: true, data: [makeSource({ name: 'kegtron_cloud', registered: true, healthy: false })],
    });
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-triage')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-triage-count')).toHaveTextContent('2');
    const rows = screen.getAllByTestId('dashboard-triage-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-severity', 'danger');
    expect(rows[0]).toHaveTextContent('Kegtron cloud is down');
    expect(rows[1]).toHaveTextContent('Last Pils on Tap 2 is at 11%');
    expect(screen.getAllByTestId('dashboard-triage-action')[1]).toHaveTextContent('Swap keg');
  });

  it('renders no NEEDS ATTENTION card when everything is healthy', async () => {
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.queryByTestId('dashboard-triage')).not.toBeInTheDocument();
  });

  it('renders the pours 7-day sparkline and a week-over-week delta', async () => {
    const byDay = Array.from({ length: 30 }, (_, i) => {
      const d = new Date('2026-07-31T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - (29 - i));
      return {
        date: d.toISOString().slice(0, 10),
        count: i === 29 ? 20 : i === 22 ? 16 : 5,
        volumeMl: 0,
      };
    });
    (getPoursByDay as Mock).mockResolvedValue({ ok: true, data: byDay });
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-pours-spark').children).toHaveLength(7);
    expect(screen.getByTestId('dashboard-pours-delta')).toHaveTextContent('↑ 25% vs last Friday');
  });

  it('shows the soonest next-kick estimate on the On tap card', async () => {
    (getActiveKegStats as Mock).mockResolvedValue({
      ok: true,
      data: [
        {
          kegId: 1, beerName: 'A', tapNumber: 1, srm: 5, levelPct: 20, remainingMl: 4000, dailyBurnMl: 2000, projectedKickDate: '2099-01-05',
        },
        {
          kegId: 2, beerName: 'B', tapNumber: 2, srm: 5, levelPct: 8, remainingMl: 1000, dailyBurnMl: 2000, projectedKickDate: '2099-01-02',
        },
      ],
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2099, 0, 1, 12, 0, 0)); // local Jan 1 — helper parses kick dates as local midnight
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-on-tap-note')).toHaveTextContent('next kick ~1 day');
  });

  it('lists the failing source under the Sources card', async () => {
    (getSources as Mock).mockResolvedValue({
      ok: true, data: [makeSource({ name: 'kegtron_udp', registered: true, healthy: false })],
    });
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-sources-failing')).toHaveTextContent('Kegtron UDP down');
  });

  it('renders a stat card per temperature sensor, flagging a warming Govee against the Kegtron probe', async () => {
    (getSensors as Mock).mockResolvedValue({
      ok: true,
      data: [
        {
          id: 1, name: 'Keezer probe', kind: 'kegtron', tempC: 3, humidity: null, lastSeen: null, min7dC: 2, max7dC: 4,
        },
        {
          id: 2, name: 'Garage', kind: 'govee', tempC: 6, humidity: 55, lastSeen: null, min7dC: 5, max7dC: 8,
        },
      ],
    });
    renderAdminPage(<DashboardPage />, adminContext('admin', 'metric'));
    await flush();
    const cards = screen.getAllByTestId('dashboard-sensor-card');
    expect(cards).toHaveLength(2);
    // Kegtron first, healthy.
    expect(cards[0]).toHaveTextContent('KEGTRON');
    expect(cards[0]).toHaveAttribute('data-warming', 'false');
    expect(cards[0]).toHaveTextContent('2°C–4°C · 7 d');
    // Govee 3°C warmer than the reference → warming, humidity shown, delta in the note.
    expect(cards[1]).toHaveTextContent('GOVEE');
    expect(cards[1]).toHaveAttribute('data-warming', 'true');
    expect(cards[1]).toHaveTextContent('55% RH');
    expect(cards[1]).toHaveTextContent('warming · Δ +3°C vs Kegtron');
  });

  it('falls back to the KEG ROOM card when no sensors report', async () => {
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-card-keg-room')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-sensor-card')).not.toBeInTheDocument();
  });

  it('shows the finish-setup hint only while no wall exists', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [] });
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.getByTestId('dashboard-setup-hint')).toHaveTextContent('Finish setting up');
  });

  it('hides the finish-setup hint once a wall exists', async () => {
    renderAdminPage(<DashboardPage />);
    await flush();
    expect(screen.queryByTestId('dashboard-setup-hint')).not.toBeInTheDocument();
  });
});
