import { useOutletContext } from 'react-router-dom';
import type { User } from '../../../server/db/users.js';
import type { VolumeUnits } from '../../lib/units';

/**
 * What `AdminLayout` provides every nested `/admin/*` page via React Router's Outlet
 * context (Phase 5 Task 0 — the Phase 4 final review's "MUST FIX before/at start of
 * Phase 5" item: `AdminLayout` already fetches `me` once on mount and never remounts
 * across sibling route navigation, so this is fetched exactly once per admin session
 * instead of once per page — five pages previously each re-fetched `getMe()`/`getMenu()`
 * for exactly this data on every mount).
 *
 * `me` is always a real `User`, never `null` — `AdminLayout` doesn't render `<Outlet />`
 * (and so no page using this hook ever mounts) until the `GET /api/auth/me` call that
 * populates it has already succeeded.
 */
export interface AdminOutletContext {
  me: User;
  units: VolumeUnits;
}

/** Typed wrapper around `useOutletContext` for `/admin/*` pages — see `AdminOutletContext`. */
export function useAdminContext(): AdminOutletContext {
  return useOutletContext<AdminOutletContext>();
}
