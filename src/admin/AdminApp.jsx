import React from 'react';
import { Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Refine } from '@refinedev/core';
import routerProvider from '@refinedev/react-router';
import dataProvider from '@refinedev/simple-rest';
import { adminAuthProvider } from './authProvider.js';
import MfaPage from './MfaPage.jsx';
import SystemHealthView from './SystemHealthView.jsx';

const adminDataProvider = dataProvider('/api/admin-system-health');

function AdminLayout() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 p-4 md:grid-cols-[250px_1fr]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">System Console</p>
          <h1 className="mt-2 text-xl font-semibold">Reinex Admin</h1>
          <nav className="mt-6 flex flex-col gap-2">
            <Link
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              to="/system-admin/system-health"
            >
              System Health
            </Link>
          </nav>
        </aside>

        <main className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
      <h2 className="text-lg font-semibold">Access denied</h2>
      <p className="mt-2 text-sm leading-6">
        Your account is authenticated but is not marked as a system administrator.
      </p>
    </div>
  );
}

function AdminGate() {
  const [state, setState] = React.useState({ loading: true, result: null });

  React.useEffect(() => {
    let active = true;

    async function runCheck() {
      try {
        const result = await adminAuthProvider.check();
        if (!active) return;
        setState({ loading: false, result });
      } catch {
        if (!active) return;
        setState({
          loading: false,
          result: { authenticated: false, redirectTo: '/login' },
        });
      }
    }

    runCheck();
    return () => {
      active = false;
    };
  }, []);

  if (state.loading) {
    return <p className="p-4 text-sm text-slate-500">Validating admin session...</p>;
  }

  if (state.result?.redirectTo) {
    return <Navigate to={state.result.redirectTo} replace />;
  }

  if (!state.result?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default function AdminApp() {
  return (
    <Refine
      authProvider={adminAuthProvider}
      dataProvider={adminDataProvider}
      routerProvider={routerProvider}
      resources={[
        {
          name: 'system-health',
          list: SystemHealthView,
          meta: {
            label: 'System Health',
          },
        },
      ]}
      options={{
        syncWithLocation: true,
        warnWhenUnsavedChanges: false,
      }}
    >
      <Routes>
        <Route path="mfa" element={<MfaPage />} />
        <Route element={<AdminGate />}>
          <Route index element={<Navigate to="/system-admin/system-health" replace />} />
          <Route element={<AdminLayout />}>
            <Route path="system-health" element={<SystemHealthView />} />
            <Route path="forbidden" element={<AccessDenied />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/system-admin" replace />} />
      </Routes>
    </Refine>
  );
}
