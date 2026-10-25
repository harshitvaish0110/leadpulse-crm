import { Outlet } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import EmptyState from '../ui/EmptyState';

/** Renders child routes only for the given roles; others see an inline notice. */
export default function RoleRoute({ roles }) {
  const role = useAuthStore((s) => s.user?.role);
  if (roles.includes(role)) return <Outlet />;
  return (
    <EmptyState
      icon={ShieldAlert}
      title="You need admin access"
      description="Ask a workspace admin if you need to change these settings."
    />
  );
}
