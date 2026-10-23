import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { MonitorsPage } from '../../../src/web/routes/admin/MonitorsPage';
import { getMenu } from '../../../src/web/lib/api';
import { useTapStates } from '../../../src/web/lib/useTapStates';
import {
  listMonitors, bindMonitor, getMonitorTelemetry, resetKegtronVolume, getMonitorWifiRssi,
  updateMonitorIdentity,
} from '../../../src/web/lib/adminApi';
import type { TapState } from '../../../src/server/core/state';
import type { Monitor } from '../../../src/server/db/monitors';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/api', () => ({ getMenu: vi.fn() }));
vi.mock('../../../src/web/lib/useTapStates', () => ({ useTapStates: vi.fn() }));
vi.mock('../../../src/web/lib/adminApi', () => ({
  listMonitors: vi.fn(),
  bindMonitor: vi.fn(),
  getMonitorTelemetry: vi.fn(),
  resetKegtronVolume: vi.fn(),
  getMonitorWifiRssi: vi.fn(),
  updateMonitorIdentity: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeMonitor(id: number, overrides: Partial<Monitor> = {}): Monitor {
  return {
    id,
    type: 'kegtron_pro',
    identifier: `device-${id}`,
    serial: `SN${id}`,
    portIndex: 0,
    tapId: null,
    lastSeen: '2026-07-27T23:00:00.000Z',
    meta: {},
    name: null,
    enabled: true,
    ...overrides,
  };
}

function makeTap(tapId: number, overrides: Partial<TapState> = {}): TapState {
  return {
    tapId, tapNumber: tapId, tapName: null, beer: null, keg: null, lastPour: null,
    pouring: false, curServMl: null, monitorOnline: true, hidden: false, temp: null, avgRating: null, nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getMenu as Mock).mockResolvedValue({ ok: true, data: { siteName: 'X', taps: [], units: 'us' } });
  (useTapStates as Mock).mockReturnValue({ taps: [], stale: false, connected: true, reconnectCount: 0 });
  (listMonitors as Mock).mockResolvedValue({ ok: true, data: [] });
  (getMonitorTelemetry as Mock).mockResolvedValue({ ok: true, data: [] });
  (getMonitorWifiRssi as Mock).mockResolvedValue({ ok: true, data: { rssi: -47 } });
});

describe('MonitorsPage', () => {
  it('renders one CARD per physical device with a type badge, identifier/serial, and its port rows', async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true,
      data: [
        makeMonitor(1, { type: 'kegtron_pro', identifier: 'device-1', serial: 'SN1', portIndex: 2 }),
        makeMonitor(2, { type: 'kegtron_gen1', identifier: 'aa:bb:cc', serial: null, portIndex: 0 }),
      ],
    });
    renderAdminPage(<MonitorsPage />);
    const cards = await screen.findAllByTestId('monitors-device-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Kegtron Pro');
    expect(cards[0]).toHaveTextContent('device-1');
    expect(cards[0]).toHaveTextContent('SN1');
    expect(within(cards[0]!).getByTestId('monitors-row-port')).toHaveTextContent('2');
    expect(cards[1]).toHaveTextContent('Kegtron Gen 1');
    expect(cards[1]).toHaveTextContent('aa:bb:cc');
  });

  it('groups a 4-port Kegtron into ONE card with four individually bindable port rows', async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true,
      data: [0, 1, 2, 3].map((port) => makeMonitor(10 + port, {
        type: 'kegtron_pro', identifier: 'device-big', serial: 'SN9', portIndex: port,
      })),
    });
    renderAdminPage(<MonitorsPage />);
    const cards = await screen.findAllByTestId('monitors-device-card');
    expect(cards).toHaveLength(1);
    const ports = within(cards[0]!).getAllByTestId('monitors-port-row');
    expect(ports).toHaveLength(4);
    expect(within(cards[0]!).getAllByTestId('monitors-row-bind')).toHaveLength(4);
    // Device-level things said once, not per port.
    expect(within(cards[0]!).getAllByTestId('monitors-card-expand')).toHaveLength(1);
  });

  it('renames the device via the identity route, addressed by the anchor (lowest-port) row', async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true,
      data: [
        makeMonitor(11, { identifier: 'device-big', portIndex: 1 }),
        makeMonitor(10, { identifier: 'device-big', portIndex: 0 }),
      ],
    });
    (updateMonitorIdentity as Mock).mockResolvedValue({ ok: true, data: makeMonitor(10, { name: 'Garage' }) });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-card-rename'));
    fireEvent.change(screen.getByTestId('monitors-card-rename-input'), { target: { value: 'Garage' } });
    fireEvent.click(screen.getByTestId('monitors-card-rename-save'));
    await flush();

    expect(updateMonitorIdentity).toHaveBeenCalledWith(10, { name: 'Garage' });
    expect(listMonitors).toHaveBeenCalledTimes(2); // initial load + post-rename refresh
  });

  describe('Govee sensor cards', () => {
    function makeGovee(overrides: Partial<Monitor> = {}): Monitor {
      return makeMonitor(30, {
        type: 'govee_sensor', identifier: 'AA:BB', serial: null,
        meta: { deviceName: 'Keg room H5179', sku: 'H5179' }, ...overrides,
      });
    }

    it('renders a card with the Govee type badge and app-name subtitle, and NO port table / bind / reset', async () => {
      (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeGovee()] });
      renderAdminPage(<MonitorsPage />);
      const cards = await screen.findAllByTestId('monitors-device-card');
      expect(cards[0]).toHaveTextContent('Govee sensor');
      expect(within(cards[0]!).getByTestId('monitors-card-govee-name')).toHaveTextContent('Keg room H5179');
      expect(screen.queryByTestId('monitors-port-table')).not.toBeInTheDocument();
      expect(screen.queryByTestId('monitors-row-bind')).not.toBeInTheDocument();
      expect(screen.queryByTestId('monitors-row-reset')).not.toBeInTheDocument();
      // Details (telemetry sparkline) IS offered; WiFi/firmware are Kegtron-only.
      expect(screen.getByTestId('monitors-card-expand')).toBeInTheDocument();
    });

    it('expanding a Govee card fetches telemetry but shows no Pro-only device info', async () => {
      (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeGovee()] });
      (getMonitorTelemetry as Mock).mockResolvedValue({
        ok: true,
        data: [
          { ts: '2026-07-29T20:00:00.000Z', temp: 3.9, humidity: 52 },
          { ts: '2026-07-29T21:00:00.000Z', temp: 4.1, humidity: 53 },
        ],
      });
      renderAdminPage(<MonitorsPage />);
      await screen.findAllByTestId('monitors-device-card');

      fireEvent.click(screen.getByTestId('monitors-card-expand'));
      await flush();

      expect(getMonitorTelemetry).toHaveBeenCalledWith(30, 24);
      expect(screen.getByTestId('monitors-sparkline-temp')).toBeInTheDocument();
      expect(screen.queryByTestId('monitors-device-info')).not.toBeInTheDocument();
      expect(screen.queryByTestId('monitors-rssi-check')).not.toBeInTheDocument();
    });

    it('Disable/Enable round-trips through the identity route; a disabled card stays visible with a badge', async () => {
      (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeGovee()] });
      (updateMonitorIdentity as Mock).mockResolvedValue({ ok: true, data: makeGovee({ enabled: false }) });
      renderAdminPage(<MonitorsPage />);
      await screen.findAllByTestId('monitors-device-card');

      expect(screen.queryByTestId('monitors-card-disabled-badge')).not.toBeInTheDocument();
      (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeGovee({ enabled: false })] });
      fireEvent.click(screen.getByTestId('monitors-card-toggle-enabled'));
      await flush();

      expect(updateMonitorIdentity).toHaveBeenCalledWith(30, { enabled: false });
      const cards = screen.getAllByTestId('monitors-device-card');
      expect(within(cards[0]!).getByTestId('monitors-card-disabled-badge')).toHaveTextContent('Disabled');
      expect(screen.getByTestId('monitors-card-toggle-enabled')).toHaveTextContent('Enable');
    });

    it('a viewer sees no Disable control on a Govee card', async () => {
      (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeGovee()] });
      renderAdminPage(<MonitorsPage />, adminContext('viewer'));
      await screen.findAllByTestId('monitors-device-card');
      expect(screen.queryByTestId('monitors-card-toggle-enabled')).not.toBeInTheDocument();
    });
  });

  it('a Kegtron device can be disabled too — hardware at another location', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1)] });
    (updateMonitorIdentity as Mock).mockResolvedValue({ ok: true, data: makeMonitor(1, { enabled: false }) });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { enabled: false })] });
    fireEvent.click(screen.getByTestId('monitors-card-toggle-enabled'));
    await flush();

    expect(updateMonitorIdentity).toHaveBeenCalledWith(1, { enabled: false });
    expect(screen.getByTestId('monitors-card-disabled-badge')).toHaveTextContent('Disabled');
  });

  it('shows the device friendly name as the card title when set', async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true, data: [makeMonitor(1, { name: 'Main kegerator' })],
    });
    renderAdminPage(<MonitorsPage />);
    const cards = await screen.findAllByTestId('monitors-device-card');
    expect(within(cards[0]!).getByTestId('monitors-card-name')).toHaveTextContent('Main kegerator');
  });

  it('shows a quiet empty state with no monitors', async () => {
    renderAdminPage(<MonitorsPage />);
    expect(await screen.findByTestId('monitors-empty')).toBeInTheDocument();
  });

  it('shows a visible "Not bound" nudge for an unbound monitor, and the tap name + live volume for a bound one', async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true,
      data: [
        makeMonitor(1, { tapId: null }),
        makeMonitor(2, { tapId: 5 }),
      ],
    });
    (useTapStates as Mock).mockReturnValue({
      taps: [
        makeTap(5, {
          tapName: 'Left',
          keg: {
            id: 1, beerId: 1, tapId: 5, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 4750,
            dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 75, remainingMl: 14250,
          },
        }),
      ],
      stale: false, connected: true, reconnectCount: 0,
    });
    renderAdminPage(<MonitorsPage />);
    const cards = await screen.findAllByTestId('monitors-device-card');
    expect(cards[0]).toHaveTextContent('Not bound');
    expect(cards[1]).toHaveTextContent('Left');
    expect(cards[1]).toHaveTextContent('481.8 oz');
  });

  it('a viewer sees read-only cards: no rename/bind/unbind/reset controls, but can still open Pro details', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { type: 'kegtron_pro' })] });
    renderAdminPage(<MonitorsPage />, adminContext('viewer'));
    await screen.findAllByTestId('monitors-device-card');
    expect(screen.queryByTestId('monitors-row-bind')).not.toBeInTheDocument();
    expect(screen.queryByTestId('monitors-row-unbind')).not.toBeInTheDocument();
    expect(screen.queryByTestId('monitors-row-reset')).not.toBeInTheDocument();
    expect(screen.queryByTestId('monitors-card-rename')).not.toBeInTheDocument();
    expect(screen.getByTestId('monitors-card-expand')).toBeInTheDocument();
  });

  it('binding: opens the picker, submits the chosen tap, and refreshes the list', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { tapId: null })] });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(5, { tapName: 'Left' }), makeTap(6, { tapNumber: 6, tapName: null })],
      stale: false, connected: true, reconnectCount: 0,
    });
    (bindMonitor as Mock).mockResolvedValue({ ok: true, data: makeMonitor(1, { tapId: 5 }) });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-row-bind'));
    expect(screen.getByTestId('monitors-bind-picker')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('monitors-bind-select'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('monitors-bind-submit'));
    await flush();

    expect(bindMonitor).toHaveBeenCalledWith(1, 5);
    expect(screen.queryByTestId('monitors-bind-picker')).not.toBeInTheDocument();
    expect(listMonitors).toHaveBeenCalledTimes(2); // initial load + post-bind refresh
  });

  it('unbinding a bound monitor calls bind with a null tapId, with no picker needed', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { tapId: 5 })] });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(5, { tapName: 'Left' })], stale: false, connected: true, reconnectCount: 0,
    });
    (bindMonitor as Mock).mockResolvedValue({ ok: true, data: makeMonitor(1, { tapId: null }) });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-row-unbind'));
    await flush();

    expect(bindMonitor).toHaveBeenCalledWith(1, null);
    expect(listMonitors).toHaveBeenCalledTimes(2);
  });

  it('an unbind failure opens the bind picker (prefilled) with the error, instead of failing silently', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { tapId: 5 })] });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(5, { tapName: 'Left' })], stale: false, connected: true, reconnectCount: 0,
    });
    (bindMonitor as Mock).mockResolvedValue({ ok: false, status: 0, message: 'Network error' });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-row-unbind'));
    await flush();

    expect(screen.getByTestId('monitors-bind-picker')).toBeInTheDocument();
    expect(screen.getByTestId('monitors-bind-error')).toHaveTextContent('Network error');
    expect(screen.getByTestId('monitors-bind-select')).toHaveValue('5');
  });

  it('a bind failure shows the message and keeps the picker open', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { tapId: null })] });
    (useTapStates as Mock).mockReturnValue({
      taps: [makeTap(5, { tapName: 'Left' })], stale: false, connected: true, reconnectCount: 0,
    });
    (bindMonitor as Mock).mockResolvedValue({ ok: false, status: 400, message: 'Refers to a record that does not exist' });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-row-bind'));
    fireEvent.click(screen.getByTestId('monitors-bind-submit'));
    await flush();

    expect(screen.getByTestId('monitors-bind-error')).toHaveTextContent('does not exist');
    expect(screen.getByTestId('monitors-bind-picker')).toBeInTheDocument();
  });

  it("a Gen 1 monitor has no Details/expand or reset control (no temp/humidity, not mdash-backed)", async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { type: 'kegtron_gen1' })] });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');
    expect(screen.queryByTestId('monitors-card-expand')).not.toBeInTheDocument();
    expect(screen.queryByTestId('monitors-row-reset')).not.toBeInTheDocument();
  });

  it("expanding a Pro monitor's details fetches and renders latest temp/humidity + a sparkline", async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { type: 'kegtron_pro' })] });
    (getMonitorTelemetry as Mock).mockResolvedValue({
      ok: true,
      data: [
        { ts: '2026-07-27T20:00:00.000Z', temp: 3.0, humidity: 40 },
        { ts: '2026-07-27T21:00:00.000Z', temp: 4.0, humidity: 45 },
      ],
    });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-card-expand'));
    await flush();

    expect(getMonitorTelemetry).toHaveBeenCalledWith(1, 24);
    expect(screen.getByTestId('monitors-telemetry-latest')).toHaveTextContent('45%');
    expect(screen.getByTestId('monitors-sparkline-temp')).toBeInTheDocument();
  });

  it('expanding a Pro monitor with no telemetry yet shows an empty state, not a broken chart', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { type: 'kegtron_pro' })] });
    (getMonitorTelemetry as Mock).mockResolvedValue({ ok: true, data: [] });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-card-expand'));
    await flush();

    expect(screen.getByTestId('monitors-telemetry-empty')).toBeInTheDocument();
  });

  it('reset volume: the confirm names the monitor and states the consequence, then succeeds', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(7, { type: 'kegtron_pro', identifier: 'device-7' })] });
    (resetKegtronVolume as Mock).mockResolvedValue({ ok: true, data: { ok: true } });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-row-reset'));
    const confirm = screen.getByTestId('monitors-reset-confirm');
    expect(confirm).toHaveTextContent('device-7');
    expect(confirm).toHaveTextContent('reset');

    fireEvent.click(screen.getByTestId('monitors-reset-confirm-button'));
    await flush();

    expect(resetKegtronVolume).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('monitors-reset-done')).toBeInTheDocument();
  });

  it('reset volume: a 502 shows a gentle message and keeps the retry action available', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(7, { type: 'kegtron_pro' })] });
    (resetKegtronVolume as Mock).mockResolvedValue({ ok: false, status: 502, message: 'Failed to reset volume via mdash.net (status 503)' });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-row-reset'));
    fireEvent.click(screen.getByTestId('monitors-reset-confirm-button'));
    await flush();

    expect(screen.getByTestId('monitors-reset-error')).toHaveTextContent(/try again/i);
    expect(screen.getByTestId('monitors-reset-confirm-button')).not.toBeDisabled();

    (resetKegtronVolume as Mock).mockResolvedValue({ ok: true, data: { ok: true } });
    fireEvent.click(screen.getByTestId('monitors-reset-confirm-button'));
    await flush();
    expect(resetKegtronVolume).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('monitors-reset-done')).toBeInTheDocument();
  });

  it("a Pro monitor's details show firmware + online state from monitor meta", async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true,
      data: [makeMonitor(1, { type: 'kegtron_pro', meta: { fw: '20200507', online: true } })],
    });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-card-expand'));
    await flush();

    expect(screen.getByTestId('monitors-device-firmware')).toHaveTextContent('20200507');
    expect(screen.getByTestId('monitors-device-online')).toHaveTextContent('Online');
  });

  it('shows "Unknown" firmware/online for a Pro monitor with no such meta yet', async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true, data: [makeMonitor(1, { type: 'kegtron_pro', meta: {} })],
    });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-card-expand'));
    await flush();

    expect(screen.getByTestId('monitors-device-firmware')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('monitors-device-online')).toHaveTextContent('Unknown');
  });

  it('Check WiFi signal fetches and shows the RSSI in dBm', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { type: 'kegtron_pro' })] });
    (getMonitorWifiRssi as Mock).mockResolvedValue({ ok: true, data: { rssi: -52 } });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-card-expand'));
    fireEvent.click(screen.getByTestId('monitors-rssi-check'));
    await flush();

    expect(getMonitorWifiRssi).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('monitors-rssi-value')).toHaveTextContent('-52 dBm');
  });

  it('Check WiFi signal shows a gentle message on a 502', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { type: 'kegtron_pro' })] });
    (getMonitorWifiRssi as Mock).mockResolvedValue({ ok: false, status: 502, message: 'boom' });
    renderAdminPage(<MonitorsPage />);
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-card-expand'));
    fireEvent.click(screen.getByTestId('monitors-rssi-check'));
    await flush();

    expect(screen.getByTestId('monitors-rssi-error')).toHaveTextContent(/couldn.t reach/i);
  });

  it('a viewer sees no "Check WiFi signal" control', async () => {
    (listMonitors as Mock).mockResolvedValue({ ok: true, data: [makeMonitor(1, { type: 'kegtron_pro' })] });
    renderAdminPage(<MonitorsPage />, adminContext('viewer'));
    await screen.findAllByTestId('monitors-device-card');

    fireEvent.click(screen.getByTestId('monitors-card-expand'));
    await flush();

    expect(screen.queryByTestId('monitors-rssi-check')).not.toBeInTheDocument();
  });
});
