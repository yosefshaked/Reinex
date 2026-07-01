import React from 'react';
import { exitImpersonation, readStash } from './impersonation-client.js';

/**
 * Provides impersonation state to the rest of the admin shell + app.
 * The banner reads from here. Any component that wants to show "you are
 * impersonating <user>" reads from useImpersonation().
 */

const ImpersonationContext = React.createContext({
  active: false,
  session: null,
  exit: async () => {},
  refreshing: false,
});

function buildSessionView(stash) {
  if (!stash) return null;
  return {
    sessionId: stash.sessionId,
    targetEmail: stash.targetEmail,
    targetName: stash.targetName,
    targetOrgId: stash.targetOrgId,
    targetOrgName: stash.targetOrgName,
    startedAt: stash.startedAt,
    expiresAt: stash.expiresAt,
  };
}

export function ImpersonationProvider({ children }) {
  const [session, setSession] = React.useState(() => buildSessionView(readStash()));
  const [exiting, setExiting] = React.useState(false);

  // Re-read stash on any `reinex:impersonation-changed` event or storage change.
  React.useEffect(() => {
    const sync = () => setSession(buildSessionView(readStash()));
    window.addEventListener('reinex:impersonation-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('reinex:impersonation-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Also watch the expires_at clock — if the session expires while open,
  // clear local state so the banner updates and the admin has to restart.
  React.useEffect(() => {
    if (!session?.expiresAt) return undefined;
    const expiresMs = new Date(session.expiresAt).getTime();
    const msLeft = expiresMs - Date.now();
    if (msLeft <= 0) {
      setSession(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      // We can't silently drop the target session (Supabase cookies remain),
      // so we just clear the stash and let the banner disappear. The admin
      // can re-sign-in from /login. A future improvement is automatic
      // restore here.
      window.sessionStorage.removeItem('reinex_impersonation_v1');
      setSession(null);
    }, msLeft);
    return () => window.clearTimeout(timer);
  }, [session?.expiresAt]);

  const exit = React.useCallback(async () => {
    setExiting(true);
    try {
      await exitImpersonation({ reason: 'admin_exit' });
      setSession(null);
      // Return to the admin console after restoring the admin session.
      window.location.assign('/#/system-admin/users');
    } finally {
      setExiting(false);
    }
  }, []);

  const value = React.useMemo(() => ({
    active: Boolean(session),
    session,
    exit,
    refreshing: exiting,
  }), [session, exit, exiting]);

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useImpersonation() {
  return React.useContext(ImpersonationContext);
}
