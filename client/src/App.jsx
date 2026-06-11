import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import PrivateRoute from './components/layout/PrivateRoute';
import AppShell from './components/layout/AppShell';

// Auth pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />

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
