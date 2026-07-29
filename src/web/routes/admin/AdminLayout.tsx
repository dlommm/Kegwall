import { useEffect, useState } from 'react';
import {
  Navigate, NavLink, Outlet, useLocation, useNavigate,
} from 'react-router-dom';
import type { User } from '../../../server/db/users.js';
import { getMe, logout } from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import type { VolumeUnits } from '../../lib/units';
import { ThemeProvider } from '../../themes/ThemeProvider';
import { ADMIN_NAV_ITEMS, visibleNavItems } from './adminNav';
import type { AdminOutletContext } from './useAdminContext';
import { NotificationBell } from './NotificationBell';

/** True when `pathname` is (or is nested under) one of `ADMIN_NAV_ITEMS`' admin-only
 * sections (Users, Settings) — the route-guarding half of the role matrix: nav hiding
 * (`visibleNavItems`) keeps a non-admin from clicking there, this catches them typing
 * the URL directly. */
function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_NAV_ITEMS.some(
    (item) => item.adminOnly && (pathname === item.path || pathname.startsWith(`${item.path}/`)),
  );
}

type Status = 'loading' | 'ready' | 'error';

/**
 * Wraps every `/admin/*` page (see App.tsx's route tree) behind an auth check: on
 * mount, calls `GET /api/auth/me`. When that 401s, `adminApi`'s own fetch helper
 * already redirects the browser to `/admin/login` (see adminApi.ts) — this component
 * doesn't duplicate that logic, it just stays in its "loading" state (rendering
 * nothing but a quiet placeholder) rather than flashing the sidebar/nav for an
 * unauthenticated visitor while that redirect is in flight.
 *
 * Once authenticated, renders the sidebar (`visibleNavItems` hides Users/Settings for
 * non-admins — see adminNav.ts), a user chip + sign-out control, and the matched child
 * route via `Outlet`. Role-based *page* read-only behavior (viewers) lands with each
 * page in Tasks 3-9; this layer only controls nav visibility + the auth gate.
 *
 * Phase 5 Task 0 (Phase 4 final review, "MUST FIX before/at start of Phase 5"): also
 * fetches the taproom's display units (from the same public `getMenu()` payload
 * MenuPage/WallPage use — the only units source a non-admin role can read; `GET
 * /api/settings` is admin-only) and passes `{me, units}` down to every nested page via
 * `<Outlet context>` (see `useAdminContext.ts`). Because `AdminLayout` itself never
 * remounts across sibling `/admin/*` route navigation, both fetches now happen exactly
 * ONCE per admin session — not once per page visit, which is what five separate pages
 * calling their own `getMe()`/`getMenu()` used to cost. The units fetch does NOT gate
 * the auth loading state above: it defaults to `'us'` (matching every page's own prior
 * default) and updates in place once it resolves, so first paint isn't held up waiting
 * on a second round-trip a viewer-only page might not even need.
 */
export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<User | null>(null);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setMe(result.data);
        setStatus('ready');
      } else if (result.status === 401) {
        // adminApi already triggered the redirect to /admin/login — stay in the
        // loading state (renders nothing further) until the browser navigates away.
        setStatus('loading');
      } else {
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMenu().then((result) => {
      if (!cancelled && result.ok) setUnits(result.data.units ?? 'us');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await logout();
    navigate('/admin/login', { replace: true });
  }

  if (status === 'loading') {
    return (
      <main className="admin-shell__loading" data-testid="admin-layout-loading">
        <p>Loading…</p>
      </main>
    );
  }

  if (status === 'error' || !me) {
    return (
      <main className="admin-shell__loading" data-testid="admin-layout-error">
        <p>Couldn&rsquo;t reach the server. Check your connection and reload.</p>
      </main>
    );
  }

  // Route guard: a non-admin who navigates straight to an admin-only URL (rather than
  // clicking a hidden nav link) bounces to the dashboard instead of rendering the page.
  if (isAdminOnlyPath(location.pathname) && me.role !== 'admin') {
    return <Navigate to="/admin" replace />;
  }

  const items = visibleNavItems(me.role);

  return (
    <ThemeProvider className="admin-shell">
      <div className="admin-shell__frame" data-testid="admin-layout">
        <nav className="admin-nav" aria-label="Admin sections">
          <div className="admin-nav__brand font-display">Kegtron admin</div>
          <ul className="admin-nav__list">
            {items.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/admin'}
                  className={({ isActive }) => (isActive
                    ? 'admin-nav__link admin-nav__link--active'
                    : 'admin-nav__link')}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="admin-shell__main">
          <header className="admin-topbar">
            <NotificationBell />
            <div className="admin-user-chip" data-testid="admin-user-chip">
              <span className="admin-user-chip__name">{me.displayName}</span>
              <span className="admin-user-chip__role">{me.role}</span>
            </div>
            <button
              type="button"
              className="admin-topbar__signout"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </header>

          <main className="admin-content">
            <Outlet context={{ me, units } satisfies AdminOutletContext} />
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
