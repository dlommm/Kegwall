import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import type { AdminOutletContext } from '../../../src/web/routes/admin/useAdminContext';

const DEFAULT_ME: AdminOutletContext['me'] = {
  id: 1, username: 'dan', displayName: 'Dan', role: 'admin', isDrinker: false,
  avatarColor: null, createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Renders `ui` the way it's actually mounted in the app: nested under `AdminLayout`'s
 * `<Outlet context={{me, units}} />` (see AdminLayout.tsx / useAdminContext.ts). Every
 * `/admin/*` page now reads its role/units via `useAdminContext()` — a thin wrapper
 * around React Router's `useOutletContext()`, which throws/returns `null` when rendered
 * outside a matched Outlet — so a bare `render(<SomePage />)` no longer works for any
 * page that consumes it. This is the minimal router scaffold needed to satisfy that:
 * a layout-only Route whose `element` IS the context-carrying Outlet, with `ui` mounted
 * as its one child route.
 *
 * Defaults to an admin `me` and `'us'` units — pass `overrides` to test a different role
 * (e.g. `{ me: { ...DEFAULT_ME, role: 'viewer' } }`) or units.
 */
export function renderAdminPage(
  ui: ReactElement,
  overrides: Partial<AdminOutletContext> = {},
  /** Initial URL — pass a query string (e.g. `/x?tap=2`) to exercise deep links. */
  entry = '/x',
): RenderResult {
  const ctx: AdminOutletContext = { me: DEFAULT_ME, units: 'us', servingSizeMl: 473, ...overrides };
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<Outlet context={ctx} />}>
          <Route path="/x" element={ui} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** Convenience for the common "just change the role" case. */
export function adminContext(role: AdminOutletContext['me']['role'], units: AdminOutletContext['units'] = 'us'): AdminOutletContext {
  return { me: { ...DEFAULT_ME, role }, units, servingSizeMl: 473 };
}
