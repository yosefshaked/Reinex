import React from 'react';
import { authenticatedFetch } from '@/lib/api-client.js';
import SystemAdminModuleShell from './SystemAdminModuleShell.jsx';

function MetricCard({ label, value }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </article>
  );
}

export default function UserOrgManagementView() {
  const [state, setState] = React.useState({
    loading: true,
    error: '',
    payload: null,
  });
  const [query, setQuery] = React.useState('');
  const [actionState, setActionState] = React.useState({
    busyOrgId: '',
    message: '',
    error: '',
  });

  const loadOverview = React.useCallback(async (search = '') => {
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      const normalizedSearch = String(search || '').trim();
      const payload = await authenticatedFetch('system-admin-users-orgs', {
        method: 'GET',
        params: normalizedSearch ? { q: normalizedSearch, limit: 50 } : { limit: 50 },
      });
      setState({ loading: false, error: '', payload });
    } catch (error) {
      setState({
        loading: false,
        error: error?.message || 'Failed to load user and organization data.',
        payload: null,
      });
    }
  }, []);

  React.useEffect(() => {
    loadOverview('');
  }, [loadOverview]);

  const organizations = Array.isArray(state.payload?.organizations) ? state.payload.organizations : [];
  const systemAdmins = Array.isArray(state.payload?.system_admins) ? state.payload.system_admins : [];

  const handleSubmit = React.useCallback(
    (event) => {
      event.preventDefault();
      loadOverview(query);
    },
    [loadOverview, query],
  );

  const submitOrgAction = React.useCallback(
    async (actionType, orgId) => {
      const reason = window.prompt(`Reason for ${actionType.replace('_', ' ')} on org ${orgId}:`, '');
      if (reason === null) {
        return;
      }

      let targetUserEmail = '';
      if (actionType === 'impersonation_request') {
        const requestedEmail = window.prompt('Target user email for impersonation request:', '');
        if (requestedEmail === null) {
          return;
        }
        targetUserEmail = String(requestedEmail || '').trim();
      }

      setActionState({ busyOrgId: orgId, message: '', error: '' });

      try {
        const payload = await authenticatedFetch('system-admin-user-org-actions', {
          method: 'POST',
          body: {
            action_type: actionType,
            org_id: orgId,
            reason,
            target_user_email: targetUserEmail || undefined,
          },
        });

        setActionState({
          busyOrgId: '',
          error: '',
          message: `Request queued: ${payload?.request?.request_id || actionType}`,
        });
      } catch (error) {
        setActionState({
          busyOrgId: '',
          message: '',
          error: error?.message || `Failed to queue ${actionType}.`,
        });
      }
    },
    [],
  );

  return (
    <SystemAdminModuleShell
      title="User & Org Management"
      subtitle="Platform-level user and organization operations with strict super-admin controls."
      actions={
        <form className="flex items-center gap-2" onSubmit={handleSubmit}>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search email, org name, slug"
            className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none ring-0 transition focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={state.loading}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.loading ? 'Loading...' : 'Search'}
          </button>
        </form>
      }
    >
      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
      ) : null}
      {actionState.message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {actionState.message}
        </p>
      ) : null}
      {actionState.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionState.error}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Organizations" value={organizations.length} />
        <MetricCard
          label="Org Memberships"
          value={organizations.reduce((sum, row) => sum + Number(row.membership_count || 0), 0)}
        />
        <MetricCard label="System Admins" value={systemAdmins.length} />
        <MetricCard
          label="Updated (UTC)"
          value={state.payload?.requested_at ? new Date(state.payload.requested_at).toISOString().slice(11, 19) : '-'}
        />
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">Organizations</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-left font-semibold">Slug</th>
                <th className="px-3 py-2 text-left font-semibold">Members</th>
                <th className="px-3 py-2 text-left font-semibold">Created</th>
                <th className="px-3 py-2 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
              {organizations.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={5}>No organizations found for this filter.</td>
                </tr>
              ) : (
                organizations.map((org) => (
                  <tr key={org.id}>
                    <td className="px-3 py-2 font-medium">{org.name || '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{org.slug || '-'}</td>
                    <td className="px-3 py-2">{org.membership_count ?? 0}</td>
                    <td className="px-3 py-2">{org.created_at ? new Date(org.created_at).toLocaleString() : '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => submitOrgAction('org_suspend', org.id)}
                          disabled={actionState.busyOrgId === org.id}
                          className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Suspend
                        </button>
                        <button
                          type="button"
                          onClick={() => submitOrgAction('org_reactivate', org.id)}
                          disabled={actionState.busyOrgId === org.id}
                          className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Reactivate
                        </button>
                        <button
                          type="button"
                          onClick={() => submitOrgAction('impersonation_request', org.id)}
                          disabled={actionState.busyOrgId === org.id}
                          className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Request Impersonation
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">System Admin Accounts</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Email</th>
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-left font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
              {systemAdmins.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={3}>No system admin users found.</td>
                </tr>
              ) : (
                systemAdmins.map((user) => (
                  <tr key={user.id}>
                    <td className="px-3 py-2 font-medium">{user.email || '-'}</td>
                    <td className="px-3 py-2">{user.full_name || '-'}</td>
                    <td className="px-3 py-2">{user.updated_at ? new Date(user.updated_at).toLocaleString() : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </SystemAdminModuleShell>
  );
}
