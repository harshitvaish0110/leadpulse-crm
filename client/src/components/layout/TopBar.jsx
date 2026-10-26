import { Menu, ChevronDown, LogOut, User, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { logout } from '../../api/axiosInstance';
import { useUIStore } from '../../store/uiStore';
import Avatar from '../ui/Avatar';
import NotificationBell from './NotificationBell';
import { SHORTCUT_LABEL } from '../../lib/shortcut';

export default function TopBar({ title }) {
  const user = useAuthStore((s) => s.user);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openPalette = useUIStore((s) => s.setPaletteOpen);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="h-15 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0" style={{ height: 60 }}>
      <div className="flex items-center gap-4">
        <button onClick={toggleSidebar} aria-label="Open navigation" className="lg:hidden text-gray-500 hover:text-gray-700">
          <Menu size={20} />
        </button>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => openPalette(true)} aria-label={`Search or ask (${SHORTCUT_LABEL})`}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors">
          <Search size={15} />
          <span className="hidden md:inline">Search or ask…</span>
          <kbd className="hidden md:inline font-sans text-[11px] text-gray-400 border border-gray-200 rounded px-1">{SHORTCUT_LABEL}</kbd>
        </button>
        <NotificationBell />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-expanded={userMenuOpen}
            aria-label="Account menu"
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Avatar firstName={user?.firstName} lastName={user?.lastName} size="sm" />
            <span className="text-sm font-medium text-gray-700 hidden md:block">{user?.firstName}</span>
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-12 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-gray-500">{user?.email}</p>
              </div>
              <button onClick={() => { setUserMenuOpen(false); navigate('/settings/profile'); }} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <User size={16} />
                Profile & password
              </button>
              <button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors">
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
