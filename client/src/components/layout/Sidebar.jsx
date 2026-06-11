import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, TrendingUp,
  Activity, CheckSquare, BarChart2, Sparkles, Settings
} from 'lucide-react';
import { useUIStore } from '../../store/uiStore';

const NAV_ITEMS = [
  { label: 'Dashboard',     href: '/dashboard',        icon: LayoutDashboard },
  { label: 'Contacts',      href: '/contacts',         icon: Users },
  { label: 'Companies',     href: '/companies',        icon: Building2 },
  { label: 'Deals',         href: '/deals',            icon: TrendingUp },
  { label: 'Activities',    href: '/activities',       icon: Activity },
  { label: 'Tasks',         href: '/tasks',            icon: CheckSquare },
  { label: 'Analytics',     href: '/analytics',        icon: BarChart2 },
  { label: 'AI Assistant',  href: '/ai-assistant',     icon: Sparkles, highlight: true },
  { label: 'Settings',      href: '/settings/general', icon: Settings },
];

export default function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();

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
          <span className="text-white font-bold text-lg tracking-tight">Leadpulse</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ label, href, icon: Icon, highlight }) => (
            <NavLink
              key={href}
              to={href}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                ${isActive
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
            <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-bold">L</div>
            <span>Leadpulse v1.0</span>
          </div>
        </div>
      </aside>
    </>
  );
}
