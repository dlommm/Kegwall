import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { TonightPage } from '../../../src/web/routes/admin/TonightPage';
import { getDrinkers, getMenu } from '../../../src/web/lib/api';
import { useTapStates } from '../../../src/web/lib/useTapStates';
import {
  getActivity, getSources, getPoursSince, getSystemStats, listWalls, triggerReboot,
  getCleaningStatuses, getSensors, getSettings, listDisplays, type SystemStats,
} from '../../../src/web/lib/adminApi';
import type { TapState } from '../../../src/server/core/state';
import type { SourceStatus } from '../../../src/server/ingest/manager';
import type { ActivityEvent } from '../../../src/server/db/activity';
import type { Pour } from '../../../src/server/db/kegs';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/api', () => ({ getMenu: vi.fn(), getDrinkers: vi.fn() }));
vi.mock('../../../src/web/lib/useTapStates', () => ({ useTapStates: vi.fn() }));
vi.mock('../../../src/web/lib/adminApi', () => ({
  getActivity: vi.fn(),
  getSources: vi.fn(),
  getPoursSince: vi.fn(),
  getSystemStats: vi.fn(),
  listWalls: vi.fn(),
  triggerReboot: vi.fn(),
  getCleaningStatuses: vi.fn(),
  getSensors: vi.fn(),
  getSettings: vi.fn(),
  listDisplays: vi.fn(),
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
    nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
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

const beer = (id: number, name: string) => ({
  id, name, brewery: null, style: null, abv: null, ibu: null, srm: 6, description: null, labelImage: null, createdAt: '',
});

function keg(id: number, levelPct: number, status: 'on_tap' | 'kicked' = 'on_tap'): NonNullable<TapState['keg']> {
  return {
    id, beerId: id, tapId: id, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 0, dateTapped: null, status,
    createdAt: '', kegType: null, costCents: null, levelPct, remainingMl: 19000 * (levelPct / 100),
  };
}

function setTaps(taps: TapState[]) {
  (useTapStates as Mock).mockReturnValue({ taps, stale: false, connected: true, reconnectCount: 0 });
}

describe('TonightPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMenu as Mock).mockResolvedValue({ ok: true, data: { siteName: 'X', taps: [], units: 'us' } });
    (getDrinkers as Mock).mockResolvedValue({ ok: true, data: [] });
    setTaps([]);
    (getActivity as Mock).mockResolvedValue({ ok: true, data: [] });
    (getSources as Mock).mockResolvedValue({ ok: true, data: [] });
    (getPoursSince as Mock).mockResolvedValue({ ok: true, data: [] });
    (getSystemStats as Mock).mockResolvedValue({ ok: true, data: makeStats() });
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [{ id: 1, slug: 'main', name: 'Main', config: {} }] });
    (triggerReboot as Mock).mockResolvedValue({ ok: true, data: { message: 'Rebooting' } });
    (getCleaningStatuses as Mock).mockResolvedValue({ ok: true, data: [] });
    (getSensors as Mock).mockResolvedValue({ ok: true, data: [] });
    (getSettings as Mock).mockResolvedValue({ ok: true, data: { servingSizeMl: 473 } });
    (listDisplays as Mock).mockResolvedValue({ ok: true, data: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says how many are on tap and that everything is running on a quiet night', async () => {
    setTaps([
      makeTap(1, { beer: beer(1, 'Citra Haze'), keg: keg(1, 80) }),
      makeTap(2, { beer: beer(2, 'Vienna Nights'), keg: keg(2, 50) }),
    ]);
    renderAdminPage(<TonightPage />);
    await flush();
    expect(screen.getByTestId('tonight-headline')).toHaveTextContent('Two on tap. Everything is running.');
    expect(screen.getByTestId('tonight-sub')).toHaveTextContent('No pours yet tonight. Everything is running.');
    expect(screen.getByTestId('tonight-clear')).toBeInTheDocument();
  });

  it('folds eleven cleaning-due taps into ONE row (issue 11) and ranks a down source above it', async () => {
    const taps = Array.from({ length: 11 }, (_, i) => makeTap(i + 1, { beer: beer(i + 1, `Beer ${i + 1}`), keg: keg(i + 1, 60) }));
    setTaps(taps);
    (getCleaningStatuses as Mock).mockResolvedValue({
      ok: true, data: taps.map((t) => ({ tapId: t.tapId, due: true, ignored: false })),
    });
    (getSources as Mock).mockResolvedValue({ ok: true, data: [makeSource({ name: 'kegtron_cloud', healthy: false })] });
    renderAdminPage(<TonightPage />);
    await flush();
    const rows = screen.getAllByTestId('tonight-attention-row');
    expect(rows.map((r) => r.dataset.kind)).toEqual(['sources', 'cleaning']);
    expect(rows[0]).toHaveTextContent('Kegtron cloud stopped answering');
    expect(rows[1]).toHaveTextContent('Eleven taps are due for a line cleaning');
    expect(within(rows[0]!).getByRole('link', { name: 'Open the doctor' })).toHaveAttribute('href', '/admin/doctor');
    expect(screen.getByTestId('tonight-headline')).toHaveTextContent('Eleven on tap. Kegtron cloud stopped answering.');
  });

  it('groups low kegs into one swap row and leads the headline with it', async () => {
    setTaps([
      makeTap(4, { beer: beer(4, 'Midnight Oats'), keg: keg(4, 4) }),
      makeTap(11, { beer: beer(11, 'Old Thunder'), keg: keg(11, 9) }),
      makeTap(1, { beer: beer(1, 'Citra Haze'), keg: keg(1, 80) }),
    ]);
    renderAdminPage(<TonightPage />);
    await flush();
    const row = screen.getByTestId('tonight-attention-row');
    expect(row).toHaveTextContent('Swap two kegs soon');
    expect(row).toHaveTextContent('Midnight Oats on tap 4 (about two pints) and Old Thunder on tap 11 (about four pints)');
    expect(screen.getByTestId('tonight-headline')).toHaveTextContent('Three on tap. Two kegs need a swap soon.');
  });

  it('confirms before rebooting for a pending OS update', async () => {
    (getSystemStats as Mock).mockResolvedValue({ ok: true, data: makeStats({ rebootRequired: true, osManaged: true }) });
    renderAdminPage(<TonightPage />);
    await flush();
    fireEvent.click(screen.getByTestId('tonight-reboot'));
    expect(triggerReboot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('tonight-reboot-confirm'));
    expect(triggerReboot).toHaveBeenCalledOnce();
  });

  it('flags low power as a problem', async () => {
    (getSystemStats as Mock).mockResolvedValue({
      ok: true,
      data: makeStats({
        throttle: {
          undervoltedNow: true, freqCappedNow: false, throttledNow: false,
          undervoltedSinceBoot: true, freqCappedSinceBoot: false, throttledSinceBoot: false,
        },
      }),
    });
    renderAdminPage(<TonightPage />);
    await flush();
    const row = screen.getByTestId('tonight-attention-row');
    expect(row.dataset.level).toBe('problem');
    expect(row).toHaveTextContent('This Pi isn’t getting enough power');
  });

  it('points a fresh install at the guided setup', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [] });
    renderAdminPage(<TonightPage />);
    await flush();
    expect(screen.getByRole('link', { name: 'Finish setting up' })).toHaveAttribute('href', '/admin/welcome');
  });

  it('counts tonight\'s pours and shows the last one, with Assign when pourers exist', async () => {
    setTaps([makeTap(1, { beer: beer(1, 'Citra Haze'), keg: keg(1, 80) })]);
    (getDrinkers as Mock).mockResolvedValue({ ok: true, data: [{ id: 1, displayName: 'Alex', avatarColor: null }] });
    (getPoursSince as Mock).mockResolvedValue({
      ok: true,
      data: [makePour({ id: 2, kegId: 1, volumeMl: 411 }), makePour({ id: 1, kegId: 1, volumeMl: 355, drinkerId: 1 })],
    });
    renderAdminPage(<TonightPage />);
    await flush();
    expect(screen.getByTestId('tonight-sub')).toHaveTextContent('2 pours so far tonight');
    const last = screen.getByTestId('tonight-last-pour');
    expect(last).toHaveTextContent('Citra Haze');
    expect(last).toHaveTextContent('13.9oz');
    expect(within(last).getByRole('link', { name: 'Assign it' })).toHaveAttribute('href', '/admin/pours');
    expect(screen.getByTestId('tonight-attention-row')).toHaveTextContent('One pour tonight has no name');
  });

  it('never nags about unnamed pours when the taproom has no pourers', async () => {
    (getPoursSince as Mock).mockResolvedValue({ ok: true, data: [makePour()] });
    renderAdminPage(<TonightPage />);
    await flush();
    expect(screen.queryByTestId('tonight-attention-row')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('tonight-last-pour')).queryByText('Assign it')).not.toBeInTheDocument();
  });

  it('draws every tap as a glass with what is left, linking to the tap', async () => {
    setTaps([
      makeTap(1, { beer: beer(1, 'Citra Haze'), keg: keg(1, 50) }),
      makeTap(2, { beer: beer(2, 'Gourd Times'), keg: keg(2, 0, 'kicked') }),
      makeTap(3),
    ]);
    renderAdminPage(<TonightPage />);
    await flush();
    const glasses = screen.getAllByTestId('dashboard-tap-pill');
    expect(glasses).toHaveLength(3);
    expect(glasses[0]).toHaveAttribute('href', '/admin/taps?tap=1');
    expect(glasses[0]).toHaveAccessibleName('Tap 1: Citra Haze, 20 pints left');
    expect(glasses[1]).toHaveAttribute('data-kicked', 'true');
    expect(glasses[2]).toHaveAccessibleName('Tap 3: empty, no keg');
  });

  it('lists hardware sources with a shape-and-word state, and the latest activity', async () => {
    (getSources as Mock).mockResolvedValue({
      ok: true,
      data: [makeSource({ name: 'kegtron_udp' }), makeSource({ name: 'kegtron_cloud', healthy: false }), makeSource({ name: 'govee', registered: false })],
    });
    (getActivity as Mock).mockResolvedValue({ ok: true, data: [makeEvent()] });
    renderAdminPage(<TonightPage />);
    await flush();
    const rows = screen.getAllByTestId('tonight-source');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.querySelector('[data-state]')).toHaveAttribute('data-state', 'failed');
    expect(screen.getAllByTestId('dashboard-activity-row')).toHaveLength(1);
  });

  it('notes taps whose cleaning reminders are off', async () => {
    setTaps([makeTap(5, { beer: beer(5, 'X'), keg: keg(5, 60) })]);
    (getCleaningStatuses as Mock).mockResolvedValue({ ok: true, data: [{ tapId: 5, due: false, ignored: true }] });
    renderAdminPage(<TonightPage />);
    await flush();
    expect(screen.getByTestId('dashboard-cleaning-ignored')).toHaveTextContent('Line-cleaning reminders are off for Tap 5.');
  });

  it('shows the kegerator as its warmest probe and keeps Govee sensors separate', async () => {
    const sensor = (id: number, kind: 'kegtron' | 'govee', tempC: number) => ({
      id, name: kind === 'kegtron' ? 'Kegtron' : 'Keg room', kind, tempC, humidity: null, lastSeen: null, min7dC: null, max7dC: null,
    });
    (getSensors as Mock).mockResolvedValue({ ok: true, data: [sensor(1, 'kegtron', 2), sensor(2, 'kegtron', 3.5), sensor(3, 'govee', 4)] });
    renderAdminPage(<TonightPage />);
    await flush();
    expect(screen.getByTestId('tonight-kegerator')).toHaveTextContent('Highest of 2 Kegtron probes');
    expect(screen.getByTestId('tonight-kegerator')).toHaveTextContent('38°F');
    expect(screen.getAllByTestId('dashboard-sensor-card')).toHaveLength(1);
  });

  it('lists at most four screens and links to the rest', async () => {
    (listWalls as Mock).mockResolvedValue({
      ok: true, data: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, slug: `w${i}`, name: `Wall ${i + 1}`, config: {} })),
    });
    renderAdminPage(<TonightPage />);
    await flush();
    expect(within(screen.getByTestId('tonight-screens')).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'All 9 walls' })).toHaveAttribute('href', '/admin/walls');
  });

  it('never shows keg cost', async () => {
    setTaps([makeTap(1, { beer: beer(1, 'Citra Haze'), keg: { ...keg(1, 80), costCents: 12345 } })]);
    renderAdminPage(<TonightPage />);
    await flush();
    expect(screen.getByTestId('admin-tonight-page')).not.toHaveTextContent(/123\.45|\$/);
  });
});
