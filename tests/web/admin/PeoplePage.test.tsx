import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { PeoplePage } from '../../../src/web/routes/admin/PeoplePage';
import { listUsers, getFaceCounts } from '../../../src/web/lib/adminApi';
import { getPourers, getLeaderboard } from '../../../src/web/lib/api';
import { renderAdminPage, adminContext } from './renderAdminPage';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listUsers: vi.fn(),
  getFaceCounts: vi.fn(),
  createLoginUser: vi.fn(),
  createDrinkerProfile: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock('../../../src/web/lib/api', () => ({
  deleteFacesAdmin: vi.fn(),
  getPourers: vi.fn(),
  getLeaderboard: vi.fn(),
}));

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getPourers as Mock).mockResolvedValue({
    ok: true, data: [{ id: 1, displayName: 'Sam', avatarColor: null, pourCount: 5 }],
  });
  (getLeaderboard as Mock).mockResolvedValue({ ok: true, data: { window: 'all', entries: [], superlatives: {} } });
  (listUsers as Mock).mockResolvedValue({
    ok: true,
    data: [
      { id: 10, username: 'dan', displayName: 'Dan', role: 'admin', isDrinker: false, avatarColor: null, createdAt: '' },
      { id: 1, username: null, displayName: 'Sam', role: null, isDrinker: true, avatarColor: null, createdAt: '' },
    ],
  });
  (getFaceCounts as Mock).mockResolvedValue({ ok: true, data: [{ drinkerId: 1, count: 3 }] });
});

describe('PeoplePage (redesign 4h)', () => {
  it('shows a merged header count and both tabs for an admin', async () => {
    renderAdminPage(<PeoplePage />);
    await flush();
    // 1 login account, 1 pourer, 1 drinker with faces enrolled.
    expect(screen.getByTestId('people-summary')).toHaveTextContent('1 accounts · 1 pourers · 1 faces enrolled');
    expect(screen.getByTestId('people-tab-pourers')).toBeInTheDocument();
    expect(screen.getByTestId('people-tab-accounts')).toBeInTheDocument();
    // Pourers panel visible by default; accounts hidden.
    expect(screen.getByTestId('people-panel-pourers')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('people-panel-accounts')).toHaveAttribute('hidden');
    fireEvent.click(screen.getByTestId('people-tab-accounts'));
    expect(screen.getByTestId('people-panel-accounts')).not.toHaveAttribute('hidden');
  });

  it('hides the Accounts tab + account/face counts from a non-admin', async () => {
    renderAdminPage(<PeoplePage />, adminContext('editor'));
    await flush();
    expect(screen.queryByTestId('people-tab-accounts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('people-panel-accounts')).not.toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
    expect(screen.getByTestId('people-summary')).toHaveTextContent('1 pourers');
    expect(screen.getByTestId('people-summary')).not.toHaveTextContent('accounts');
  });
});
