import React from 'react';
import { captureAnalyticsEvent, hasPostHogConfigured } from '@/lib/analytics/posthog.js';
import SystemAdminModuleShell from './SystemAdminModuleShell.jsx';

const POSTHOG_WIZARD_COMMAND = 'npx -y @posthog/wizard@latest --region eu';

export default function ProductAnalyticsView() {
  const [status, setStatus] = React.useState('');

  const runTestEvent = React.useCallback(() => {
    const ok = captureAnalyticsEvent('system_admin_test_event', {
      source: 'system-admin-product-analytics',
      triggered_at: new Date().toISOString(),
    });

    if (ok) {
      setStatus('Test event queued to PostHog.');
      return;
    }

    setStatus('PostHog is not configured yet. Set VITE_POSTHOG_KEY (or POSTHOG_KEY via /api/config), without wrapping quotes, then reload.');
  }, []);

  return (
    <SystemAdminModuleShell
      title="Product Analytics"
      subtitle="PostHog integration baseline for product and operations observability."
      actions={
        <button
          type="button"
          onClick={runTestEvent}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Send Test Event
        </button>
      }
    >
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Setup Command</h3>
        <code className="mt-3 block overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          {POSTHOG_WIZARD_COMMAND}
        </code>
        <p className="mt-2 text-sm text-slate-600">
          Run from project root. Keep region as <strong>eu</strong> for your PostHog project.
        </p>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Runtime Status</h3>
        <p className="mt-3 text-sm text-slate-700">
          SDK configured: <strong>{hasPostHogConfigured() ? 'Yes' : 'No'}</strong>
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Expected env keys: <code>VITE_POSTHOG_KEY</code> (or <code>POSTHOG_KEY</code> in Function App settings) and optional <code>VITE_POSTHOG_HOST</code>/<code>POSTHOG_HOST</code>.
        </p>
        {status ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{status}</p>
        ) : null}
      </article>
    </SystemAdminModuleShell>
  );
}
