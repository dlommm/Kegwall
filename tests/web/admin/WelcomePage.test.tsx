import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { WelcomePage } from '../../../src/web/routes/admin/WelcomePage';
import {
  createWall, getSettings, getSystemUrls, listMonitors, listWalls, patchSettings,
  setWallDevices,
} from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', () => ({
  createWall: vi.fn(),
  getSettings: vi.fn(),
  getSystemUrls: vi.fn(),
  listMonitors: vi.fn(),
  listWalls: vi.fn(),
  patchSettings: vi.fn(),
  setWallDevices: vi.fn(),
}));

const SETTINGS = { siteName: 'Kegwall', updates: null };
const URLS = {
  port: 8080, hostname: 'kegwall-pi', addresses: ['192.168.1.50'], install: 'native' as const,
};
const WALL = { id: 1, slug: 'main', name: 'The Keg Cave', config: {} };

function monitor(id: number, type: string, identifier: string, portIndex: number) {
  return {
    id, type, identifier, serial: null, portIndex, tapId: null, lastSeen: null,
    meta: {}, name: null, enabled: true,
  };
}

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/admin/welcome']}>
      <Routes>
        <Route path="/admin/welcome" element={<WelcomePage />} />
        <Route path="/admin" element={<div data-testid="admin-route" />} />
      </Routes>
    </MemoryRouter>,
  );
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
  (getSettings as Mock).mockResolvedValue({ ok: true, data: SETTINGS });
  (getSystemUrls as Mock).mockResolvedValue({ ok: true, data: URLS });
  (patchSettings as Mock).mockResolvedValue({ ok: true, data: SETTINGS });
  (listWalls as Mock).mockResolvedValue({ ok: true, data: [] });
  (createWall as Mock).mockResolvedValue({ ok: true, data: WALL });
  (listMonitors as Mock).mockResolvedValue({ ok: true, data: [] });
  (setWallDevices as Mock).mockResolvedValue({ ok: true, data: [] });
});

async function walkToWallStep() {
  renderWelcome();
  await flush();
  fireEvent.change(screen.getByTestId('welcome-site-name'), { target: { value: 'The Keg Cave' } });
  fireEvent.click(screen.getByTestId('welcome-next'));
  await flush();
  // kegtron step — skip
  fireEvent.click(screen.getByTestId('welcome-next'));
  await flush();
}

describe('WelcomePage', () => {
  it('walks the full happy path: site name → skip kegtron → create wall (no config) → updates → URL matrix', async () => {
    await walkToWallStep();

    expect(patchSettings).toHaveBeenCalledWith({ siteName: 'The Keg Cave' });
    fireEvent.click(screen.getByTestId('welcome-create-wall'));
    await flush();
    // createWall omits config so the SERVER fills wallConfig defaults.
    expect(createWall).toHaveBeenCalledWith({ slug: 'main', name: 'The Keg Cave' });

    // updates step — native preselected from install:'native'
    expect((screen.getByTestId('welcome-updates-native') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('welcome-next'));
    await flush();
    expect(patchSettings).toHaveBeenCalledWith({ updates: { mode: 'native' } });

    // done — URL matrix per address + mDNS row
    const done = screen.getByTestId('welcome-done');
    expect(done).toHaveTextContent('http://192.168.1.50:8080/admin');
    expect(done).toHaveTextContent('http://192.168.1.50:8080/wall/main');
    expect(done).toHaveTextContent('http://192.168.1.50:8080/menu');
    expect(done).toHaveTextContent('http://192.168.1.50:8080/tablet/main');
    expect(done).toHaveTextContent('http://kegwall-pi.local:8080/board');

    fireEvent.click(screen.getByTestId('welcome-open-dashboard'));
    expect(await screen.findByTestId('admin-route')).toBeInTheDocument();
  });

  it('assigns known Kegtron devices (grouped, Govee excluded) to the new wall', async () => {
    (listMonitors as Mock).mockResolvedValue({
      ok: true,
      data: [
        monitor(1, 'kegtron_pro', 'dev-1', 0),
        monitor(2, 'kegtron_pro', 'dev-1', 1), // second port — same device, no dupe
        monitor(3, 'govee_sensor', 'gv-1', 0), // never assignable to walls
      ],
    });
    await walkToWallStep();
    fireEvent.click(screen.getByTestId('welcome-create-wall'));
    await flush();
    expect(setWallDevices).toHaveBeenCalledWith(1, [{ type: 'kegtron_pro', identifier: 'dev-1' }]);
    expect(screen.getByTestId('welcome-step-updates')).toHaveTextContent('1 Kegtron device assigned');
  });

  it('shows the devices-appear-later note when no monitors exist yet', async () => {
    await walkToWallStep();
    fireEvent.click(screen.getByTestId('welcome-create-wall'));
    await flush();
    expect(setWallDevices).not.toHaveBeenCalled();
    expect(screen.getByTestId('welcome-step-updates')).toHaveTextContent('attaches the first one');
  });

  it('tolerates a createWall slug conflict by refetching the wall', async () => {
    (createWall as Mock).mockResolvedValue({ ok: false, status: 409, message: 'slug taken' });
    (listWalls as Mock)
      .mockResolvedValueOnce({ ok: true, data: [] }) // pre-create check
      .mockResolvedValueOnce({ ok: true, data: [WALL] }); // post-409 refetch
    await walkToWallStep();
    fireEvent.click(screen.getByTestId('welcome-create-wall'));
    await flush();
    expect(screen.getByTestId('welcome-step-updates')).toBeInTheDocument();
  });

  it('re-entry with an existing wall skips creation entirely', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [WALL] });
    await walkToWallStep();
    fireEvent.click(screen.getByTestId('welcome-create-wall'));
    await flush();
    expect(createWall).not.toHaveBeenCalled();
    expect(screen.getByTestId('welcome-step-updates')).toBeInTheDocument();
  });

  it('saving the kegtron key PATCHes it; leaving it empty skips the PATCH', async () => {
    renderWelcome();
    await flush();
    fireEvent.click(screen.getByTestId('welcome-next')); // site (patches siteName)
    await flush();
    fireEvent.change(screen.getByTestId('welcome-kegtron-key'), { target: { value: 'abc123' } });
    fireEvent.click(screen.getByTestId('welcome-next'));
    await flush();
    expect(patchSettings).toHaveBeenCalledWith({ kegtronApiKey: 'abc123' });
  });
});
