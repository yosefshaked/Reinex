import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import {
  extractSupabaseParams,
  removeSupabaseParams,
  splitHash,
} from './bootstrapSupabaseCallback.js';

const AuthContext = createContext(null);

const FALLBACK_REDIRECT_URL = import.meta?.env?.VITE_PUBLIC_APP_URL
  || import.meta?.env?.VITE_APP_BASE_URL
  || import.meta?.env?.VITE_SITE_URL
  || null;

const PASSWORD_RESET_HASH_PATH = '#/update-password';

function extractProfile(session) {
  const user = session?.user;
  if (!user) return null;
  const metadata = user.user_metadata || {};
  const name = metadata.full_name
    || metadata.name
    || [metadata.given_name, metadata.family_name].filter(Boolean).join(' ')
    || metadata.preferred_username
    || null;

  return {
    id: user.id,
    email: user.email || metadata.email || null,
    name,
  };
}

function resolveRedirectUrl() {
  if (typeof window !== 'undefined') {
    const { location } = window;
    if (location?.origin) {
      const pathname = typeof location.pathname === 'string' ? location.pathname : '/';
      const originPath = `${location.origin}${pathname}`;
      const searchExtraction = extractSupabaseParams(location.search || '');
      const { path: hashPath, query: hashQuery } = splitHash(location.hash || '');
      const hashExtraction = extractSupabaseParams(hashQuery);

      const sanitizedSearchParams = removeSupabaseParams(new URLSearchParams(searchExtraction.params));
      const sanitizedHashParams = removeSupabaseParams(new URLSearchParams(hashExtraction.params));

      const mergedParams = new URLSearchParams();
      sanitizedHashParams.forEach((value, key) => {
        mergedParams.append(key, value);
      });
      sanitizedSearchParams.forEach((value, key) => {
        mergedParams.append(key, value);
      });

      const mergedQuery = mergedParams.toString();
      const hasSupabasePayload = searchExtraction.hasSupabaseParams || hashExtraction.hasSupabaseParams;

      const shouldForceLoginHash = !hashPath || hashPath.startsWith('#/login') || hasSupabasePayload;
      const normalizedHashPath = shouldForceLoginHash
        ? '#/login/'
        : hashPath;
      const canonicalHash = `${normalizedHashPath}${mergedQuery ? `?${mergedQuery}` : ''}`;

      return `${originPath}${canonicalHash}`;
    }
  }
  if (FALLBACK_REDIRECT_URL) {
    return FALLBACK_REDIRECT_URL;
  }
  return undefined;
}

function resolvePasswordResetRedirectUrl() {
  let baseUrl = null;

  if (typeof window !== 'undefined' && window.location?.origin) {
    baseUrl = window.location.origin;
  } else if (FALLBACK_REDIRECT_URL) {
    baseUrl = FALLBACK_REDIRECT_URL;
  }

  if (!baseUrl) {
    return undefined;
  }

  const sanitizedBase = baseUrl.split('#')[0].replace(/\/+$/, '');
  return `${sanitizedBase}/${PASSWORD_RESET_HASH_PATH}`;
}

export function AuthProvider({ children }) {
  console.log('[DEBUG 6] AuthProvider rendering.');
  const { authClient, session: supabaseSession, loading } = useSupabase();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    setSession(supabaseSession || null);
    setProfile(extractProfile(supabaseSession));
  }, [supabaseSession]);

  const ensureAuthClient = useCallback(() => {
    if (loading) {
      throw new Error('Supabase authentication is still initializing.');
    }
    if (!authClient) {
      throw new Error('Supabase authentication client is unavailable.');
    }
    return authClient;
  }, [authClient, loading]);

  const signOut = useCallback(async () => {
    const client = ensureAuthClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }, [ensureAuthClient]);

  const signInWithEmail = useCallback(async (email, password) => {
    const client = ensureAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, [ensureAuthClient]);

  const signInWithOAuth = useCallback(async (provider) => {
    const client = ensureAuthClient();
    const redirectTo = resolveRedirectUrl();
    const oauthOptions = redirectTo ? { redirectTo } : {};
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: oauthOptions,
    });
    if (error) throw error;
    return data;
  }, [ensureAuthClient]);

  const resetPasswordForEmail = useCallback(async (email) => {
    const client = ensureAuthClient();
    const redirectTo = resolvePasswordResetRedirectUrl();
    const options = redirectTo ? { redirectTo } : undefined;
    const { data, error } = await client.auth.resetPasswordForEmail(email, options);
    if (error) throw error;
    return data;
  }, [ensureAuthClient]);

  const updatePassword = useCallback(async (password) => {
    const client = ensureAuthClient();
    const { data, error } = await client.auth.updateUser({ password });
    if (error) throw error;
    return data;
  }, [ensureAuthClient]);

  const status = loading ? 'loading' : 'ready';

  const value = useMemo(() => ({
    status,
    session,
    user: profile,
    signOut,
    signInWithEmail,
    signInWithOAuth,
    resetPasswordForEmail,
    updatePassword,
  }), [status, session, profile, signOut, signInWithEmail, signInWithOAuth, resetPasswordForEmail, updatePassword]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
