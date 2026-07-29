import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { NotificationsPage } from '../../../src/web/routes/admin/NotificationsPage';
import {
  listNotifications, ackNotification, ackAllNotifications,
} from '../../../src/web/lib/adminApi';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listNotifications: vi.fn(),
  ackNotification: vi.fn(),
  ackAllNotifications: vi.fn(),
}));

function notification(overrides: Partial<{
  id: number; title: string; severity: 'info' | 'warning' | 'critical'; acked: boolean;
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

function page(count: number, startId: number, opts: Partial<{ acked: boolean }> = {}) {
  return Array.from({ length: count }, (_, i) => notification({
    id: startId - i, title: `Notification ${startId - i}`, acked: opts.acked ?? false,
  }));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotificationsPage', () => {
  it('loads and renders the first page of notifications', async () => {
    (listNotifications as Mock).mockResolvedValue({ ok: true, data: page(25, 100) });
    renderAdminPage(<NotificationsPage />);
    await screen.findAllByTestId('notification-row');
    expect(listNotifications).toHaveBeenCalledWith({ limit: 25 });
    expect(screen.getAllByTestId('notification-row')).toHaveLength(25);
  });

  it('shows a quiet empty state with no notifications', async () => {
    (listNotifications as Mock).mockResolvedValue({ ok: true, data: [] });
    renderAdminPage(<NotificationsPage />);
    expect(await screen.findByTestId('notifications-page-empty')).toBeInTheDocument();
  });

  it('"Load more" fetches the next page using the last row\'s id as the before-cursor and appends it', async () => {
    (listNotifications as Mock)
      .mockResolvedValueOnce({ ok: true, data: page(25, 100) })
      .mockResolvedValueOnce({ ok: true, data: page(10, 75) });
    renderAdminPage(<NotificationsPage />);
    await screen.findAllByTestId('notification-row');

    fireEvent.click(screen.getByTestId('notifications-page-load-more'));
    await flush();

    expect(listNotifications).toHaveBeenLastCalledWith({ limit: 25, before: 76 });
    expect(screen.getAllByTestId('notification-row')).toHaveLength(35);
  });

  it('hides "Load more" once a page comes back shorter than the page size (no more pages)', async () => {
    (listNotifications as Mock).mockResolvedValue({ ok: true, data: page(5, 100) });
    renderAdminPage(<NotificationsPage />);
    await screen.findAllByTestId('notification-row');
    expect(screen.queryByTestId('notifications-page-load-more')).not.toBeInTheDocument();
  });

  it('acking a row via the shared NotificationRow removes its ack button', async () => {
    (listNotifications as Mock).mockResolvedValue({ ok: true, data: page(3, 100) });
    (ackNotification as Mock).mockResolvedValue({ ok: true, data: notification({ id: 100, acked: true }) });
    renderAdminPage(<NotificationsPage />);
    await screen.findAllByTestId('notification-row');

    fireEvent.click(screen.getByTestId('notification-row-ack-100'));
    await flush();

    expect(ackNotification).toHaveBeenCalledWith(100);
    expect(screen.queryByTestId('notification-row-ack-100')).not.toBeInTheDocument();
  });

  it('"Mark all read" acks every loaded row', async () => {
    (listNotifications as Mock).mockResolvedValue({ ok: true, data: page(3, 100) });
    (ackAllNotifications as Mock).mockResolvedValue({ ok: true, data: { count: 3 } });
    renderAdminPage(<NotificationsPage />);
    await screen.findAllByTestId('notification-row');

    fireEvent.click(screen.getByTestId('notifications-page-mark-all-read'));
    await flush();

    expect(ackAllNotifications).toHaveBeenCalled();
    expect(screen.queryAllByTestId(/notification-row-ack-/)).toHaveLength(0);
  });

  it('a viewer can still ack (acking is not role-gated)', async () => {
    (listNotifications as Mock).mockResolvedValue({ ok: true, data: page(1, 100) });
    (ackNotification as Mock).mockResolvedValue({ ok: true, data: notification({ id: 100, acked: true }) });
    renderAdminPage(<NotificationsPage />, adminContext('viewer'));
    await screen.findAllByTestId('notification-row');
    expect(screen.getByTestId('notification-row-ack-100')).toBeInTheDocument();
  });

  it('shows an error state when the initial load fails', async () => {
    (listNotifications as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Something went wrong' });
    renderAdminPage(<NotificationsPage />);
    expect(await screen.findByTestId('notifications-page-error')).toBeInTheDocument();
  });
});
