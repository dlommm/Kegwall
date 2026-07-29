import type { Role } from '../../../server/db/users.js';

/**
 * The admin sidebar's sections, per the Task 2 design direction. `adminOnly` items (Users,
 * Settings) are hidden for editor/viewer — see `visibleNavItems`. Everything else stays
 * visible to a viewer: their pages render read-only once built (Tasks 3-9), the *nav*
 * itself isn't the enforcement point (route guards + `requireRole` on the server are).
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
  // Phase 5 Task 6: viewer-visible (read-only builder; see AutomationsPage's own role
  // gate), NOT adminOnly — matches the plan's "editor manages automations" Global
  // Constraint (editor, not admin, is the mutation-gate role; a viewer can still see the
  // page). Notifications has no nav entry of its own — reached via the header bell's
  // "View all" link (see NotificationBell.tsx) or /admin/notifications directly, the same
  // "not every route needs a permanent sidebar slot" precedent as /admin/pours.
  { label: 'Automations', path: '/admin/automations' },
  { label: 'Users', path: '/admin/users', adminOnly: true },
  { label: 'Settings', path: '/admin/settings', adminOnly: true },
  { label: 'Stats', path: '/admin/stats' },
];

/** Filters `ADMIN_NAV_ITEMS` down to what a given role may see. `null` (no session yet,
 * or a drinker-only profile with no `role`) sees only the non-admin-only items. */
export function visibleNavItems(role: Role | null): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
}
