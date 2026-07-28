import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, screen } from '@testing-library/react';
import { DashboardPage } from '../../../src/web/routes/admin/DashboardPage';
import { getMenu } from '../../../src/web/lib/api';
import { useTapStates } from '../../../src/web/lib/useTapStates';
import {
  getActivity, getSources, getPoursSince,
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
    monitorOnline: true,
    temp: null,
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
    durationMs: null, source: 'udp', drinkerId: null, ...overrides,
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
            id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 4000, dateTapped: null, status: 'on_tap', createdAt: '', levelPct: 80, remainingMl: 15000,
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
            id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 19000, dateTapped: null, status: 'kicked', createdAt: '', levelPct: 0, remainingMl: 0,
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

  it('shows the alerts placeholder with a zero count and a quiet note', async () => {
    renderAdminPage(<DashboardPage />);
    expect(await screen.findByTestId('dashboard-alert-count')).toHaveTextContent('0');
    expect(screen.getByTestId('dashboard-alert-note')).toHaveTextContent('Alerts arrive in a later update');
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
    expect(rows[0]).toHaveTextContent('Healthy');
    expect(rows[0]).toHaveTextContent('polling ok');
    expect(rows[1]).toHaveTextContent('Unhealthy');
    expect(rows[1]).toHaveTextContent('no packets');
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
    expect(rows[1]).toHaveTextContent('No events yet');
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
});
