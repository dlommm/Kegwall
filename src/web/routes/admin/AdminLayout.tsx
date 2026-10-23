import { useEffect, useMemo, useState } from 'react';
import {
  Link, Navigate, NavLink, Outlet, useLocation, useNavigate,
} from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import type { User } from '../../../server/db/users.js';
import { getMe, logout, listWalls, getSystemVersion } from '../../lib/adminApi';
import { getMenu } from '../../lib/api';
import type { VolumeUnits } from '../../lib/units';
import { ThemeProvider } from '../../themes/ThemeProvider';
import { initials } from '../../lib/initials';
import '../../design/fonts';
import {
  ADMIN_DESTINATIONS, ADMIN_NAV_ITEMS, destinationFor, pageTitleFor, visibleDestinations,
} from './adminNav';
import { useAdminLook } from './adminLook';
import { CommandPalette, paletteEntries, type PaletteEntry } from './CommandPalette';
import type { AdminOutletContext } from './useAdminContext';
import { NotificationBell } from './NotificationBell';
import {
  AdminPortalContext, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger,
} from './ui';

/** A US pint, until the menu fetch says otherwise. */
const DEFAULT_SERVING_ML = 473;

/** Admin-only routes that no longer have their own nav entry but must stay guarded against
 * direct URL entry — `/admin/users` (account management, now the People page's admin-only
 * Accounts tab, redesign 4h). Kept reachable for deep links, but still admin-gated. */
const EXTRA_ADMIN_ONLY_PATHS = ['/admin/users'];

/** Every admin-only path: the destinations' admin-only tabs (what the bar hides), the
 * page list's admin-only items, and the nav-less routes above. */
const ADMIN_ONLY_PATHS = [
  ...ADMIN_DESTINATIONS.flatMap((d) => d.tabs.filter((t) => t.adminOnly).map((t) => t.path)),
  ...ADMIN_NAV_ITEMS.filter((item) => item.adminOnly).map((item) => item.path),
  ...EXTRA_ADMIN_ONLY_PATHS,
];

/** True when `pathname` is (or is nested under) an admin-only page — the route-guarding
 * half of the role matrix: nav hiding (`visibleDestinations`) keeps a non-admin from
 * clicking there, this catches them typing the URL directly. */
function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type Status = 'loading' | 'ready' | 'error';

/**
 * Wraps every `/admin/*` page behind an auth check (see the pre-overhaul doc history in
 * git for the full auth/units-fetch rationale — both fetches still happen exactly once
 * per admin session here).
 *
 * Kegwall V2 shell (blueprint §C.1, prototypes/admin-*.html): no sidebar. A top bar with the
 * taproom's name, six destinations, Search (Ctrl K), the notification bell, Settings and the
 * account menu; under it, the current destination's sub-tabs, which link the existing admin
 * URLs. Phones get one Menu button that opens the destinations as a sheet. One admin look,
 * light or dark by the device's preference (adminLook.ts).
 */
export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const look = useAdminLook();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<User | null>(null);
  const [units, setUnits] = useState<VolumeUnits>('us');
  const [siteName, setSiteName] = useState('');
  const [servingSizeMl, setServingSizeMl] = useState(DEFAULT_SERVING_ML);
  const [firstWallSlug, setFirstWallSlug] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);

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
        setServingSizeMl(result.data.servingSizeMl ?? DEFAULT_SERVING_ML);
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

  // Each page renders its own <h1>; the browser tab carries the section name so
  // several open admin tabs stay distinguishable.
  useEffect(() => {
    document.title = `${pageTitleFor(location.pathname)} · Kegwall`;
  }, [location.pathname]);

  // The phone menu closes on ANY navigation (page links, the palette, the back button).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

  // Ctrl K / ⌘K opens the palette from anywhere in the admin.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMobileNavOpen(false);
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const role = me?.role ?? null;
  const destinations = useMemo(() => visibleDestinations(role), [role]);
  const entries = useMemo<PaletteEntry[]>(() => paletteEntries(destinations, [
    { id: 'notifications', label: 'Notifications', hint: 'Tonight', to: '/admin/notifications' },
    ...(firstWallSlug
      ? [{ id: 'wall', label: 'Open the wall', hint: 'New tab', to: `/wall/${firstWallSlug}`, external: true }]
      : []),
  ]), [destinations, firstWallSlug]);

  async function handleSignOut() {
    setSigningOut(true);
    await logout();
    navigate('/admin/login', { replace: true });
  }

  function openEntry(entry: PaletteEntry) {
    if (entry.external) window.open(entry.to, '_blank', 'noopener');
    else navigate(entry.to);
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
  // clicking a hidden nav link) bounces to Tonight instead of rendering the page.
  if (isAdminOnlyPath(location.pathname) && me.role !== 'admin') {
    return <Navigate to="/admin" replace />;
  }

  const current = destinationFor(location.pathname);
  const visibleCurrent = destinations.find((d) => d.label === current.label);
  const main = destinations.filter((d) => !d.utility);
  const utility = destinations.filter((d) => d.utility);
  const tabs = visibleCurrent && visibleCurrent.tabs.length > 1 ? visibleCurrent.tabs : [];
  const brand = siteName || 'Kegwall';

  const destLink = (d: (typeof destinations)[number], className: string) => (
    <Link
      to={d.path}
      // Close the phone sheet even when the link is the page already open (no navigation).
      onClick={() => setMobileNavOpen(false)}
      className={d.label === current.label ? `${className} is-on` : className}
      aria-current={d.label === current.label ? 'page' : undefined}
    >
      {d.label}
    </Link>
  );

  return (
    <ThemeProvider theme={look.theme} className="admin-shell">
      <AdminPortalContext.Provider value={portalEl}>
      <div className="adm-shell" data-testid="admin-layout" data-admin-scheme={look.scheme}>
        <a className="adm-skip" href="#admin-main">Skip to content</a>
        <header className="adm-top">
          <nav className="adm-top__bar" aria-label="Admin">
            <Link to="/admin" className="adm-top__brand" data-testid="admin-brand">{brand}</Link>
            <ul className="adm-top__dests">
              {main.map((d) => <li key={d.label}>{destLink(d, 'adm-top__link')}</li>)}
            </ul>
            <span className="adm-top__spacer" />
            <button
              type="button"
              className="adm-top__search"
              data-testid="admin-search"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setPaletteOpen(true)}
            >
              Search <kbd>Ctrl K</kbd>
            </button>
            <NotificationBell />
            <span className="adm-top__utility">
              {utility.map((d) => <span key={d.label}>{destLink(d, 'adm-top__link')}</span>)}
            </span>
            <Menu>
              <MenuTrigger className="adm-top__me" data-testid="admin-account" aria-label={`Account: ${me.displayName}`}>
                {initials(me.displayName)}
              </MenuTrigger>
              <MenuContent data-testid="admin-account-menu">
                <MenuLabel>
                  <span className="adm-menu__who" data-testid="admin-user-chip">
                    <b>{me.displayName}</b>
                    <small>{me.role}</small>
                  </span>
                </MenuLabel>
                <MenuSeparator />
                {firstWallSlug && (
                  <MenuItem asChild>
                    <a href={`/wall/${firstWallSlug}`} target="_blank" rel="noreferrer" data-testid="admin-view-wall">
                      Open the wall
                    </a>
                  </MenuItem>
                )}
                <MenuItem disabled={signingOut} onSelect={handleSignOut}>
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </MenuItem>
                {appVersion && (
                  <>
                    <MenuSeparator />
                    <MenuLabel>
                      <span className="adm-menu__version" data-testid="admin-nav-version">Kegwall v{appVersion}</span>
                    </MenuLabel>
                  </>
                )}
              </MenuContent>
            </Menu>
            <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <Dialog.Trigger className="adm-btn adm-btn--secondary adm-top__menu" aria-expanded={mobileNavOpen}>
                Menu
              </Dialog.Trigger>
              <Dialog.Portal container={portalEl ?? undefined}>
                <Dialog.Overlay className="adm-overlay" />
                <Dialog.Content className="adm-sheet" data-testid="admin-phone-menu">
                  <span className="adm-sheet__grab" aria-hidden="true" />
                  <Dialog.Title className="adm-sr-only">Admin menu</Dialog.Title>
                  <Dialog.Description className="adm-sr-only">Go to a part of the admin.</Dialog.Description>
                  <nav aria-label="Admin sections">
                    {main.map((d) => <span key={d.label}>{destLink(d, 'adm-sheet__link')}</span>)}
                    <hr />
                    {utility.map((d) => <span key={d.label}>{destLink(d, 'adm-sheet__link')}</span>)}
                    {firstWallSlug && (
                      <a className="adm-sheet__link" href={`/wall/${firstWallSlug}`} target="_blank" rel="noreferrer">
                        Open the wall
                      </a>
                    )}
                    <button type="button" className="adm-sheet__link" onClick={handleSignOut} disabled={signingOut}>
                      {signingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                  </nav>
                  <Dialog.Close className="adm-btn adm-btn--secondary adm-sheet__close">Close</Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </nav>
          {tabs.length > 0 && (
            <nav className="adm-subtabs" aria-label={`${current.label} sections`} data-testid="admin-subtabs">
              {tabs.map((t) => (
                <NavLink
                  key={t.path}
                  to={t.path}
                  className={({ isActive }) => (isActive ? 'adm-subtabs__link is-on' : 'adm-subtabs__link')}
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
          )}
        </header>

        <main className="admin-content adm-main" id="admin-main" tabIndex={-1}>
          <Outlet context={{ me, units, servingSizeMl } satisfies AdminOutletContext} />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} entries={entries} onSelect={openEntry} />
      </AdminPortalContext.Provider>
      <div className="adm-portal" ref={setPortalEl} />
    </ThemeProvider>
  );
}
