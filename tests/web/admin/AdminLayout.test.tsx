import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
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
          <Route path="beers" element={<div data-testid="beers-placeholder" />} />
          <Route path="users" element={<div data-testid="users-placeholder" />} />
          <Route path="monitors" element={<div data-testid="monitors-placeholder" />} />
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
    // The 401 redirect carries the interrupted page in ?next= (mocked pathname: /admin)
    // so LoginPage can send the admin back after re-login — see lib/adminApi.ts.
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/admin/login?next=%2Fadmin'));
    expect(screen.queryByTestId('dashboard-placeholder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-layout')).not.toBeInTheDocument();
  });

  it('renders the top bar and nested route for an authenticated admin', async () => {
    mockFetchOnce(200, user({ role: 'admin' }));
    renderLayout();
    expect(await screen.findByTestId('dashboard-placeholder')).toBeInTheDocument();
    const bar = screen.getByRole('navigation', { name: 'Admin' });
    for (const label of ['Tonight', 'Taps & kegs', 'Beers', 'People', 'Screens', 'Insights', 'Settings']) {
      expect(within(bar).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(bar).getByRole('link', { name: 'Tonight' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the running version and the signed-in user in the account menu', async () => {
    mockFetchOnce(200, user({ role: 'admin', displayName: 'Dan Lomm' }));
    renderLayout();
    await screen.findByTestId('dashboard-placeholder');
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/system/version'), expect.anything()));
    fireEvent.keyDown(screen.getByTestId('admin-account'), { key: 'Enter' });
    expect(await screen.findByTestId('admin-nav-version')).toHaveTextContent('Kegwall v9.9.9');
    expect(screen.getByTestId('admin-user-chip')).toHaveTextContent('Dan Lomm');
  });

  it('shows the current destination\'s sub-tabs, linking the existing admin URLs', async () => {
    mockFetchOnce(200, user({ role: 'admin' }));
    renderLayout('/admin/beers');
    await screen.findByTestId('beers-placeholder');
    expect(screen.queryByTestId('admin-subtabs')).not.toBeInTheDocument();
    cleanup();
    mockFetchOnce(200, user({ role: 'admin' }));
    renderLayout('/admin/users');
    await screen.findByTestId('users-placeholder');
    // People has no sub-tabs of its own (its page carries Pourers / Accounts), but the
    // legacy /admin/users deep link still lights People in the bar.
    expect(within(screen.getByRole('navigation', { name: 'Admin' })).getByRole('link', { name: 'People' }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('hides admin-only sub-tabs from an editor and points Settings at what they can open', async () => {
    mockFetchOnce(200, user({ role: 'editor' }));
    renderLayout('/admin/monitors');
    const tabs = await screen.findByTestId('admin-subtabs');
    expect(within(tabs).getByRole('link', { name: 'Taps' })).toBeInTheDocument();
    expect(within(tabs).getByRole('link', { name: 'Monitors' })).toBeInTheDocument();
    expect(within(tabs).queryByRole('link', { name: 'Kegs' })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole('link', { name: 'Suppliers' })).not.toBeInTheDocument();
    const bar = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(bar).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/automations');
  });

  it('opens the phone menu and closes it after choosing a page', async () => {
    mockFetchOnce(200, user());
    renderLayout();
    await screen.findByTestId('dashboard-placeholder');

    const menu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    const sheet = await screen.findByTestId('admin-phone-menu');
    fireEvent.click(within(sheet).getByRole('link', { name: 'Beers' }));
    expect(await screen.findByTestId('beers-placeholder')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('admin-phone-menu')).not.toBeInTheDocument());
  });

  it('opens the Ctrl K palette from anywhere and goes to the chosen page', async () => {
    mockFetchOnce(200, user());
    renderLayout();
    await screen.findByTestId('dashboard-placeholder');

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = await screen.findByTestId('admin-palette-input');
    fireEvent.change(input, { target: { value: 'beer' } });
    expect(screen.getAllByTestId('admin-palette-item')[0]).toHaveTextContent('Beers');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByTestId('beers-placeholder')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('admin-palette')).not.toBeInTheDocument());
  });

  it('never offers an editor an admin-only page in the palette', async () => {
    mockFetchOnce(200, user({ role: 'editor' }));
    renderLayout();
    await screen.findByTestId('dashboard-placeholder');
    fireEvent.click(screen.getByTestId('admin-search'));
    const items = (await screen.findAllByTestId('admin-palette-item')).map((el) => el.textContent);
    expect(items.some((t) => t?.startsWith('Kegs'))).toBe(false);
    expect(items.some((t) => t?.startsWith('Suppliers'))).toBe(false);
    expect(items.some((t) => t?.startsWith('Automations'))).toBe(true);
  });

  it('names the browser tab after the current section', async () => {
    mockFetchOnce(200, user());
    renderLayout('/admin/beers');
    await screen.findByTestId('beers-placeholder');
    await waitFor(() => expect(document.title).toBe('Beers · Kegwall'));
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
    fireEvent.keyDown(screen.getByTestId('admin-account'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));

    expect(await screen.findByTestId('login-route')).toBeInTheDocument();
  });
});
