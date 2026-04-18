import React from 'react';
import { authenticatedFetch } from '@/lib/api-client.js';

const HEALTH_ROUTE_CANDIDATES = ['admin-system-health', 'admin-system-health/'];

function shortHash(hash) {
  if (!hash) {
    return 'Not configured';
  }
  return hash.slice(0, 12);
}

function statusTone(status) {
  if (status === 'healthy') {
    return {
      label: 'System Operational',
      badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      connection: 'OK',
      connectionClass: 'text-emerald-700',
    };
  }

  if (status === 'degraded') {
    return {
      label: 'Degraded',
      badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
      connection: 'Degraded',
      connectionClass: 'text-amber-700',
    };
  }

  return {
    label: 'Unreachable',
    badgeClass: 'bg-rose-100 text-rose-700 border-rose-200',
    connection: 'Unavailable',
    connectionClass: 'text-rose-700',
  };
}

function formatError(error, fallback) {
  if (!error) {
    return fallback;
  }

  if (error?.status === 404) {
    return 'System Health API is not available in this deployment yet (404). Deploy the backend functions and try again.';
  }

  if (typeof error === 'string') {
    return error;
  }

  return error.message || fallback;
}

async function fetchSystemHealthWithFallback(options) {
  let lastError = null;

  for (const route of HEALTH_ROUTE_CANDIDATES) {
    try {
      return await authenticatedFetch(route, options);
    } catch (error) {
      lastError = error;
      if (error?.status !== 404) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Failed to reach system health endpoint.');
}

function RotationBadge({ active }) {
  if (active) {
    return (
      <span className="inline-flex rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
        Rotation Fallback Active
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
      Stable
    </span>
  );
}

export default function SystemHealthView() {
  const [state, setState] = React.useState({
    loading: true,
    error: '',
    payload: null,
    lastLoadedAt: '',
  });
  const [sanityCheck, setSanityCheck] = React.useState({
    loading: false,
    status: '',
    message: '',
    checkedAt: '',
  });

  const loadHealth = React.useCallback(async () => {
    setState((previous) => ({
      ...previous,
      loading: true,
      error: '',
    }));

    try {
      const payload = await fetchSystemHealthWithFallback({ method: 'GET' });
      setState({
        loading: false,
        error: '',
        payload,
        lastLoadedAt: new Date().toISOString(),
      });
    } catch (error) {
      setState({
        loading: false,
        error: formatError(error, 'Failed to load system health.'),
        payload: null,
        lastLoadedAt: '',
      });
    }
  }, []);

  React.useEffect(() => {
    let active = true;

    (async () => {
      try {
        const payload = await fetchSystemHealthWithFallback({ method: 'GET' });
        if (!active) return;
        setState({
          loading: false,
          error: '',
          payload,
          lastLoadedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (!active) return;
        setState({
          loading: false,
          error: formatError(error, 'Failed to load system health.'),
          payload: null,
          lastLoadedAt: '',
        });
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const runSanityCheck = React.useCallback(async () => {
    setSanityCheck({
      loading: true,
      status: '',
      message: '',
      checkedAt: '',
    });

    try {
      const result = await fetchSystemHealthWithFallback({
        method: 'POST',
        params: { action: 'sanity-check' },
      });

      const success = Boolean(result?.success);
      setSanityCheck({
        loading: false,
        status: success ? 'success' : 'error',
        message: success
          ? 'Encryption sanity check passed. Current key can encrypt/decrypt safely.'
          : result?.message || 'Sanity check failed.',
        checkedAt: result?.checked_at || new Date().toISOString(),
      });

      if (success) {
        await loadHealth();
      }
    } catch (error) {
      setSanityCheck({
        loading: false,
        status: 'error',
        message: formatError(error, 'Sanity check request failed.'),
        checkedAt: new Date().toISOString(),
      });
    }
  }, [loadHealth]);

  const healthStatus = state.payload?.status || 'unknown';
  const tone = statusTone(healthStatus);
  const encryption = state.payload?.encryption || {};

  return (
    <section dir="ltr" className="space-y-5 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Security & Health Dashboard</h2>
          <p className="mt-1 text-sm text-slate-600">
            Monitor system status, encryption key metadata, and run cryptographic sanity checks.
          </p>
        </div>

        <button
          type="button"
          onClick={loadHealth}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state.loading}
        >
          {state.loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Status Overview</h3>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.badgeClass}`}>
              {tone.label}
            </span>
          </div>

          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-600">Environment</dt>
              <dd className="font-medium text-slate-900">{state.payload?.environment || 'Unknown'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-600">Supabase Connection</dt>
              <dd className={`font-semibold ${tone.connectionClass}`}>{tone.connection}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-600">Last Updated</dt>
              <dd className="font-medium text-slate-800">
                {state.lastLoadedAt ? new Date(state.lastLoadedAt).toLocaleString() : 'Not loaded'}
              </dd>
            </div>
          </dl>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Encryption Keys</h3>
            <RotationBadge active={Boolean(encryption?.is_rotation_active)} />
          </div>

          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-600">Current Key Hash</dt>
              <dd className="font-mono font-medium text-slate-900">{shortHash(encryption?.current_hash)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-600">Previous Key Hash</dt>
              <dd className="font-mono font-medium text-slate-900">{shortHash(encryption?.previous_hash)}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-600">
                Hashes are truncated for display. Full secrets are never exposed in this UI.
              </p>
            </div>
          </dl>
        </article>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Sanity Check Tool</h3>
            <p className="mt-1 text-sm text-slate-600">
              Validates active encryption by running a backend encrypt/decrypt cycle.
            </p>
          </div>

          <button
            type="button"
            onClick={runSanityCheck}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={sanityCheck.loading}
          >
            {sanityCheck.loading ? 'Running...' : 'Run Encryption Sanity Check'}
          </button>
        </div>

        {sanityCheck.message ? (
          <div
            className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              sanityCheck.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            <p>{sanityCheck.message}</p>
            {sanityCheck.checkedAt ? (
              <p className="mt-1 text-xs opacity-80">Checked at: {new Date(sanityCheck.checkedAt).toLocaleString()}</p>
            ) : null}
          </div>
        ) : null}
      </article>

      <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
          How to Rotate Keys
        </summary>
        <div className="mt-4 space-y-2 text-sm text-slate-700">
          <p>1. Set SECURITY_ENCRYPTION_SECRET_OLD to the current production secret.</p>
          <p>2. Set SECURITY_ENCRYPTION_SECRET to the new secret value.</p>
          <p>3. Restart the Azure Function App so the new environment values are loaded.</p>
          <p>4. Run the Encryption Sanity Check and confirm it passes before continuing.</p>
        </div>
      </details>
    </section>
  );
}
