import type { Role } from '../../../server/db/users.js';

/**
 * The admin sidebar's sections, in the Pour Wall overhaul order (design 5a):
 * Dashboard, Beers, Taps & kegs, Monitors, Walls, Automations, Pourers,
 * Analytics, Logs, Settings — plus Users (admin-only account management,
 * distinct from the passwordless Pourers tier). `adminOnly` items are hidden
 * for editor/viewer — see `visibleNavItems`. Notifications are reached via the bell; Pours has a direct sidebar entry.
 */
export interface AdminNavItem {
  label: string;
  path: string;
  adminOnly?: boolean;
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { label: 'Tonight', path: '/admin' },
  { label: 'Beers', path: '/admin/beers' },
  { label: 'Taps & kegs', path: '/admin/taps' },
  // Every keg (on tap + past) with editable owner cost/supplier — admin (shows cost).
  { label: 'Kegs', path: '/admin/kegs', adminOnly: true },
  // Suppliers (redesign 4l): admin-only because the page surfaces the derived price book
  // and YTD spend, both OWNER COST — the editor-role supplier LIST endpoint still backs the
  // swap wizard's supplier dropdown for non-admins.
  { label: 'Suppliers', path: '/admin/suppliers', adminOnly: true },
  { label: 'Monitors', path: '/admin/monitors' },
  { label: 'Walls', path: '/admin/walls' },
  { label: 'Displays', path: '/admin/displays' },
  // Displays & Presence hub (Task 4): zones + display power now, motion sources +
  // webhook/agent setup land in Task 5. `adminOnly` because every route it calls
  // (`GET/POST /api/presence/...`) is admin-gated (unlike the wall PATCH the display-
  // power panel also writes through, which is only editor-gated) -- an editor landing
  // here would just see every panel action fail.
  { label: 'Displays & Presence', path: '/admin/presence', adminOnly: true },
  { label: 'Automations', path: '/admin/automations' },
  // Drinking games library (redesign 5a) — browseable by any role; starting a game is
  // editor-gated inside the page.
  { label: 'Games', path: '/admin/games' },
  // People (redesign 4h) merges the old Pourers + Users pages into one nav entry. Visible to
  // all — the Pourers tab is for everyone; the Accounts tab is admin-gated inside the page.
  { label: 'Pours', path: '/admin/pours' },
  { label: 'People', path: '/admin/people' },
  { label: 'Analytics', path: '/admin/stats' },
  { label: 'Logs', path: '/admin/logs' },
  { label: 'Settings', path: '/admin/settings', adminOnly: true },
];

/** Filters `ADMIN_NAV_ITEMS` down to what a given role may see. `null` (no session yet,
 * or a drinker-only profile with no `role`) sees only the non-admin-only items. */
export function visibleNavItems(role: Role | null): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
}

/** Browser-tab title for a pathname: longest matching nav item, plus the
 * no-sidebar-slot routes. */
export function pageTitleFor(pathname: string): string {
  const specials: Record<string, string> = {
    '/admin/pours': 'Pours',
    '/admin/notifications': 'Notifications',
    '/admin/doctor': 'Connection doctor',
    '/admin/home-assistant': 'Home Assistant',
    // Merged into People (redesign 4h); routes kept for deep links, titles preserved.
    '/admin/users': 'People',
    '/admin/pourers': 'People',
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

/**
 * Kegwall V2 admin: six destinations in the top bar, each with sub-tabs that link the
 * existing admin URLs (every old route and deep link keeps working). Settings sits at the
 * right of the bar. `match` lists extra paths that belong to a destination without a tab.
 */
export interface AdminDestination {
  label: string;
  path: string;
  tabs: readonly AdminNavItem[];
  match?: readonly string[];
  adminOnly?: boolean;
  /** Sits at the right of the bar, apart from the six destinations (Settings). */
  utility?: boolean;
}

export const ADMIN_DESTINATIONS: readonly AdminDestination[] = [
  { label: 'Tonight', path: '/admin', tabs: [], match: ['/admin/notifications', '/admin/welcome'] },
  {
    label: 'Taps & kegs',
    path: '/admin/taps',
    tabs: [
      { label: 'Taps', path: '/admin/taps' },
      { label: 'Kegs', path: '/admin/kegs', adminOnly: true },
      { label: 'Suppliers', path: '/admin/suppliers', adminOnly: true },
      { label: 'Monitors', path: '/admin/monitors' },
    ],
  },
  { label: 'Beers', path: '/admin/beers', tabs: [] },
  { label: 'People', path: '/admin/people', tabs: [], match: ['/admin/users', '/admin/pourers'] },
  {
    label: 'Screens',
    path: '/admin/walls',
    tabs: [
      { label: 'Walls', path: '/admin/walls' },
      { label: 'Displays', path: '/admin/displays' },
      { label: 'Presence', path: '/admin/presence', adminOnly: true },
      { label: 'Games', path: '/admin/games' },
    ],
  },
  {
    label: 'Insights',
    path: '/admin/stats',
    tabs: [
      { label: 'Analytics', path: '/admin/stats' },
      { label: 'Every pour', path: '/admin/pours' },
      { label: 'Logs', path: '/admin/logs' },
    ],
  },
  {
    label: 'Settings',
    path: '/admin/settings',
    adminOnly: true,
    utility: true,
    tabs: [
      { label: 'Settings', path: '/admin/settings', adminOnly: true },
      { label: 'Automations', path: '/admin/automations' },
      { label: 'Home Assistant', path: '/admin/home-assistant' },
      { label: 'Diagnostics', path: '/admin/doctor' },
    ],
  },
];

function under(pathname: string, path: string): boolean {
  return path === '/admin' ? pathname === '/admin' : pathname === path || pathname.startsWith(`${path}/`);
}

/** The destination a pathname belongs to (Tonight when nothing else matches). */
export function destinationFor(pathname: string): AdminDestination {
  return ADMIN_DESTINATIONS.find((d) => under(pathname, d.path)
    || d.tabs.some((t) => under(pathname, t.path))
    || (d.match ?? []).some((m) => under(pathname, m))) ?? ADMIN_DESTINATIONS[0]!;
}

/** Destinations and their tabs, filtered for a role. Non-admins still reach Automations etc.
 * through Settings' tabs when Settings itself is admin-only. */
export function visibleDestinations(role: Role | null): AdminDestination[] {
  const ok = (item: { adminOnly?: boolean }) => !item.adminOnly || role === 'admin';
  return ADMIN_DESTINATIONS
    .map((d) => ({ ...d, tabs: d.tabs.filter(ok) }))
    .filter((d) => ok(d) || d.tabs.length > 0)
    .map((d) => (ok(d) ? d : { ...d, path: d.tabs[0]!.path }));
}
