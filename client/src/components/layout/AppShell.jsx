import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import CommandPalette from './CommandPalette';
import ErrorBoundary from '../ErrorBoundary';
import { useSocket } from '../../hooks/useSocket';
import { useWorkspace } from '../../hooks/queries/lookups';
import { setCurrency } from '../../lib/format';

const PAGE_TITLES = {
  '/my-day':                'My Day',
  '/dashboard':             'Dashboard',
  '/contacts':              'Contacts',
  '/companies':             'Companies',
  '/deals':                 'Deals Pipeline',
  '/activities':            'Activities',
  '/tasks':                 'Tasks',
  '/analytics':             'Analytics',
  '/ai-assistant':          'AI Assistant',
  '/settings':              'Settings',
};

export default function AppShell({ fallback = null }) {
  const location = useLocation();

  // One authenticated Socket.IO connection for the signed-in user.
  useSocket();

  // Amounts render in the workspace currency, so pages wait for it (one small request).
  const { data: workspace, isPending } = useWorkspace();
  setCurrency(workspace?.currency);

  const title = Object.entries(PAGE_TITLES).find(([path]) => location.pathname.startsWith(path))?.[1] || 'LeadPulse';

  useEffect(() => {
    document.title = title === 'LeadPulse' ? 'LeadPulse' : `${title} · LeadPulse`;
  }, [title]);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <CommandPalette />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            {/* Keyed by path: navigating away from a crashed page clears the error.
                And by currency: a changed currency re-renders every amount on the page. */}
            <ErrorBoundary key={`${location.pathname}:${workspace?.currency}`}>
              <Suspense fallback={fallback}>
                {isPending ? fallback : <Outlet />}
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
