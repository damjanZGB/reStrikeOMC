import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { useMe } from '@/auth/use-me';
import { LoginPage } from '@/pages/login';
import { SetupPage } from '@/pages/setup';
import { ConnectionsPage } from '@/pages/connections';
import { DashboardPage } from '@/pages/dashboard';
import { SettingsPage } from '@/pages/settings';
import { Button } from '@/components/ui/button';

export function App(): JSX.Element {
  const { user, loading, needsSetup } = useMe();

  if (loading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <nav className="flex gap-4 text-sm font-medium">
            <Link to="/dashboard" className="hover:text-primary">Dashboard</Link>
            <Link to="/connections" className="hover:text-primary">Connections</Link>
            <Link to="/settings" className="hover:text-primary">Settings</Link>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.username}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                window.location.href = '/login';
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 container py-6">
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
