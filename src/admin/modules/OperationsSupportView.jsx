import React from 'react';
import { authenticatedFetch } from '@/lib/api-client.js';
import SystemAdminModuleShell from './SystemAdminModuleShell.jsx';

const SUPPORT_RUNBOOKS = [
  {
    title: 'Security & Health Dashboard',
    description: 'Inspect encryption key status, runtime environment, and cryptographic sanity checks.',
    href: '/system-admin/system-health',
  },
  {
    title: 'Supabase Connection Assistant',
    description: 'Validate schema readiness and deployment prerequisites for control DB integration.',
    href: '/system-admin/supabase-connection',
  },
  {
    title: 'MFA Recovery & Enrollment',
    description: 'Recover authenticator access and enforce AAL2 for privileged administration.',
    href: '/system-admin/mfa',
  },
];

export default function OperationsSupportView() {
  const [filters, setFilters] = React.useState({
    action_type: '',
    action_category: '',
    retention_category: '',
    org_id: '',
  });
  const [state, setState] = React.useState({
    loading: true,
    error: '',
    payload: null,
  });

  const loadOperations = React.useCallback(async (nextFilters = filters) => {
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      const params = {
        limit: 20,
      };
      if (nextFilters.action_type) params.action_type = nextFilters.action_type;
      if (nextFilters.action_category) params.action_category = nextFilters.action_category;
      if (nextFilters.retention_category) params.retention_category = nextFilters.retention_category;
      if (nextFilters.org_id) params.org_id = nextFilters.org_id;

      const payload = await authenticatedFetch('system-admin-operations', {
        method: 'GET',
        params,
      });
      setState({ loading: false, error: '', payload });
    } catch (error) {
      setState({
        loading: false,
        error: error?.message || 'Failed to load operations insights.',
        payload: null,
      });
    }
  }, [filters]);

  React.useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  const summary = state.payload?.summary || {};
  const topActions = Array.isArray(state.payload?.top_actions) ? state.payload.top_actions : [];
  const recentEvents = Array.isArray(state.payload?.recent_events) ? state.payload.recent_events : [];

  const applyFilters = React.useCallback(
    (event) => {
      event.preventDefault();
      loadOperations(filters);
    },
    [filters, loadOperations],
  );

  const setActionFilter = React.useCallback(
    (actionType) => {
      const next = {
        ...filters,
        action_type: actionType,
      };
      setFilters(next);
      loadOperations(next);
    },
    [filters, loadOperations],
  );

  const clearFilters = React.useCallback(() => {
    const next = {
      action_type: '',
      action_category: '',
      retention_category: '',
      org_id: '',
    };
    setFilters(next);
    loadOperations(next);
  }, [loadOperations]);

  return (
    <SystemAdminModuleShell
      title="Operations & Support"
      subtitle="Incident response shortcuts and operational runbooks for platform support."
      actions={
        <button
          type="button"
          onClick={loadOperations}
          disabled={state.loading}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.loading ? 'Refreshing...' : 'Refresh'}
        </button>
      }
    >
      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
      ) : null}

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">Incident Drilldown Filters</h3>
        <form className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5" onSubmit={applyFilters}>
          <input
            type="text"
            value={filters.action_type}
            onChange={(event) => setFilters((previous) => ({ ...previous, action_type: event.target.value }))}
            placeholder="action_type"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none ring-0 transition focus:border-slate-500"
          />
          <input
            type="text"
            value={filters.action_category}
            onChange={(event) => setFilters((previous) => ({ ...previous, action_category: event.target.value }))}
            placeholder="action_category"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none ring-0 transition focus:border-slate-500"
          />
          <input
            type="text"
            value={filters.retention_category}
            onChange={(event) => setFilters((previous) => ({ ...previous, retention_category: event.target.value }))}
            placeholder="retention_category"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none ring-0 transition focus:border-slate-500"
          />
          <input
            type="text"
            value={filters.org_id}
            onChange={(event) => setFilters((previous) => ({ ...previous, org_id: event.target.value }))}
            placeholder="org_id"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none ring-0 transition focus:border-slate-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={state.loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={clearFilters}
              disabled={state.loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Clear
            </button>
          </div>
        </form>
      </article>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Critical Events (24h)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary.critical_events_24h ?? 0}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Standard Events (24h)</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{summary.standard_events_24h ?? 0}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Recent Window</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{recentEvents.length}</p>
        </article>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {SUPPORT_RUNBOOKS.map((runbook) => (
          <article key={runbook.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">{runbook.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{runbook.description}</p>
            <a
              href={`#${runbook.href}`}
              className="mt-4 inline-flex items-center rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Open
            </a>
          </article>
        ))}
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">Top Actions (Current Window)</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {topActions.length === 0 ? (
            <span className="text-sm text-slate-500">No events yet.</span>
          ) : (
            topActions.map((entry) => (
              <button
                key={entry.action}
                type="button"
                onClick={() => setActionFilter(entry.action)}
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
              >
                {entry.action}: {entry.count}
              </button>
            ))
          )}
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">Recent Events</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">When</th>
                <th className="px-3 py-2 text-left font-semibold">Action</th>
                <th className="px-3 py-2 text-left font-semibold">Resource</th>
                <th className="px-3 py-2 text-left font-semibold">Org</th>
                <th className="px-3 py-2 text-left font-semibold">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
              {recentEvents.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={5}>No events available.</td>
                </tr>
              ) : (
                recentEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-3 py-2">{event.performed_at ? new Date(event.performed_at).toLocaleString() : '-'}</td>
                    <td className="px-3 py-2">{event.action_type || '-'}</td>
                    <td className="px-3 py-2">{event.resource_type || '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{event.org_id || '-'}</td>
                    <td className="px-3 py-2">{event.user_email || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">Next Support Enhancements</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>Cross-tenant incident timeline powered by critical audit logs.</li>
          <li>On-demand health probe runner for selected API domains.</li>
          <li>Internal KB article linking by error code and route signature.</li>
        </ul>
      </article>
    </SystemAdminModuleShell>
  );
}
