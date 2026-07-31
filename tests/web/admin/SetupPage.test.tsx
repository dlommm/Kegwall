import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SetupPage } from '../../../src/web/routes/admin/SetupPage';
import { needsSetup, setup } from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', () => ({
  needsSetup: vi.fn(),
  setup: vi.fn(),
}));

function renderSetupPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/setup']}>
      <Routes>
        <Route path="/admin/setup" element={<SetupPage />} />
        <Route path="/admin/login" element={<div data-testid="login-route" />} />
        <Route path="/admin/welcome" element={<div data-testid="welcome-route" />} />
        <Route path="/admin" element={<div data-testid="admin-route" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillForm({
  username = 'dan', displayName = 'Dan', password = 'hunter222', confirm = 'hunter222',
}: Partial<Record<'username' | 'displayName' | 'password' | 'confirm', string>> = {}) {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: displayName } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (needsSetup as Mock).mockResolvedValue({ ok: true, data: { needsSetup: true } });
  });

  it('redirects to /admin/login when setup has already run', async () => {
    (needsSetup as Mock).mockResolvedValue({ ok: true, data: { needsSetup: false } });
    renderSetupPage();
    expect(await screen.findByTestId('login-route')).toBeInTheDocument();
  });

  it('renders the setup form when no admin exists yet', async () => {
    renderSetupPage();
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('flags a password under 8 characters and does not submit', async () => {
    renderSetupPage();
    await fillForm({ password: 'short1', confirm: 'short1' });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(setup).not.toHaveBeenCalled();
  });

  it('flags mismatched password confirmation and does not submit', async () => {
    renderSetupPage();
    await fillForm({ password: 'hunter222', confirm: 'different1' });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/don.t match/i)).toBeInTheDocument();
    expect(setup).not.toHaveBeenCalled();
  });

  it('creates the account and hands off to the /admin/welcome wizard on success', async () => {
    (setup as Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 1, username: 'dan', displayName: 'Dan', role: 'admin', isDrinker: true, avatarColor: null, createdAt: '2026-07-28T00:00:00.000Z',
      },
    });
    renderSetupPage();
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByTestId('welcome-route')).toBeInTheDocument();
    expect(setup).toHaveBeenCalledWith({ username: 'dan', displayName: 'Dan', password: 'hunter222' });
  });

  it('surfaces the server error message on failure (e.g. a race with another setup)', async () => {
    (setup as Mock).mockResolvedValue({ ok: false, status: 409, message: 'Setup already completed' });
    renderSetupPage();
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Setup already completed')).toBeInTheDocument();
  });
});
