import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LoginPage } from '../../../src/web/routes/admin/LoginPage';
import { login, needsSetup } from '../../../src/web/lib/adminApi';

// Spread the real module so the pure helpers LoginPage also imports (sanitizeNextPath —
// the ?next= open-redirect guard) keep their real behavior; only the network calls are
// mocked.
vi.mock('../../../src/web/lib/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/web/lib/adminApi')>()),
  login: vi.fn(),
  needsSetup: vi.fn(),
}));

function renderLoginPage(initialEntry = '/admin/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin/setup" element={<div data-testid="setup-route" />} />
        <Route path="/admin" element={<div data-testid="admin-route" />} />
        <Route path="/admin/beers" element={<div data-testid="beers-route" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(username: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (needsSetup as Mock).mockResolvedValue({ ok: true, data: { needsSetup: false } });
  });

  it('redirects to /admin/setup when no admin has been set up yet', async () => {
    (needsSetup as Mock).mockResolvedValue({ ok: true, data: { needsSetup: true } });
    renderLoginPage();
    expect(await screen.findByTestId('setup-route')).toBeInTheDocument();
  });

  it('renders the login form once setup is confirmed done', async () => {
    renderLoginPage();
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('shows a bad-credentials message on 401 and does not navigate', async () => {
    (login as Mock).mockResolvedValue({ ok: false, status: 401, message: 'Bad username or password' });
    renderLoginPage();
    await fillAndSubmit('dan', 'wrong');
    expect(await screen.findByText(/wrong username or password/i)).toBeInTheDocument();
    expect(screen.queryByTestId('admin-route')).not.toBeInTheDocument();
  });

  it('shows a rate-limit message on 429', async () => {
    (login as Mock).mockResolvedValue({ ok: false, status: 429, message: 'Rate limit exceeded' });
    renderLoginPage();
    await fillAndSubmit('dan', 'hunter22');
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  it('navigates to /admin on a successful login', async () => {
    (login as Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 1, username: 'dan', displayName: 'Dan', role: 'admin', isDrinker: false, avatarColor: null, createdAt: '2026-07-28T00:00:00.000Z',
      },
    });
    renderLoginPage();
    await fillAndSubmit('dan', 'hunter22');
    expect(await screen.findByTestId('admin-route')).toBeInTheDocument();
  });

  it('follows a safe ?next= back to the interrupted page after a successful login', async () => {
    (login as Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 1, username: 'dan', displayName: 'Dan', role: 'admin', isDrinker: false, avatarColor: null, createdAt: '2026-07-28T00:00:00.000Z',
      },
    });
    renderLoginPage('/admin/login?next=%2Fadmin%2Fbeers');
    await fillAndSubmit('dan', 'hunter22');
    expect(await screen.findByTestId('beers-route')).toBeInTheDocument();
  });

  it('ignores an unsafe ?next= (open-redirect guard) and lands on the dashboard', async () => {
    (login as Mock).mockResolvedValue({
      ok: true,
      data: {
        id: 1, username: 'dan', displayName: 'Dan', role: 'admin', isDrinker: false, avatarColor: null, createdAt: '2026-07-28T00:00:00.000Z',
      },
    });
    renderLoginPage(`/admin/login?next=${encodeURIComponent('//evil.example/phish')}`);
    await fillAndSubmit('dan', 'hunter22');
    expect(await screen.findByTestId('admin-route')).toBeInTheDocument();
  });

  it('calls login with the entered username and password', async () => {
    (login as Mock).mockResolvedValue({ ok: false, status: 401, message: 'Bad username or password' });
    renderLoginPage();
    await fillAndSubmit('dan', 'hunter22');
    expect(login).toHaveBeenCalledWith('dan', 'hunter22');
  });
});
