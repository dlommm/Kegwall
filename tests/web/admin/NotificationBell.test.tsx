import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from '../../../src/web/routes/admin/NotificationBell';
import {
  getUnackedCount, listNotifications, ackNotification, ackAllNotifications,
} from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', () => ({
  getUnackedCount: vi.fn(),
  listNotifications: vi.fn(),
  ackNotification: vi.fn(),
  ackAllNotifications: vi.fn(),
}));

let capturedOnCount: ((count: number) => void) | null = null;

vi.mock('../../../src/web/lib/useAdminNotifications', () => ({
  useAdminNotifications: (onCount: (count: number) => void) => {
    capturedOnCount = onCount;
    return { connected: true };
  },
}));

function notification(overrides: Partial<{
  id: number; title: string; body: string | null; severity: 'info' | 'warning' | 'critical'; acked: boolean;
}> = {}) {
  return {
    id: 1,
    automationId: null,
    ts: '2026-07-28T00:00:00.000Z',
    severity: 'info' as const,
    title: 'Keg running low',
    body: null,
    acked: false,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnCount = null;
  (getUnackedCount as Mock).mockResolvedValue({ ok: true, data: { count: 0 } });
  (listNotifications as Mock).mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotificationBell', () => {
  it('shows no badge when the unacked count is 0', async () => {
    renderBell();
    await flush();
    expect(screen.queryByTestId('notification-bell-badge')).not.toBeInTheDocument();
  });

  it('shows the unacked count from the initial fetch', async () => {
    (getUnackedCount as Mock).mockResolvedValue({ ok: true, data: { count: 3 } });
    renderBell();
    expect(await screen.findByTestId('notification-bell-badge')).toHaveTextContent('3');
  });

  it('updates the badge live from a WS nudge', async () => {
    renderBell();
    await flush();
    expect(screen.queryByTestId('notification-bell-badge')).not.toBeInTheDocument();

    act(() => { capturedOnCount?.(5); });
    expect(await screen.findByTestId('notification-bell-badge')).toHaveTextContent('5');
  });

  it('caps a large badge count at "99+"', async () => {
    renderBell();
    await flush();
    act(() => { capturedOnCount?.(150); });
    expect(await screen.findByTestId('notification-bell-badge')).toHaveTextContent('99+');
  });

  it('clicking the bell opens the panel and loads the 10 most recent notifications', async () => {
    (listNotifications as Mock).mockResolvedValue({ ok: true, data: [notification({ id: 1 }), notification({ id: 2, title: 'Second' })] });
    renderBell();
    await flush();

    expect(screen.queryByTestId('notification-bell-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('notification-bell-button'));
    expect(listNotifications).toHaveBeenCalledWith({ limit: 10 });
    await flush();

    expect(screen.getByTestId('notification-bell-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId('notification-row')).toHaveLength(2);
  });

  it('shows a quiet empty state with no notifications', async () => {
    renderBell();
    await flush();
    fireEvent.click(screen.getByTestId('notification-bell-button'));
    await flush();
    expect(screen.getByTestId('notification-panel-empty')).toBeInTheDocument();
  });

  it('acking a single notification removes its ack button and decrements the badge', async () => {
    (getUnackedCount as Mock).mockResolvedValue({ ok: true, data: { count: 1 } });
    (listNotifications as Mock).mockResolvedValue({ ok: true, data: [notification({ id: 7 })] });
    (ackNotification as Mock).mockResolvedValue({ ok: true, data: notification({ id: 7, acked: true }) });

    renderBell();
    await screen.findByTestId('notification-bell-badge');
    fireEvent.click(screen.getByTestId('notification-bell-button'));
    await flush();

    fireEvent.click(screen.getByTestId('notification-row-ack-7'));
    await flush();

    expect(ackNotification).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId('notification-row-ack-7')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notification-bell-badge')).not.toBeInTheDocument();
  });

  it('"Mark all read" acks everything and zeroes the badge', async () => {
    (getUnackedCount as Mock).mockResolvedValue({ ok: true, data: { count: 2 } });
    (listNotifications as Mock).mockResolvedValue({
      ok: true, data: [notification({ id: 1 }), notification({ id: 2 })],
    });
    (ackAllNotifications as Mock).mockResolvedValue({ ok: true, data: { count: 2 } });

    renderBell();
    await screen.findByTestId('notification-bell-badge');
    fireEvent.click(screen.getByTestId('notification-bell-button'));
    await flush();

    fireEvent.click(screen.getByTestId('notification-mark-all-read'));
    await flush();

    expect(ackAllNotifications).toHaveBeenCalled();
    expect(screen.queryByTestId('notification-bell-badge')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/notification-row-ack-/)).toHaveLength(0);
  });

  it('the "View all" link points at /admin/notifications', async () => {
    renderBell();
    await flush();
    fireEvent.click(screen.getByTestId('notification-bell-button'));
    await flush();
    expect(screen.getByTestId('notification-panel-view-all')).toHaveAttribute('href', '/admin/notifications');
  });

  it('clicking outside the panel closes it', async () => {
    render(
      <MemoryRouter>
        <div>
          <NotificationBell />
          <button type="button" data-testid="outside">Outside</button>
        </div>
      </MemoryRouter>,
    );
    await flush();
    fireEvent.click(screen.getByTestId('notification-bell-button'));
    await flush();
    expect(screen.getByTestId('notification-bell-panel')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('notification-bell-panel')).not.toBeInTheDocument();
  });
});
