import { Route, Routes } from 'react-router';
import { LoginPage } from './LoginPage';
import { SetupPage } from './SetupPage';
import { WelcomePage } from './WelcomePage';
import { AdminLayout } from './AdminLayout';
import { DashboardPage } from './DashboardPage';
import { BeersPage } from './BeersPage';
import { TapsPage } from './TapsPage';
import { SuppliersPage } from './SuppliersPage';
import { GamesPage } from './GamesPage';
import { PeoplePage } from './PeoplePage';
import { MonitorsPage } from './MonitorsPage';
import { WallsPage } from './WallsPage';
import { UsersPage } from './UsersPage';
import { SettingsPage } from './SettingsPage';
import { StatsPage } from './StatsPage';
import { PoursPage } from './PoursPage';
import { AutomationsPage } from './AutomationsPage';
import { NotificationsPage } from './NotificationsPage';
import { LogsPage } from './LogsPage';
import { PourersPage } from './PourersPage';
import { DisplaysPage } from './DisplaysPage';
import { DoctorPage } from './DoctorPage';
import { PresencePage } from './PresencePage';
import { HomeAssistantPage } from './HomeAssistantPage';

/**
 * The entire `/admin/*` route subtree, as its own module — Phase 5 Task 0 (Phase 4 final
 * review, "MUST FIX before/at start of Phase 5": bundle 808 kB single chunk, admin +
 * Recharts weight paid by every wall/menu kiosk boot). `App.tsx` mounts this behind a
 * single `React.lazy()` + `<Suspense>` boundary at `/admin/*`, so nothing in here — the
 * whole admin shell, every admin page, and (transitively, via StatsPage/TempChart)
 * Recharts — is ever fetched by a public wall or menu client.
 *
 * A nested `<Routes>` matching relative paths off the parent `/admin/*` route (rather
 * than each route repeating an `/admin` prefix here) — the exact same route tree App.tsx
 * used to define inline, just relocated so it can be the one lazy-loaded unit.
 */
export default function AdminApp() {
  return (
    <Routes>
      {/* /login and /setup sit OUTSIDE AdminLayout — they're the two pages a visitor with
          no session reaches, so they can't themselves live behind the auth-gated layout.
          See AdminLayout.tsx / adminApi.ts for the guard + redirect story that ties these
          three together. */}
      <Route path="login" element={<LoginPage />} />
      <Route path="setup" element={<SetupPage />} />
      {/* /welcome also sits outside AdminLayout: it's the chrome-free first-run wizard
          SetupPage hands off to. It DOES run authenticated (setup just set the session
          cookie) — adminApi's 401 redirect bounces logged-out visitors to login. */}
      <Route path="welcome" element={<WelcomePage />} />
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="beers" element={<BeersPage />} />
        <Route path="taps" element={<TapsPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="games" element={<GamesPage />} />
        <Route path="monitors" element={<MonitorsPage />} />
        <Route path="walls" element={<WallsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="pours" element={<PoursPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="pourers" element={<PourersPage />} />
        <Route path="displays" element={<DisplaysPage />} />
        <Route path="presence" element={<PresencePage />} />
        <Route path="home-assistant" element={<HomeAssistantPage />} />
        <Route path="doctor" element={<DoctorPage />} />
      </Route>
    </Routes>
  );
}
