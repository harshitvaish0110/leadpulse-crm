import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

const TABS = [
  { to: '/settings/profile', label: 'Profile' },
  { to: '/settings/general', label: 'Workspace', admin: true },
  { to: '/settings/pipeline', label: 'Pipeline', admin: true },
  { to: '/settings/fields', label: 'Fields & tags', admin: true },
  { to: '/settings/users', label: 'Team', admin: true },
  { to: '/settings/integrations', label: 'Integrations', admin: true },
  { to: '/settings/webhooks', label: 'Webhooks', admin: true },
  { to: '/settings/audit', label: 'Audit log', admin: true },
];

export default function SettingsLayout() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'ADMIN');
  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  return (
    <div className="space-y-6">
      {tabs.length > 1 && (
        <nav aria-label="Settings sections" className="flex gap-1 border-b border-gray-200 overflow-x-auto">
          {tabs.map(({ to, label }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => `px-4 py-2.5 -mb-px text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      )}
      <Outlet />
    </div>
  );
}
