import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { WallPage } from './routes/WallPage';
import { MenuPage } from './routes/MenuPage';
import { TabletPage } from './routes/TabletPage';
import { BoardPage } from './routes/BoardPage';

// Phase 5 Task 0 (Phase 4 final review, "MUST FIX before/at start of Phase 5"): the
// entire admin subtree — shell, all nine pages, and (transitively, via StatsPage's
// TempChart/PoursChart/etc.) Recharts — lives behind this ONE `React.lazy()` boundary.
// A wall kiosk or the public QR menu never requests `AdminApp`'s chunk at all, so their
// bundle drops back to roughly what it was before Recharts/the admin UI existed (verify
// with `npm run build`'s output — see the Phase 5 Task 0 report for the before/after
// sizes). Only an admin actually navigating to `/admin/*` pays that download.
const AdminApp = lazy(() => import('./routes/admin/AdminApp'));

/** Suspense fallback while `AdminApp`'s chunk downloads — deliberately minimal (this is
 * a LAN app; the chunk is small and cached after the first admin visit), matching
 * AdminLayout's own "Loading…" placeholder style rather than a full skeleton. */
function AdminFallback() {
  return (
    <main className="admin-shell__loading" data-testid="admin-app-loading">
      <p>Loading…</p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/wall/:slug" element={<WallPage />} />
      <Route path="/menu" element={<MenuPage />} />
      <Route path="/tablet/:slug" element={<TabletPage />} />
      <Route path="/board" element={<BoardPage />} />

      <Route
        path="/admin/*"
        element={(
          <Suspense fallback={<AdminFallback />}>
            <AdminApp />
          </Suspense>
        )}
      />

      <Route path="*" element={<Navigate to="/menu" replace />} />
    </Routes>
  );
}
