import type { Role } from '../../../server/db/users.js';

/**
 * The admin sidebar's sections, in the Pour Wall overhaul order (design 5a):
 * Dashboard, Beers, Taps & kegs, Monitors, Walls, Automations, Pourers,
 * Analytics, Logs, Settings — plus Users (admin-only account management,
 * distinct from the passwordless Pourers tier). `adminOnly` items are hidden
 * for editor/viewer — see `visibleNavItems`. Notifications and Pours keep no
 * sidebar slot of their own (reached via the bell / the leaderboard's manage
 * link respectively).
 */
export interface AdminNavItem {
  label: string;
  path: string;
  adminOnly?: boolean;
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { label: 'Dashboard', path: '/admin' },
  { label: 'Beers', path: '/admin/beers' },
  { label: 'Taps & kegs', path: '/admin/taps' },
  { label: 'Monitors', path: '/admin/monitors' },
  { label: 'Walls', path: '/admin/walls' },
  { label: 'Automations', path: '/admin/automations' },
  { label: 'Pourers', path: '/admin/pourers' },
  { label: 'Analytics', path: '/admin/stats' },
  { label: 'Logs', path: '/admin/logs' },
  { label: 'Users', path: '/admin/users', adminOnly: true },
  { label: 'Settings', path: '/admin/settings', adminOnly: true },
];

/** Filters `ADMIN_NAV_ITEMS` down to what a given role may see. `null` (no session yet,
 * or a drinker-only profile with no `role`) sees only the non-admin-only items. */
export function visibleNavItems(role: Role | null): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
}

/** Topbar page title for a pathname: longest matching nav item, plus the
 * no-sidebar-slot routes. */
export function pageTitleFor(pathname: string): string {
  const specials: Record<string, string> = {
    '/admin/pours': 'Pours',
    '/admin/notifications': 'Notifications',
  };
  for (const [path, title] of Object.entries(specials)) {
    if (pathname === path || pathname.startsWith(`${path}/`)) return title;
  }
  let best: AdminNavItem | null = null;
  for (const item of ADMIN_NAV_ITEMS) {
    const matches = item.path === '/admin'
      ? pathname === '/admin'
      : pathname === item.path || pathname.startsWith(`${item.path}/`);
    if (matches && (!best || item.path.length > best.path.length)) best = item;
  }
  return best?.label ?? 'Admin';
}
