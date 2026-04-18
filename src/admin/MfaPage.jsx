import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuthClient } from '@/lib/supabase-manager.js';
import { adminAuthProvider } from './authProvider.js';

function extractErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }

  if (typeof error === 'string') {
    return error;
  }

  return error.message || fallback;
}

function normalizeCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function getAalLevel(payload) {
  return payload?.currentLevel || payload?.current_level || 'aal1';
}

const MFA_FRIENDLY_NAME = 'Reinex System Admin';
const MFA_ISSUER = 'Reinex Admin';

async function getAuthenticatorAssuranceLevel(authClient) {
  if (typeof authClient?.auth?.getAuthenticatorAssuranceLevel === 'function') {
    return authClient.auth.getAuthenticatorAssuranceLevel();
  }

  if (typeof authClient?.auth?.mfa?.getAuthenticatorAssuranceLevel === 'function') {
    return authClient.auth.mfa.getAuthenticatorAssuranceLevel();
  }

  return { data: null, error: null };
}

function listAllTotpFactors(listData) {
  const directTotp = Array.isArray(listData?.totp) ? listData.totp : [];
  const allFactors = Array.isArray(listData?.all) ? listData.all : [];
  const merged = [...directTotp, ...allFactors.filter((factor) => factor?.factor_type === 'totp')];
  const unique = new Map();

  for (const factor of merged) {
    if (factor?.id && !unique.has(factor.id)) {
      unique.set(factor.id, factor);
    }
  }

  return Array.from(unique.values());
}

async function clearPendingTotpFactors(authClient, factorsData, keepFactorId = '') {
  const factors = listAllTotpFactors(factorsData);
  const pendingFactors = factors.filter(
    (factor) => factor?.id && factor.id !== keepFactorId && factor?.status !== 'verified'
  );

  for (const factor of pendingFactors) {
    const { error } = await authClient.auth.mfa.unenroll({ factorId: factor.id });
    if (error) {
      throw error;
    }
  }
}

async function clearTotpFactors(authClient, factorsData, { includeVerified = false } = {}) {
  const factors = listAllTotpFactors(factorsData);
  const factorsToRemove = factors.filter((factor) => {
    if (!factor?.id) return false;
    if (includeVerified) return true;
    return factor?.status !== 'verified';
  });

  for (const factor of factorsToRemove) {
    const { error } = await authClient.auth.mfa.unenroll({ factorId: factor.id });
    if (error) {
      throw error;
    }
  }
}

function normalizeFactorsForDisplay(listData) {
  return listAllTotpFactors(listData).map((factor) => ({
    id: factor?.id || '',
    status: factor?.status || 'unknown',
    friendlyName: factor?.friendly_name || factor?.friendlyName || 'Authenticator',
    createdAt: factor?.created_at || factor?.createdAt || '',
  }));
}

function toQrDataUri(rawQrCode) {
  if (!rawQrCode) {
    return '';
  }

  if (rawQrCode.startsWith('data:image/')) {
    return rawQrCode;
  }

  if (rawQrCode.startsWith('<svg')) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(rawQrCode)}`;
  }

  return rawQrCode;
}

export default function MfaPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({
    loading: true,
    submitting: false,
    mode: 'loading',
    aalLevel: 'aal1',
    factorId: '',
    challengeId: '',
    factors: [],
    qrCode: '',
    secret: '',
    code: '',
    info: '',
    error: '',
  });

  const completeApprovedNavigation = React.useCallback(async () => {
    const result = await adminAuthProvider.check();

    if (result?.redirectTo) {
      if (result.redirectTo === '/system-admin/mfa') {
        throw new Error('MFA verification was not approved yet. Please try a fresh code.');
      }
      navigate(result.redirectTo, { replace: true });
      return;
    }

    if (!result?.authenticated) {
      throw new Error('MFA approval failed for this session. Please sign in again.');
    }

    navigate('/system-admin', { replace: true });
  }, [navigate]);

  const bootstrap = React.useCallback(async ({ resetEnrollment = false, forceEnroll = false } = {}) => {
    const authClient = getAuthClient();

    const adminPermission = await adminAuthProvider.getPermissions();
    if (!adminPermission) {
      navigate('/dashboard', { replace: true });
      return;
    }

    setState((previous) => ({
      ...previous,
      loading: true,
      error: '',
      info: '',
      code: '',
    }));

    const { data: aalData, error: aalError } = await getAuthenticatorAssuranceLevel(authClient);
    if (aalError) {
      throw aalError;
    }

    const currentAalLevel = getAalLevel(aalData);

    const { data: factorsData, error: factorsError } = await authClient.auth.mfa.listFactors();
    if (factorsError) {
      throw factorsError;
    }

    if (resetEnrollment) {
      await clearTotpFactors(authClient, factorsData, { includeVerified: true });
    }

    const { data: refreshedFactorsData, error: refreshedFactorsError } = await authClient.auth.mfa.listFactors();
    if (refreshedFactorsError) {
      throw refreshedFactorsError;
    }

    const factorsForDisplay = normalizeFactorsForDisplay(refreshedFactorsData);

    const totpFactors = listAllTotpFactors(refreshedFactorsData);
    const verifiedTotpFactor = totpFactors.find((factor) => factor?.status === 'verified') || null;
    const pendingTotpFactor = totpFactors.find((factor) => factor?.status !== 'verified') || null;

    if (currentAalLevel === 'aal2' && !forceEnroll) {
      setState((previous) => ({
        ...previous,
        loading: false,
        mode: 'manage',
        aalLevel: currentAalLevel,
        factors: factorsForDisplay,
        factorId: '',
        challengeId: '',
        qrCode: '',
        secret: '',
        info: 'You are already verified. You can manage authenticator connections below.',
        error: '',
      }));
      return;
    }

    if (verifiedTotpFactor?.id) {
      const { data: challengeData, error: challengeError } = await authClient.auth.mfa.challenge({
        factorId: verifiedTotpFactor.id,
      });

      if (challengeError) {
        throw challengeError;
      }

      setState((previous) => ({
        ...previous,
        loading: false,
        mode: 'challenge',
        aalLevel: currentAalLevel,
        factors: factorsForDisplay,
        factorId: verifiedTotpFactor.id,
        challengeId: challengeData?.id || challengeData?.challengeId || challengeData?.challenge_id || '',
        qrCode: '',
        secret: '',
        info: 'Enter the 6-digit code from your authenticator app to continue.',
        error: '',
      }));
      return;
    }

    if (pendingTotpFactor?.id) {
      await clearPendingTotpFactors(authClient, refreshedFactorsData);
    }

    const { data: enrollData, error: enrollError } = await authClient.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: MFA_FRIENDLY_NAME,
      issuer: MFA_ISSUER,
    });
    if (enrollError) {
      throw enrollError;
    }

    setState((previous) => ({
      ...previous,
      loading: false,
      mode: 'enroll',
      aalLevel: currentAalLevel,
      factors: factorsForDisplay,
      factorId: enrollData?.id || '',
      challengeId: '',
      qrCode: enrollData?.totp?.qr_code || '',
      secret: enrollData?.totp?.secret || '',
      info: 'Scan the QR code, then enter the first 6-digit code to verify setup.',
      error: '',
    }));
  }, [navigate]);

  React.useEffect(() => {
    let active = true;

    (async () => {
      try {
        await bootstrap();
      } catch (error) {
        if (!active) {
          return;
        }

        setState((previous) => ({
          ...previous,
          loading: false,
          mode: 'error',
          error: extractErrorMessage(error, 'Failed to initialize MFA. Please try again.'),
          info: '',
        }));
      }
    })();

    return () => {
      active = false;
    };
  }, [bootstrap]);

  const handleCodeChange = React.useCallback((event) => {
    const nextCode = normalizeCode(event.target.value);
    setState((previous) => ({
      ...previous,
      code: nextCode,
      error: '',
    }));
  }, []);

  const ensureChallenge = React.useCallback(async (authClient, factorId, currentChallengeId) => {
    if (currentChallengeId) {
      return currentChallengeId;
    }

    const { data: challengeData, error: challengeError } = await authClient.auth.mfa.challenge({ factorId });
    if (challengeError) {
      throw challengeError;
    }

    return challengeData?.id || challengeData?.challengeId || challengeData?.challenge_id || '';
  }, []);

  const handleSubmit = React.useCallback(
    async (event) => {
      event.preventDefault();

      const verificationCode = normalizeCode(state.code);
      if (verificationCode.length !== 6) {
        setState((previous) => ({
          ...previous,
          error: 'Enter a valid 6-digit code.',
        }));
        return;
      }

      if (!state.factorId) {
        setState((previous) => ({
          ...previous,
          error: 'No MFA factor was found. Refresh and try again.',
        }));
        return;
      }

      const authClient = getAuthClient();

      setState((previous) => ({
        ...previous,
        submitting: true,
        error: '',
      }));

      try {
        const challengeId = await ensureChallenge(authClient, state.factorId, state.challengeId);

        const { error: verifyError } = await authClient.auth.mfa.verify({
          factorId: state.factorId,
          challengeId,
          code: verificationCode,
        });

        if (verifyError) {
          throw verifyError;
        }

        const { data: aalData, error: aalError } = await getAuthenticatorAssuranceLevel(authClient);
        if (aalError) {
          throw aalError;
        }

        if (getAalLevel(aalData) !== 'aal2') {
          throw new Error('The verification code was not approved for an AAL2 session. Please try again.');
        }

        await completeApprovedNavigation();
      } catch (error) {
        setState((previous) => ({
          ...previous,
          submitting: false,
          challengeId: '',
          error: extractErrorMessage(error, 'Verification failed. Please try again.'),
        }));
      }
    },
    [completeApprovedNavigation, ensureChallenge, state.challengeId, state.code, state.factorId]
  );

  const handleRetry = React.useCallback(async () => {
    try {
      await bootstrap({ resetEnrollment: state.mode === 'enroll' });
    } catch (error) {
      setState((previous) => ({
        ...previous,
        loading: false,
        mode: 'error',
        error: extractErrorMessage(error, 'Failed to reload MFA state. Please try again.'),
      }));
    }
  }, [bootstrap, state.mode]);

  const handleReconnect = React.useCallback(async () => {
    if (!window.confirm('This will disconnect existing authenticator factors and start a fresh enrollment flow. Continue?')) {
      return;
    }

    try {
      await bootstrap({ resetEnrollment: true, forceEnroll: true });
    } catch (error) {
      setState((previous) => ({
        ...previous,
        loading: false,
        mode: 'error',
        error: extractErrorMessage(error, 'Failed to reset MFA connection. Please try again.'),
      }));
    }
  }, [bootstrap]);

  const qrSrc = toQrDataUri(state.qrCode);

  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">Multi-Factor Authentication</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        System Admin access requires an AAL2 session. Use your authenticator app to complete verification.
      </p>

      {state.loading ? <p className="mt-6 text-sm text-slate-500">Preparing MFA challenge...</p> : null}

      {!state.loading && state.mode === 'enroll' ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-700">Scan this QR code with Google Authenticator or Authy.</p>

          {qrSrc ? (
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-3">
              <img src={qrSrc} alt="TOTP enrollment QR code" className="h-48 w-48" />
            </div>
          ) : null}

          {state.secret ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Manual setup secret</p>
              <p className="mt-1 break-all font-mono text-sm text-slate-800">{state.secret}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {!state.loading && state.mode === 'challenge' ? (
        <p className="mt-6 text-sm text-slate-700">Enter your current 6-digit authenticator code to continue.</p>
      ) : null}

      {!state.loading && (state.mode === 'enroll' || state.mode === 'challenge') ? (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Authentication code</span>
            <input
              className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base tracking-[0.16em] outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={state.code}
              onChange={handleCodeChange}
              placeholder="123456"
              disabled={state.submitting}
            />
          </label>

          {state.info ? <p className="text-sm text-slate-600">{state.info}</p> : null}

          {state.error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={state.submitting}
            >
              {state.submitting ? 'Verifying...' : 'Verify code'}
            </button>

            <button
              type="button"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleRetry}
              disabled={state.submitting}
            >
              Refresh challenge
            </button>

            <button
              type="button"
              className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleReconnect}
              disabled={state.submitting}
            >
              Lost authenticator? Reconnect
            </button>
          </div>
        </form>
      ) : null}

      {!state.loading && state.mode === 'manage' ? (
        <div className="mt-6 space-y-4">
          {state.info ? <p className="text-sm text-slate-600">{state.info}</p> : null}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Registered MFA factors</h3>
            {Array.isArray(state.factors) && state.factors.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {state.factors.map((factor) => (
                  <li key={factor.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">{factor.friendlyName}</p>
                    <p className="text-xs text-slate-600">Status: {factor.status}</p>
                    {factor.createdAt ? (
                      <p className="text-xs text-slate-500">Created: {new Date(factor.createdAt).toLocaleString()}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-600">No MFA factors are enrolled yet.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={handleRetry}
            >
              Refresh MFA state
            </button>
            <button
              type="button"
              className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-50"
              onClick={handleReconnect}
            >
              Reconnect authenticator
            </button>
          </div>
        </div>
      ) : null}

      {!state.loading && state.mode === 'error' ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {state.error || 'Unable to load MFA flow.'}
          </p>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={handleRetry}
          >
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}
