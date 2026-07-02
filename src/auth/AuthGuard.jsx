import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { useAccount } from '@/account/AccountContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4 text-slate-600">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">טוען...</p>
      </div>
    </div>
  );
}

export default function AuthGuard() {
  const { status: authStatus, session } = useAuth();
  const { status: accountStatus, needsSetup, isDisabled } = useAccount();
  const { status: orgStatus, activeOrgId } = useOrg();
  const location = useLocation();

  if (authStatus === 'loading') {
    return <LoadingScreen />;
  }

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location,
          reason: 'auth-required',
          message: 'היי! צריך להיכנס למערכת כדי להמשיך. התחבר ונחזיר אותך בדיוק לאותו מסך.',
        }}
      />
    );
  }

  if (accountStatus === 'loading' || accountStatus === 'idle') {
    return <LoadingScreen />;
  }

  if (isDisabled && location.pathname !== '/account/reactivate') {
    return <Navigate to="/account/reactivate" replace />;
  }

  const exemptFromSetup = location.pathname === '/account/setup' || location.pathname === '/account/reactivate';
  if (needsSetup && !exemptFromSetup) {
    const returnTo = `${location.pathname}${location.search || ''}`;
    return <Navigate to={`/account/setup?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (orgStatus === 'loading' || orgStatus === 'idle') {
    return <LoadingScreen />;
  }

  const requiresOrgCreation = orgStatus === 'needs-org';
  const requiresOrgSelection = orgStatus === 'needs-selection';

  // Never yank the user off the setup/reactivation pages to go create an org —
  // a brand-new account has BOTH needsSetup=true and orgStatus='needs-org', and
  // without this exemption the two rules ping-pong (/account/setup ⇄ /select-org)
  // in an infinite replace-navigation loop (white screen + Chrome nav throttling).
  // Account setup completes first; only then does the org redirect apply.
  if (requiresOrgCreation && location.pathname !== '/select-org' && !exemptFromSetup) {
    return <Navigate to="/select-org" replace state={{ from: location }} />;
  }

  if (location.pathname === '/select-org') {
    return <Outlet />;
  }

  const isSystemAdminRoute = location.pathname.startsWith('/system-admin');

  if (!requiresOrgCreation && !requiresOrgSelection && !activeOrgId && location.pathname !== '/Settings' && !isSystemAdminRoute) {
    return <Navigate to="/Settings" replace />;
  }

  return <Outlet />;
}
