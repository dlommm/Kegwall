import { Navigate, Route, Routes } from 'react-router-dom';
import { WallPage } from './routes/WallPage';
import { MenuPage } from './routes/MenuPage';
import { LoginPage } from './routes/admin/LoginPage';
import { SetupPage } from './routes/admin/SetupPage';
import { AdminLayout } from './routes/admin/AdminLayout';
import { DashboardPage } from './routes/admin/DashboardPage';
import { BeersPage } from './routes/admin/BeersPage';
import { TapsPage } from './routes/admin/TapsPage';
import { MonitorsPage } from './routes/admin/MonitorsPage';
import { WallsPage } from './routes/admin/WallsPage';
import { UsersPage } from './routes/admin/UsersPage';
import { SettingsPage } from './routes/admin/SettingsPage';
import { StatsPage } from './routes/admin/StatsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/wall/:slug" element={<WallPage />} />
      <Route path="/menu" element={<MenuPage />} />

      {/* /admin/login and /admin/setup sit OUTSIDE AdminLayout — they're the two pages a
          visitor with no session reaches, so they can't themselves live behind the
          auth-gated layout. See AdminLayout.tsx / adminApi.ts for the guard + redirect
          story that ties these three together. */}
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin/setup" element={<SetupPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="beers" element={<BeersPage />} />
        <Route path="taps" element={<TapsPage />} />
        <Route path="monitors" element={<MonitorsPage />} />
        <Route path="walls" element={<WallsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="stats" element={<StatsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/menu" replace />} />
    </Routes>
  );
}
