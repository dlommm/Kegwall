import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen, within,
} from '@testing-library/react';
import { UsersPage } from '../../../src/web/routes/admin/UsersPage';
import {
  listUsers, createLoginUser, createDrinkerProfile, updateUser, deleteUser, getFaceCounts,
} from '../../../src/web/lib/adminApi';
import { deleteFaces } from '../../../src/web/lib/api';
import type { User } from '../../../src/server/db/users';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listUsers: vi.fn(),
  createLoginUser: vi.fn(),
  createDrinkerProfile: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  getFaceCounts: vi.fn(),
}));

// Task 9 (Plan B): "Delete face data" reuses the public DELETE (works while face
// sign-in is disabled — see routes/public.ts) rather than an admin-only route.
vi.mock('../../../src/web/lib/api', () => ({
  deleteFaces: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeLoginUser(overrides: Partial<User> = {}): User {
  return {
    id: 1, username: 'dan', displayName: 'Dan', role: 'admin', isDrinker: true,
    avatarColor: '#c9a227', createdAt: '2026-07-28T00:00:00.000Z', ...overrides,
  };
}

function makeDrinker(overrides: Partial<User> = {}): User {
  return {
    id: 2, username: null, displayName: 'Drinker Dan', role: null, isDrinker: true,
    avatarColor: '#00aaff', createdAt: '2026-07-28T00:00:00.000Z', ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listUsers as Mock).mockResolvedValue({ ok: true, data: [] });
  (getFaceCounts as Mock).mockResolvedValue({ ok: true, data: [] });
});

describe('UsersPage', () => {
  it('shows a quiet empty state with no users', async () => {
    render(<UsersPage />);
    expect(await screen.findByTestId('users-empty')).toBeInTheDocument();
  });

  it('renders a row per user with role badge, drinker flag, and an avatar color dot', async () => {
    (listUsers as Mock).mockResolvedValue({
      ok: true,
      data: [makeLoginUser({ role: 'editor', isDrinker: false }), makeDrinker()],
    });
    render(<UsersPage />);
    const rows = await screen.findAllByTestId('users-row');
    expect(rows).toHaveLength(2);

    const loginRow = rows[0]!;
    expect(within(loginRow).getByTestId('users-row-role')).toHaveTextContent('Editor');
    expect(within(loginRow).getByTestId('users-row-drinker-none')).toBeInTheDocument();
    expect(within(loginRow).getByTestId('users-row-username')).toHaveTextContent('@dan');
    expect(within(loginRow).getByTestId('users-row-avatar')).toHaveStyle({ backgroundColor: '#c9a227' });

    const drinkerRow = rows[1]!;
    expect(within(drinkerRow).getByTestId('users-row-role')).toHaveTextContent('No login');
    expect(within(drinkerRow).getByTestId('users-row-drinker')).toHaveTextContent('Drinker');
    expect(within(drinkerRow).queryByTestId('users-row-username')).not.toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    (listUsers as Mock).mockResolvedValue({ ok: false, status: 500, message: 'nope' });
    render(<UsersPage />);
    expect(await screen.findByTestId('users-error')).toBeInTheDocument();
  });

  it('"Add user" opens a chooser between a login user and a drinker profile', async () => {
    render(<UsersPage />);
    await screen.findByTestId('users-empty');
    fireEvent.click(screen.getByTestId('users-add-button'));
    expect(screen.getByTestId('users-choose')).toBeInTheDocument();
    expect(screen.queryByTestId('users-login-form')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('users-choose-login'));
    expect(screen.getByTestId('users-login-form')).toBeInTheDocument();
  });

  it('creates a login user with username/password/role and refreshes the list', async () => {
    (createLoginUser as Mock).mockResolvedValue({ ok: true, data: makeLoginUser() });
    render(<UsersPage />);
    await screen.findByTestId('users-empty');
    fireEvent.click(screen.getByTestId('users-add-button'));
    fireEvent.click(screen.getByTestId('users-choose-login'));

    fireEvent.change(screen.getByTestId('users-login-username'), { target: { value: 'newadmin' } });
    fireEvent.change(screen.getByTestId('users-login-displayname'), { target: { value: 'New Admin' } });
    fireEvent.change(screen.getByTestId('users-login-password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByTestId('users-login-role'), { target: { value: 'editor' } });
    fireEvent.click(screen.getByTestId('users-login-submit'));
    await flush();

    expect(createLoginUser).toHaveBeenCalledWith({
      username: 'newadmin', displayName: 'New Admin', password: 'password123', role: 'editor',
    });
    expect(listUsers).toHaveBeenCalledTimes(2); // initial load + refresh after save
    expect(screen.queryByTestId('users-login-form')).not.toBeInTheDocument();
  });

  it('validates the login form client-side before submitting (short password)', async () => {
    render(<UsersPage />);
    await screen.findByTestId('users-empty');
    fireEvent.click(screen.getByTestId('users-add-button'));
    fireEvent.click(screen.getByTestId('users-choose-login'));

    fireEvent.change(screen.getByTestId('users-login-username'), { target: { value: 'x' } });
    fireEvent.change(screen.getByTestId('users-login-displayname'), { target: { value: 'X' } });
    fireEvent.change(screen.getByTestId('users-login-password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('users-login-submit'));

    expect(screen.getByTestId('users-login-validation-error')).toBeInTheDocument();
    expect(createLoginUser).not.toHaveBeenCalled();
  });

  it('creates a drinker profile with just display name + avatar color, no password/role fields', async () => {
    (createDrinkerProfile as Mock).mockResolvedValue({ ok: true, data: makeDrinker() });
    render(<UsersPage />);
    await screen.findByTestId('users-empty');
    fireEvent.click(screen.getByTestId('users-add-button'));
    fireEvent.click(screen.getByTestId('users-choose-drinker'));

    expect(screen.queryByTestId('users-drinker-password')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('users-drinker-displayname'), { target: { value: 'Newbie' } });
    fireEvent.change(screen.getByTestId('users-drinker-avatarcolor'), { target: { value: '#112233' } });
    fireEvent.click(screen.getByTestId('users-drinker-submit'));
    await flush();

    expect(createDrinkerProfile).toHaveBeenCalledWith({ displayName: 'Newbie', avatarColor: '#112233' });
  });

  it('editing a login user shows role + password fields; editing a drinker profile does not', async () => {
    (listUsers as Mock).mockResolvedValue({ ok: true, data: [makeLoginUser(), makeDrinker()] });
    render(<UsersPage />);
    const rows = await screen.findAllByTestId('users-row');

    fireEvent.click(within(rows[0]!).getByTestId('users-row-edit'));
    expect(screen.getByTestId('users-edit-role')).toBeInTheDocument();
    expect(screen.getByTestId('users-edit-password')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('users-edit-cancel'));

    fireEvent.click(within(rows[1]!).getByTestId('users-row-edit'));
    expect(screen.queryByTestId('users-edit-role')).not.toBeInTheDocument();
    expect(screen.queryByTestId('users-edit-password')).not.toBeInTheDocument();
    expect(screen.getByTestId('users-edit-displayname')).toHaveValue('Drinker Dan');
  });

  it('saves an edit: display name, role, optional password (omitted when blank), avatar color', async () => {
    (listUsers as Mock).mockResolvedValue({ ok: true, data: [makeLoginUser()] });
    (updateUser as Mock).mockResolvedValue({ ok: true, data: makeLoginUser({ displayName: 'Renamed' }) });
    render(<UsersPage />);
    const [row] = await screen.findAllByTestId('users-row');
    fireEvent.click(within(row!).getByTestId('users-row-edit'));

    fireEvent.change(screen.getByTestId('users-edit-displayname'), { target: { value: 'Renamed' } });
    fireEvent.change(screen.getByTestId('users-edit-role'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByTestId('users-edit-submit'));
    await flush();

    expect(updateUser).toHaveBeenCalledWith(1, {
      displayName: 'Renamed', avatarColor: '#c9a227', role: 'viewer',
    });
  });

  it('includes a new password in the edit payload only when one was typed', async () => {
    (listUsers as Mock).mockResolvedValue({ ok: true, data: [makeLoginUser()] });
    (updateUser as Mock).mockResolvedValue({ ok: true, data: makeLoginUser() });
    render(<UsersPage />);
    const [row] = await screen.findAllByTestId('users-row');
    fireEvent.click(within(row!).getByTestId('users-row-edit'));

    fireEvent.change(screen.getByTestId('users-edit-password'), { target: { value: 'newpassword1' } });
    fireEvent.click(screen.getByTestId('users-edit-submit'));
    await flush();

    const call = (updateUser as Mock).mock.calls[0]!;
    expect(call[1].password).toBe('newpassword1');
  });

  it('delete asks for confirmation with a consequence sentence before calling the API', async () => {
    (listUsers as Mock).mockResolvedValue({ ok: true, data: [makeLoginUser()] });
    render(<UsersPage />);
    const [row] = await screen.findAllByTestId('users-row');
    fireEvent.click(within(row!).getByTestId('users-row-delete'));

    expect(screen.getByTestId('users-delete-confirm')).toBeInTheDocument();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/permanently delete/i);
  });

  it('surfaces the last-admin 409 with a clear, specific message', async () => {
    (listUsers as Mock).mockResolvedValue({ ok: true, data: [makeLoginUser()] });
    (deleteUser as Mock).mockResolvedValue({
      ok: false, status: 409, message: 'cannot delete the last admin',
    });
    render(<UsersPage />);
    const [row] = await screen.findAllByTestId('users-row');
    fireEvent.click(within(row!).getByTestId('users-row-delete'));
    fireEvent.click(screen.getByTestId('users-delete-confirm-button'));
    await flush();

    expect(screen.getByTestId('users-delete-error')).toHaveTextContent(/can.t delete the last admin/i);
  });

  it('deletes on confirm and refreshes the list', async () => {
    (listUsers as Mock).mockResolvedValue({ ok: true, data: [makeLoginUser()] });
    (deleteUser as Mock).mockResolvedValue({ ok: true, data: null });
    render(<UsersPage />);
    const [row] = await screen.findAllByTestId('users-row');
    fireEvent.click(within(row!).getByTestId('users-row-delete'));
    fireEvent.click(screen.getByTestId('users-delete-confirm-button'));
    await flush();

    expect(deleteUser).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('users-delete-confirm')).not.toBeInTheDocument();
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  // Task 9 (Plan B): per-drinker face sample count + "Delete face data", fed by
  // GET /api/faces/counts (admin-authed) and DELETE /api/public/faces/drinker/:id
  // (the same public route the tablet's armed-screen removal action already uses).
  describe('face-data management', () => {
    it('shows "N face samples" and a delete button only for a drinker with count > 0', async () => {
      (listUsers as Mock).mockResolvedValue({
        ok: true, data: [makeLoginUser({ isDrinker: false }), makeDrinker()],
      });
      (getFaceCounts as Mock).mockResolvedValue({ ok: true, data: [{ drinkerId: 2, count: 2 }] });
      render(<UsersPage />);
      const rows = await screen.findAllByTestId('users-row');

      const loginRow = rows[0]!;
      expect(within(loginRow).queryByTestId('face-data-delete')).not.toBeInTheDocument();

      const drinkerRow = rows[1]!;
      expect(within(drinkerRow).getByText('2 face samples')).toBeInTheDocument();
      expect(within(drinkerRow).getByTestId('face-data-delete')).toBeInTheDocument();
    });

    it('a drinker with no enrolled faces shows neither the count nor the delete button', async () => {
      (listUsers as Mock).mockResolvedValue({ ok: true, data: [makeDrinker()] });
      (getFaceCounts as Mock).mockResolvedValue({ ok: true, data: [] });
      render(<UsersPage />);
      const [row] = await screen.findAllByTestId('users-row');

      expect(within(row!).queryByTestId('face-data-delete')).not.toBeInTheDocument();
    });

    it('clicking "Delete face data" calls deleteFaces(drinkerId) and refetches counts', async () => {
      (listUsers as Mock).mockResolvedValue({ ok: true, data: [makeDrinker()] });
      (getFaceCounts as Mock).mockResolvedValue({ ok: true, data: [{ drinkerId: 2, count: 3 }] });
      (deleteFaces as Mock).mockResolvedValue({ ok: true, data: { deleted: 3 } });
      render(<UsersPage />);
      const [row] = await screen.findAllByTestId('users-row');
      expect(getFaceCounts).toHaveBeenCalledTimes(1);

      fireEvent.click(within(row!).getByTestId('face-data-delete'));
      await flush();

      expect(deleteFaces).toHaveBeenCalledWith(2);
      expect(getFaceCounts).toHaveBeenCalledTimes(2); // initial load + refresh after delete
    });
  });
});
