import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../../../src/web/routes/admin/AdminLayout';
import { useAdminContext } from '../../../src/web/routes/admin/useAdminContext';

// AdminLayout is tested against a REAL adminApi (mocked at the `fetch` layer, not the
// module layer) so the unauthenticated case genuinely exercises adminApi's own 401 ->
// redirect behavior (already unit-tested in isolation in adminApi.test.ts) as it's
// actually wired up here, rather than asserting on a mock that could silently drift
// from the real implementation.
function mockFetchOnce(status: number, body: unknown) {
  const ok = status >= 200 && status < 300;
  (globalThis.fetch as Mock).mockResolvedValueOnce({
    ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body,
  } as Response);
}

function user(overrides: Partial<{ role: 'admin' | 'editor' | 'viewer'; displayName: string }> = {}) {
  return {
    id: 1, username: 'dan', displayName: 'Dan', role: 'admin', isDrinker: false, avatarColor: null, createdAt: '2026-07-28T00:00:00.000Z', ...overrides,
  };
}

/** Reads the Outlet context via the real hook, so this test genuinely exercises what a
 * page component would see — not a re-implementation of the context shape. */
function ContextProbe() {
  const { me, units } = useAdminContext();
  return (
    <div data-testid="context-probe" data-role={me.role} data-units={units}>
      {me.displayName}
    </div>
  );
}

function renderLayout(initialEntry = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/login" element={<div data-testid="login-route" />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<div data-testid="dashboard-placeholder" />} />
          <Route path="users" element={<div data-testid="users-placeholder" />} />
          <Route path="probe" element={<ContextProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const originalLocation = window.location;
let assignMock: Mock;

describe('AdminLayout', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // AdminLayout now ALSO fetches the public menu (for `units`, passed down via Outlet
    // context — see useAdminContext.ts) alongside `getMe()`. Individual tests below only
    // ever queue a response for the getMe() call via mockFetchOnce (mockResolvedValueOnce,
    // which takes priority for the NEXT call only); this default catches every fetch
    // AFTER that — i.e. the units fetch — so it resolves instead of leaving the mock
    // returning `undefined` (an unhandled rejection reading `.ok` off it).
    (globalThis.fetch as Mock).mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => (String(url).includes('/api/system/version')
        ? { version: '9.9.9' }
        : { siteName: 'Test', taps: [], units: 'us' }),
    } as Response));
    assignMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname: '/admin', assign: assignMock },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('redirects to login when unauthenticated, without rendering the shell', async () => {
    mockFetchOnce(401, { error: 'unauthorized', message: 'Not logged in' });
    renderLayout();
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/admin/login'));
    expect(screen.queryByTestId('dashboard-placeholder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-layout')).not.toBeInTheDocument();
  });

  it('renders the sidebar and nested route for an authenticated admin', async () => {
    mockFetchOnce(200, user({ role: 'admin' }));
    renderLayout();
    expect(await screen.findByTestId('dashboard-placeholder')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Beers')).toBeInTheDocument();
  });

  it('shows the running version in the sidebar footer', async () => {
    mockFetchOnce(200, user({ role: 'admin' }));
    renderLayout();
    expect(await screen.findByTestId('admin-nav-version')).toHaveTextContent('v9.9.9');
  });

  it('hides Users and Settings for an editor', async () => {
    mockFetchOnce(200, user({ role: 'editor' }));
    renderLayout();
    await screen.findByTestId('dashboard-placeholder');
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    expect(screen.getByText('Beers')).toBeInTheDocument();
  });

  it('hides Users and Settings for a viewer, but still shows the rest of the nav', async () => {
    mockFetchOnce(200, user({ role: 'viewer' }));
    renderLayout();
    await screen.findByTestId('dashboard-placeholder');
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    expect(screen.getByText('Monitors')).toBeInTheDocument();
    expect(screen.getByText('Logs')).toBeInTheDocument();
  });

  it('shows the signed-in user\'s display name in a user chip', async () => {
    mockFetchOnce(200, user({ displayName: 'Dan Lomm' }));
    renderLayout();
    expect(await screen.findByTestId('admin-user-chip')).toHaveTextContent('Dan Lomm');
  });

  it('route-guards an admin-only page: a viewer navigating straight to /admin/users bounces to the dashboard', async () => {
    mockFetchOnce(200, user({ role: 'viewer' }));
    renderLayout('/admin/users');
    expect(await screen.findByTestId('dashboard-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('users-placeholder')).not.toBeInTheDocument();
  });

  it('lets an admin reach the admin-only /admin/users route directly', async () => {
    mockFetchOnce(200, user({ role: 'admin' }));
    renderLayout('/admin/users');
    expect(await screen.findByTestId('users-placeholder')).toBeInTheDocument();
  });

  it('provides {me, units} to nested pages via Outlet context', async () => {
    mockFetchOnce(200, user({ role: 'editor', displayName: 'Context Carl' }));
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ siteName: 'Test', taps: [], units: 'metric' }),
    } as Response);
    renderLayout('/admin/probe');
    const probe = await screen.findByTestId('context-probe');
    expect(probe).toHaveTextContent('Context Carl');
    expect(probe).toHaveAttribute('data-role', 'editor');
    await waitFor(() => expect(probe).toHaveAttribute('data-units', 'metric'));
  });

  it('signs out and navigates to login', async () => {
    mockFetchOnce(200, user());
    renderLayout();
    await screen.findByTestId('dashboard-placeholder');

    mockFetchOnce(200, { ok: true });
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByTestId('login-route')).toBeInTheDocument();
  });
});
