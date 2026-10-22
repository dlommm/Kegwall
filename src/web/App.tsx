import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { DisplayPage } from './routes/DisplayPage';
import { DisplayPairingGate } from './components/DisplayPairingGate';

// Phase 5 Task 0 (Phase 4 final review, "MUST FIX before/at start of Phase 5"): the
// entire admin subtree — shell, all nine pages, and (transitively, via StatsPage's
// TempChart/PoursChart/etc.) Recharts — lives behind this ONE `React.lazy()` boundary.
// A wall kiosk or the public QR menu never requests `AdminApp`'s chunk at all, so their
// bundle drops back to roughly what it was before Recharts/the admin UI existed (verify
// with `npm run build`'s output — see the Phase 5 Task 0 report for the before/after
// sizes). Only an admin actually navigating to `/admin/*` pays that download.
const AdminApp = lazy(() => import('./routes/admin/AdminApp'));

// Kegwall V2 (M1): every public surface is its own chunk too, so a TV downloads only the
// wall's code and CSS, and a phone only the menu's. `/display` (the pairing screen) stays
// in the entry chunk: it is tiny and is the first thing an unpaired screen shows.
const WallPage = lazy(() => import('./routes/WallPage').then((m) => ({ default: m.WallPage })));
const MenuPage = lazy(() => import('./routes/MenuPage').then((m) => ({ default: m.MenuPage })));
const TabletPage = lazy(() => import('./routes/TabletPage').then((m) => ({ default: m.TabletPage })));
const BoardPage = lazy(() => import('./routes/BoardPage').then((m) => ({ default: m.BoardPage })));

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
      {/* Public chunks are small and usually cached, so their fallback is an empty frame
          rather than a "Loading…" flash on a TV. */}
      <Route path="/wall/:slug" element={<DisplayPairingGate><Suspense fallback={null}><WallPage /></Suspense></DisplayPairingGate>} />
      <Route path="/menu" element={<DisplayPairingGate><Suspense fallback={null}><MenuPage /></Suspense></DisplayPairingGate>} />
      <Route path="/tablet/:slug" element={<DisplayPairingGate><Suspense fallback={null}><TabletPage /></Suspense></DisplayPairingGate>} />
      <Route path="/board" element={<DisplayPairingGate><Suspense fallback={null}><BoardPage /></Suspense></DisplayPairingGate>} />
      {/* /display is the pairing entry itself — never gated. */}
      <Route path="/display" element={<DisplayPage />} />

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
