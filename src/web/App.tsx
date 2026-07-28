import { Navigate, Route, Routes } from 'react-router-dom';
import { WallPage } from './routes/WallPage';
import { MenuPage } from './routes/MenuPage';

export default function App() {
  return (
    <Routes>
      <Route path="/wall/:slug" element={<WallPage />} />
      <Route path="/menu" element={<MenuPage />} />
      <Route path="*" element={<Navigate to="/menu" replace />} />
    </Routes>
  );
}
