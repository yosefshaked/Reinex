import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import AppShell from './components/layout/AppShell.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import ServicesPage from './pages/ServicesPage.jsx';
import ServiceProfilePage from './pages/ServiceProfilePage.jsx';
import FinancialsPage from './pages/FinancialsPage.jsx';
import StudentsPage from './features/students/pages/StudentsPage.jsx';
import StudentDetailPage from './features/students/pages/StudentDetailPage.jsx';
import WaitingListPage from './features/waiting-list/pages/WaitingListPage.jsx';
import Settings from './pages/Settings.jsx';
import { RuntimeConfigProvider } from './runtime/RuntimeConfigContext.jsx';
import { SupabaseProvider } from './context/SupabaseContext.jsx';
import { isAuthClientInitialized } from './lib/supabase-manager.js';
import Diagnostics from './runtime/Diagnostics.jsx';
import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import UpdatePassword from './pages/UpdatePassword.jsx';
import VerifyEmail from './pages/VerifyEmail.jsx';
import CompleteRegistrationPage from './components/pages/CompleteRegistrationPage.jsx';
import AcceptInvitePage from './components/pages/AcceptInvitePage.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import AuthGuard from './auth/AuthGuard.jsx';
import { OrgProvider } from './org/OrgContext.jsx';
import OrgSelection from './pages/OrgSelection.jsx';
import LandingPage from './pages/LandingPage.jsx';
import PendingReportsPage from './features/sessions/pages/PendingReportsPage.jsx';
import { bootstrapSupabaseCallback } from './auth/bootstrapSupabaseCallback.js';

bootstrapSupabaseCallback();

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  // Intentionally avoid console logging here to prevent accidental data leaks.
  componentDidCatch() {}

  render() {
    // Keep UX minimal; this boundary exists primarily for logging.
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function App({ config = null }) {
  return (
    <RuntimeConfigProvider config={config}>
      <SupabaseProvider>
        <AuthProvider>
          <OrgProvider>
            <HashRouter>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/update-password" element={<UpdatePassword />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/complete-registration" element={<CompleteRegistrationPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />
                <Route element={<AuthGuard />}>
                  <Route path="/select-org" element={<OrgSelection />} />
                  <Route element={<AppShell />}>
                    {/* הגדרת כל העמודים */}
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/Dashboard" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/employees" element={<EmployeesPage />} />
                    <Route path="/Employees" element={<Navigate to="/employees" replace />} />
                    <Route path="/services" element={<ServicesPage />} />
                    <Route path="/services/:id" element={<ServiceProfilePage />} />
                    <Route path="/waiting-list" element={<WaitingListPage />} />
                    <Route path="/students-list" element={<StudentsPage />} />
                    <Route path="/admin/students" element={<Navigate to="/students-list" replace />} />
                    <Route path="/my-students" element={<Navigate to="/students-list" replace />} />
                    <Route path="/instructors" element={<Navigate to="/employees" replace />} />
                    <Route path="/financials" element={<FinancialsPage />} />
                    <Route path="/pending-reports" element={<PendingReportsPage />} />
                    <Route path="/admin/pending-reports" element={<Navigate to="/pending-reports" replace />} />
                    <Route path="/students/:id" element={<StudentDetailPage />} />
                    <Route path="/Settings" element={<Settings />} />
                    <Route path="/diagnostics" element={<Diagnostics />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </HashRouter>
          </OrgProvider>
        </AuthProvider>
      </SupabaseProvider>
    </RuntimeConfigProvider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderApp(config = null) {
  if (!isAuthClientInitialized()) {
    throw new Error(
      'renderApp was invoked before initializeAuthClient completed. Ensure bootstrap initializes Supabase first.'
    );
  }

  const root = ReactDOM.createRoot(document.getElementById('root'));

  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App config={config} />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

export default App;
