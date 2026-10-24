import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

export default function PrivateRoute() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  // Never redirect while the session is still being restored from the refresh cookie.
  if (status === 'bootstrapping') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" role="status" aria-live="polite">
        <div className="w-10 h-10 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
        <span className="sr-only">Loading your workspace…</span>
      </div>
    );
  }

  if (status !== 'authenticated') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <Outlet />;
}
