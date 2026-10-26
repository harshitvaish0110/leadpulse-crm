import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, TrendingUp,
  Activity, CheckSquare, BarChart2, Sparkles, Settings, Sun
} from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useWorkspace } from '../../hooks/queries/lookups';

const NAV_ITEMS = [
  { label: 'My Day',        href: '/my-day',           icon: Sun },
  { label: 'Dashboard',     href: '/dashboard',        icon: LayoutDashboard },
  { label: 'Contacts',      href: '/contacts',         icon: Users },
  { label: 'Companies',     href: '/companies',        icon: Building2 },
  { label: 'Deals',         href: '/deals',            icon: TrendingUp },
  { label: 'Activities',    href: '/activities',       icon: Activity },
  { label: 'Tasks',         href: '/tasks',            icon: CheckSquare },
  { label: 'Analytics',     href: '/analytics',        icon: BarChart2 },
  { label: 'AI Assistant',  href: '/ai-assistant',     icon: Sparkles, highlight: true },
];

export default function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const isAdmin = useAuthStore((s) => s.user?.role === 'ADMIN');
  const { pathname } = useLocation();
  const { data: workspace } = useWorkspace();
  // Admins land on workspace settings; everyone else on their profile.
  const items = [...NAV_ITEMS, { label: 'Settings', href: isAdmin ? '/settings/general' : '/settings/profile', match: '/settings', icon: Settings }];

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => toggleSidebar()} />
      )}

      <aside className={`fixed left-0 top-0 z-30 h-full w-60 bg-gray-900 flex flex-col transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:z-auto`}>

        {/* Logo */}
        <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-800">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles size={16} className="text-white" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">LeadPulse</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {items.map(({ label, href, match, icon: Icon, highlight }) => (
            <NavLink
              key={label}
              to={href}
              onClick={() => { if (sidebarOpen && window.innerWidth < 1024) toggleSidebar(); }}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                ${isActive || (match && pathname.startsWith(match))
                  ? 'bg-indigo-600 text-white'
                  : highlight
                    ? 'text-indigo-400 hover:bg-gray-800 hover:text-indigo-300'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom user info */}
        <div className="px-3 pb-4 border-t border-gray-800 pt-4">
          <div className="flex items-center gap-2 px-3 py-2 text-gray-400 text-xs">
            <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-bold" aria-hidden="true">
              {(workspace?.companyName || 'L').charAt(0).toUpperCase()}
            </div>
            <span className="truncate">{workspace?.companyName || 'LeadPulse'}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
