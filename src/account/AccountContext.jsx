import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext.jsx';
import { deactivateMyAccount, fetchMyAccount, reactivateMyAccount, updateMyAccount } from '@/api/me.js';

const AccountContext = createContext(null);

export function AccountProvider({ children }) {
  const { status: authStatus, session } = useAuth();
  const [status, setStatus] = useState('idle');
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);

  const refreshAccount = useCallback(async () => {
    if (!session) {
      setAccount(null);
      setStatus(authStatus === 'loading' ? 'loading' : 'idle');
      return null;
    }

    setStatus('loading');
    setError(null);
    try {
      const nextAccount = await fetchMyAccount({ session });
      setAccount(nextAccount);
      setStatus('ready');
      return nextAccount;
    } catch (loadError) {
      setError(loadError);
      setStatus('error');
      throw loadError;
    }
  }, [authStatus, session]);

  useEffect(() => {
    if (authStatus === 'loading') {
      setStatus('loading');
      return;
    }

    if (!session) {
      setAccount(null);
      setError(null);
      setStatus('idle');
      return;
    }

    let active = true;
    refreshAccount().catch((loadError) => {
      if (!active) return;
      console.error('Failed to load account', loadError);
    });
    return () => {
      active = false;
    };
  }, [authStatus, session, refreshAccount]);

  const saveAccount = useCallback(async (payload) => {
    const nextAccount = await updateMyAccount(payload, { session });
    setAccount(nextAccount);
    setStatus('ready');
    setError(null);
    return nextAccount;
  }, [session]);

  const deactivateAccount = useCallback(async (payload) => {
    const nextAccount = await deactivateMyAccount(payload, { session });
    setAccount(nextAccount);
    setStatus('ready');
    setError(null);
    return nextAccount;
  }, [session]);

  const reactivateAccount = useCallback(async () => {
    const nextAccount = await reactivateMyAccount({ session });
    setAccount(nextAccount);
    setStatus('ready');
    setError(null);
    return nextAccount;
  }, [session]);

  const value = useMemo(() => ({
    status,
    account,
    error,
    refreshAccount,
    saveAccount,
    deactivateAccount,
    reactivateAccount,
    needsSetup: Boolean(account?.needsSetup),
    isDisabled: account?.accountStatus === 'disabled',
  }), [status, account, error, refreshAccount, saveAccount, deactivateAccount, reactivateAccount]);

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
