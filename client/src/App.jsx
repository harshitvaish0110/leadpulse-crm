import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import PrivateRoute from './components/layout/PrivateRoute';
import AppShell from './components/layout/AppShell';

// Auth pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import AcceptInvite from './pages/auth/AcceptInvite';
import { refreshSession } from './api/axiosInstance';
import { useAuthStore } from './store/authStore';

// App pages (import all 15)
import Dashboard from './pages/Dashboard';
import ContactsList from './pages/contacts/ContactsList';
import ContactDetail from './pages/contacts/ContactDetail';
import CompaniesList from './pages/companies/CompaniesList';
import CompanyDetail from './pages/companies/CompanyDetail';
import DealsPipeline from './pages/deals/DealsPipeline';
import DealDetail from './pages/deals/DealDetail';
import Activities from './pages/Activities';
import Tasks from './pages/Tasks';
import Analytics from './pages/Analytics';
import AIAssistant from './pages/AIAssistant';
import GeneralSettings from './pages/settings/GeneralSettings';
import UsersSettings from './pages/settings/UsersSettings';
import IntegrationsSettings from './pages/settings/IntegrationsSettings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30 * 1000, retry: 1 },
  },
});

/** Restores the session from the refresh cookie once per page load. */
function useAuthBootstrap() {
  useEffect(() => {
    refreshSession().catch(() => {
      // A login that finished first must not be undone by the failed restore.
      if (useAuthStore.getState().status === 'bootstrapping') useAuthStore.getState().clear();
    });
  }, []);
}

export default function App() {
  useAuthBootstrap();
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />

          <Route element={<PrivateRoute />}>
            <Route element={<AppShell />}>
              <Route path="/dashboard"         element={<Dashboard />} />
              <Route path="/contacts"          element={<ContactsList />} />
              <Route path="/contacts/:id"      element={<ContactDetail />} />
              <Route path="/companies"         element={<CompaniesList />} />
              <Route path="/companies/:id"     element={<CompanyDetail />} />
              <Route path="/deals"             element={<DealsPipeline />} />
              <Route path="/deals/:id"         element={<DealDetail />} />
              <Route path="/activities"        element={<Activities />} />
              <Route path="/tasks"             element={<Tasks />} />
              <Route path="/analytics"         element={<Analytics />} />
              <Route path="/ai-assistant"      element={<AIAssistant />} />
              <Route path="/settings/general"       element={<GeneralSettings />} />
              <Route path="/settings/users"         element={<UsersSettings />} />
              <Route path="/settings/integrations"  element={<IntegrationsSettings />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
