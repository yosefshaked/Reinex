// src/context/SupabaseContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getAuthClient } from '../lib/supabase-manager.js';
import { onConfigActivated, onConfigCleared } from '../runtime/config.js';
import { useRuntimeConfig } from '../runtime/RuntimeConfigContext.jsx';

const SupabaseContext = createContext(undefined);

function mergeSessionReference(previousSession, nextSession) {
  if (!previousSession || !nextSession) {
    return nextSession ?? null;
  }

  const previousUserId = previousSession?.user?.id || null;
  const nextUserId = nextSession?.user?.id || null;
  if (!previousUserId || !nextUserId || previousUserId !== nextUserId) {
    return nextSession;
  }

  Object.keys(previousSession).forEach((key) => {
    if (!(key in nextSession)) {
      delete previousSession[key];
    }
  });

  Object.assign(previousSession, nextSession);
  return previousSession;
}

export const SupabaseProvider = ({ children }) => {
  const runtimeConfig = useRuntimeConfig();
  const [authClient, setAuthClient] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const normalizedConfig = useMemo(() => {
    if (!runtimeConfig?.supabaseUrl || !runtimeConfig?.supabaseAnonKey) {
      return null;
    }
    return {
      supabaseUrl: runtimeConfig.supabaseUrl,
      supabaseAnonKey: runtimeConfig.supabaseAnonKey,
    };
  }, [runtimeConfig?.supabaseUrl, runtimeConfig?.supabaseAnonKey]);

  const supabaseConfigKey = normalizedConfig
    ? `${normalizedConfig.supabaseUrl}::${normalizedConfig.supabaseAnonKey}`
    : null;

  useEffect(() => {
    let isMounted = true;

    function resolveAuthClient() {
      if (!isMounted) {
        return;
      }

      if (!normalizedConfig) {
        setAuthClient(null);
        setSession(null);
        setLoading(true);
        return;
      }

      try {
        const client = getAuthClient();
        setAuthClient((previous) => (previous === client ? previous : client));
      } catch {
        setAuthClient(null);
        setSession(null);
        setLoading(true);
      }
    }

    resolveAuthClient();

    const unsubscribeActivated = onConfigActivated(() => {
      resolveAuthClient();
    });

    const unsubscribeCleared = onConfigCleared(() => {
      if (!isMounted) {
        return;
      }
      setAuthClient(null);
      setSession(null);
      setLoading(true);
    });

    return () => {
      isMounted = false;
      if (typeof unsubscribeActivated === 'function') {
        unsubscribeActivated();
      }
      if (typeof unsubscribeCleared === 'function') {
        unsubscribeCleared();
      }
    };
  }, [normalizedConfig, supabaseConfigKey]);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe = null;

    if (!authClient) {
      setLoading(true);
      setSession(null);
      return () => {
        isMounted = false;
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    }

    setLoading(true);

    authClient
      .auth
      .getSession()
      .then(({ data }) => {
        if (isMounted) {
          setSession(data?.session ?? null);
        }
      })
      .catch((error) => {
        console.error('[SupabaseProvider] Failed to fetch auth session', error);
        if (isMounted) {
          setSession(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    const { data } = authClient.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) {
        setSession((previousSession) => mergeSessionReference(previousSession, nextSession));
      }
    });

    if (data?.subscription) {
      unsubscribe = () => data.subscription.unsubscribe();
    }

    return () => {
      isMounted = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [authClient]);

  const value = useMemo(() => ({
    authClient,
    session,
    user: session?.user ?? null,
    activeOrg: null,
    loading: loading || !authClient,
  }), [authClient, session, loading]);

  return (
    <SupabaseContext.Provider value={value}>
      {children}
    </SupabaseContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSupabase = () => {
  const context = useContext(SupabaseContext);
  if (context === undefined) {
    throw new Error('useSupabase must be used within a SupabaseProvider');
  }
  return context;
};
