import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { Layout } from './components/Layout';
import { LiveProvider } from './live';
import { Alerts } from './pages/Alerts';
import { Analytics } from './pages/Analytics';
import { CameraPage } from './pages/CameraPage';
import { Cameras } from './pages/Cameras';
import { Dashboard } from './pages/Dashboard';
import { Developer } from './pages/Developer';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Sign } from './pages/Sign';
import { SpaceEditor } from './pages/SpaceEditor';
import { Timeline } from './pages/Timeline';

interface AuthStatus {
  needsSetup: boolean;
  user: { id: number; username: string } | null;
}

export function App() {
  const location = useLocation();
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  useEffect(() => {
    api.get<AuthStatus>('/api/auth/status').then(setAuth);
  }, [location.pathname === '/login']);

  // Public signage page needs no session.
  if (location.pathname.startsWith('/sign/')) {
    return (
      <Routes>
        <Route path="/sign/:slug" element={<Sign />} />
      </Routes>
    );
  }

  if (!auth) return null;

  if (!auth.user) {
    return (
      <Routes>
        <Route path="*" element={<Login needsSetup={auth.needsSetup} onDone={() => api.get<AuthStatus>('/api/auth/status').then(setAuth)} />} />
      </Routes>
    );
  }

  return (
    <LiveProvider>
      <Layout username={auth.user.username}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cameras" element={<Cameras />} />
          <Route path="/cameras/:id" element={<CameraPage />} />
          <Route path="/cameras/:id/editor" element={<SpaceEditor />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/developer" element={<Developer />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </LiveProvider>
  );
}
