import { useEffect, useRef, useState } from 'react';
import {
  Navigate, NavLink, Outlet, useLocation, useNavigate,
} from 'react-router';
import type { User } from '../../../server/db/users.js';
import { getMe, logout, listWalls, getSystemVersion } from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import type { VolumeUnits } from '../../lib/units';
import { ThemeProvider } from '../../themes/ThemeProvider';
import {
  ADMIN_THEMES, getAdminTheme, loadAdminThemeId, saveAdminThemeId, type AdminThemeId,
} from '../../lib/adminTheme';
import { ADMIN_NAV_ITEMS, visibleNavItems, pageTitleFor } from './adminNav';
import type { AdminOutletContext } from './useAdminContext';
import { NotificationBell } from './NotificationBell';

/** Admin-only routes that no longer have their own nav entry but must stay guarded against
 * direct URL entry — `/admin/users` (account management, now the People page's admin-only
 * Accounts tab, redesign 4h). Kept reachable for deep links, but still admin-gated. */
const EXTRA_ADMIN_ONLY_PATHS = ['/admin/users'];

/** True when `pathname` is (or is nested under) one of `ADMIN_NAV_ITEMS`' admin-only
 * sections (Suppliers, Settings, …) or one of the nav-less admin-only routes above — the
 * route-guarding half of the role matrix: nav hiding (`visibleNavItems`) keeps a non-admin
 * from clicking there, this catches them typing the URL directly. */
function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_NAV_ITEMS.some(
    (item) => item.adminOnly && (pathname === item.path || pathname.startsWith(`${item.path}/`)),
  ) || EXTRA_ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

type Status = 'loading' | 'ready' | 'error';

/**
 * Wraps every `/admin/*` page behind an auth check (see the pre-overhaul doc history in
 * git for the full auth/units-fetch rationale — both fetches still happen exactly once
 * per admin session here).
 *
 * Pour Wall overhaul Phase 4 (design 5a shell): 230px sidebar — brand + site name, the
 * nav (active item: accent text, 3px left border, tinted bg), an appearance picker
 * (Midnight Slate / Workshop / Console — see lib/adminTheme.ts) and the user chip.
 * 62px topbar — current page title, quick-nav search (⌘K), the notification bell, and
 * a "View wall ↗" accent button to the first wall.
 */
export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<User | null>(null);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [siteName, setSiteName] = useState('');
  const [firstWallSlug, setFirstWallSlug] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [adminThemeId, setAdminThemeId] = useState<AdminThemeId>(() => loadAdminThemeId());
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

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
      if (!cancelled && result.ok) {
        setUnits(result.data.units ?? 'us');
        setSiteName(result.data.siteName ?? '');
      }
    });
    listWalls().then((result) => {
      if (!cancelled && result.ok && result.data.length > 0) {
        setFirstWallSlug(result.data[0]!.slug);
      }
    });
    getSystemVersion().then((result) => {
      if (!cancelled && result.ok) setAppVersion(result.data.version);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ⌘K / Ctrl+K focuses the quick-nav search (design topbar: "Search… ⌘K").
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await logout();
    navigate('/admin/login', { replace: true });
  }

  function selectAdminTheme(id: AdminThemeId) {
    setAdminThemeId(id);
    saveAdminThemeId(id);
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
  const query = search.trim().toLowerCase();
  const searchMatches = query
    ? items.filter((item) => item.label.toLowerCase().includes(query))
    : [];

  function submitSearch() {
    const target = searchMatches[0];
    if (target) {
      setSearch('');
      navigate(target.path);
    }
  }

  return (
    <ThemeProvider theme={getAdminTheme(adminThemeId).theme} className="admin-shell">
      <div className="admin-shell__frame" data-testid="admin-layout" data-admin-theme={adminThemeId}>
        <nav className="admin-nav" aria-label="Admin sections">
          <div className="admin-nav__brand-block">
            <span className="admin-nav__brand font-display">KEGWALL</span>
            {siteName && <span className="admin-nav__site">{siteName.toUpperCase()}</span>}
          </div>
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
          <div className="admin-nav__footer">
            {appVersion && (
              <span className="admin-nav__version font-tabular" data-testid="admin-nav-version">
                v{appVersion}
              </span>
            )}
            <label className="admin-nav__appearance">
              <span className="admin-nav__appearance-label">Appearance</span>
              <select
                data-testid="admin-appearance-select"
                value={adminThemeId}
                onChange={(e) => selectAdminTheme(e.target.value as AdminThemeId)}
              >
                {ADMIN_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <div className="admin-user-chip" data-testid="admin-user-chip">
              <span className="admin-user-chip__avatar font-display" aria-hidden="true">
                {initials(me.displayName)}
              </span>
              <span className="admin-user-chip__id">
                <span className="admin-user-chip__name">{me.displayName}</span>
                <span className="admin-user-chip__role">{me.role}</span>
              </span>
              <button
                type="button"
                className="admin-user-chip__signout"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? '…' : 'Sign out'}
              </button>
            </div>
          </div>
        </nav>

        <div className="admin-shell__main">
          <header className="admin-topbar">
            <h1 className="admin-topbar__title font-display" data-testid="admin-topbar-title">
              {pageTitleFor(location.pathname)}
            </h1>
            <div className="admin-topbar__spacer" />
            <div className="admin-topbar__search-wrap">
              <input
                ref={searchRef}
                type="search"
                className="admin-topbar__search"
                data-testid="admin-topbar-search"
                placeholder="Search…  ⌘K"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitSearch();
                  if (e.key === 'Escape') setSearch('');
                }}
              />
              {searchMatches.length > 0 && (
                <ul className="admin-topbar__search-results" data-testid="admin-search-results">
                  {searchMatches.map((item) => (
                    <li key={item.path}>
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                          navigate(item.path);
                        }}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <NotificationBell />
            {firstWallSlug && (
              <a
                className="admin-topbar__view-wall"
                data-testid="admin-view-wall"
                href={`/wall/${firstWallSlug}`}
                target="_blank"
                rel="noreferrer"
              >
                View wall ↗
              </a>
            )}
          </header>

          <main className="admin-content">
            <Outlet context={{ me, units } satisfies AdminOutletContext} />
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
