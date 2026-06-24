import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useSocket } from '../../hooks/useSocket';

const PAGE_TITLES = {
  '/dashboard':             'Dashboard',
  '/contacts':              'Contacts',
  '/companies':             'Companies',
  '/deals':                 'Deals Pipeline',
  '/activities':            'Activities',
  '/tasks':                 'Tasks',
  '/analytics':             'Analytics',
  '/ai-assistant':          'AI Assistant',
  '/settings/general':      'General Settings',
  '/settings/users':        'Team & Users',
  '/settings/integrations': 'Integrations',
};

export default function AppShell() {
  const location = useLocation();

  // Initialize persistent Socket.IO connection for this session
  useSocket();

  const title = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] || 'LeadPulse';

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
