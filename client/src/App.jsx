import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import PrivateRoute from './components/layout/PrivateRoute';
import RoleRoute from './components/layout/RoleRoute';
import AppShell from './components/layout/AppShell';
import Skeleton from './components/ui/Skeleton';
import { refreshSession } from './api/axiosInstance';
import { useAuthStore } from './store/authStore';

// Auth pages are small and needed before sign-in, so they ship in the main bundle.
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import AcceptInvite from './pages/auth/AcceptInvite';

// App pages load on first visit (charts and drag-and-drop stay out of the login bundle).
const Dashboard            = lazy(() => import('./pages/Dashboard'));
const ContactsList         = lazy(() => import('./pages/contacts/ContactsList'));
const ContactDetail        = lazy(() => import('./pages/contacts/ContactDetail'));
const CompaniesList        = lazy(() => import('./pages/companies/CompaniesList'));
const CompanyDetail        = lazy(() => import('./pages/companies/CompanyDetail'));
const DealsPipeline        = lazy(() => import('./pages/deals/DealsPipeline'));
const DealDetail           = lazy(() => import('./pages/deals/DealDetail'));
const Activities           = lazy(() => import('./pages/Activities'));
const Tasks                = lazy(() => import('./pages/Tasks'));
const Analytics            = lazy(() => import('./pages/Analytics'));
const AIAssistant          = lazy(() => import('./pages/AIAssistant'));
const SettingsLayout       = lazy(() => import('./pages/settings/SettingsLayout'));
const ProfileSettings      = lazy(() => import('./pages/settings/ProfileSettings'));
const GeneralSettings      = lazy(() => import('./pages/settings/GeneralSettings'));
const PipelineSettings     = lazy(() => import('./pages/settings/PipelineSettings'));
const FieldsSettings       = lazy(() => import('./pages/settings/FieldsSettings'));
const UsersSettings        = lazy(() => import('./pages/settings/UsersSettings'));
const IntegrationsSettings = lazy(() => import('./pages/settings/IntegrationsSettings'));
const WebhooksSettings     = lazy(() => import('./pages/settings/WebhooksSettings'));
const AuditLogSettings     = lazy(() => import('./pages/settings/AuditLogSettings'));

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

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
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
            <Route element={<AppShell fallback={<PageFallback />} />}>
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
              <Route path="/settings" element={<Suspense fallback={<PageFallback />}><SettingsLayout /></Suspense>}>
                <Route index element={<Navigate to="/settings/profile" replace />} />
                <Route path="profile" element={<ProfileSettings />} />
                <Route element={<RoleRoute roles={['ADMIN']} />}>
                  <Route path="general"      element={<GeneralSettings />} />
                  <Route path="pipeline"     element={<PipelineSettings />} />
                  <Route path="fields"       element={<FieldsSettings />} />
                  <Route path="users"        element={<UsersSettings />} />
                  <Route path="integrations" element={<IntegrationsSettings />} />
                  <Route path="webhooks"     element={<WebhooksSettings />} />
                  <Route path="audit"        element={<AuditLogSettings />} />
                </Route>
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
