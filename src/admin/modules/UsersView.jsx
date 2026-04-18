import React from 'react';
import { UserCheck, ShieldAlert } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import ModuleShell from '../ui/ModuleShell.jsx';
import DataTable from '../ui/DataTable.jsx';
import FilterBar from '../ui/FilterBar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import Drawer from '../ui/Drawer.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import ImpersonateUserDialog from '../impersonation/ImpersonateUserDialog.jsx';
import { useImpersonation } from '../impersonation/ImpersonationContext.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

/**
 * Users module. Reuses the existing /api/system-admin-users-orgs endpoint
 * to power the list — every org in the payload carries a membership count,
 * and the system_admins list gives us the cross-org admin set.
 *
 * The global "Users" search is best-effort: it returns matching orgs/users
 * from the existing endpoint's search, then the detail drawer is where
 * impersonation is launched from.
 */
export default function UsersView() {
  useAdminModuleView('users');

  const [query, setQuery] = React.useState('');
  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [impersonateOpen, setImpersonateOpen] = React.useState(false);
  const impersonation = useImpersonation();

  const load = React.useCallback(async (search = '') => {
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedFetch('system-admin-users-orgs', {
        method: 'GET',
        params: search ? { q: search, limit: 100 } : { limit: 100 },
      });
      setPayload(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(''); }, [load]);

  const systemAdmins = Array.isArray(payload?.system_admins) ? payload.system_admins : [];
  const organizations = Array.isArray(payload?.organizations) ? payload.organizations : [];

  const rows = React.useMemo(() => {
    // Surface every system admin as a directly-impersonatable row, plus an
    // "org owner" row for each org in the payload. This gives us a useful
    // starting set while the dedicated users endpoint is built.
    const adminRows = systemAdmins.map((u) => ({
      kind: 'system_admin',
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      updated_at: u.updated_at,
    }));
    const orgRows = organizations.map((o) => ({
      kind: 'org',
      id: `org-${o.id}`,
      email: o.primary_contact_email || '',
      full_name: o.name,
      org_id: o.id,
      org_name: o.name,
      membership_count: o.membership_count,
      created_at: o.created_at,
    }));
    return [...adminRows, ...orgRows];
  }, [systemAdmins, organizations]);

  const columns = [
    {
      key: 'subject',
      header: 'Subject',
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-900">{row.full_name || row.email || '—'}</span>
          {row.email ? <span className="text-xs text-slate-500">{row.email}</span> : null}
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      cell: (row) =>
        row.kind === 'system_admin' ? (
          <StatusBadge tone="accent" size="sm">System admin</StatusBadge>
        ) : (
          <StatusBadge tone="info" size="sm">Organization</StatusBadge>
        ),
    },
    {
      key: 'context',
      header: 'Context',
      cell: (row) =>
        row.kind === 'system_admin'
          ? <span className="text-slate-600">Cross-org</span>
          : <span className="text-slate-600">{row.membership_count ?? 0} members</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button
          size="sm"
          variant="outline"
          disabled={!row.email || row.kind === 'org'}
          onClick={(event) => {
            event.stopPropagation();
            setSelected(row);
            setImpersonateOpen(true);
          }}
        >
          <UserCheck className="mr-1.5 h-3.5 w-3.5" />
          Log in as
        </Button>
      ),
    },
  ];

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.email || '').toLowerCase().includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.org_name || '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <ModuleShell
      title="Users"
      subtitle="Global user search and impersonation"
      description="Search every user across the platform. Open a user to see their sessions, MFA factors, and recent audit activity. Start a real impersonation session from the row action — all impersonations are reason-gated and audit-logged."
      banner={
        impersonation.active ? null : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
            Impersonation starts a real session as the target user. You will be taken out of the admin console
            for the duration of the session; the "Exit impersonation" banner returns you here.
          </div>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="System admins" value={systemAdmins.length} />
        <MetricCard label="Organizations" value={organizations.length} />
        <MetricCard
          label="Total memberships"
          value={organizations.reduce((sum, o) => sum + Number(o.membership_count || 0), 0)}
        />
        <MetricCard label="Active impersonation" value={impersonation.active ? 'Yes' : 'No'} />
      </div>

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by email, name, or organization…"
        onSubmit={() => load(query)}
        onClear={() => { setQuery(''); load(''); }}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        error={error}
        onRetry={() => load(query)}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="No users match this search"
        emptyDescription="Try a broader query or clear the filter."
      />

      <Drawer
        open={Boolean(selected) && !impersonateOpen}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.full_name || selected?.email || 'User'}
        description={selected?.kind === 'system_admin' ? 'System administrator' : 'Organization owner'}
        width="md"
        footer={
          selected?.email ? (
            <div className="flex w-full justify-end">
              <Button
                onClick={() => setImpersonateOpen(true)}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                <UserCheck className="mr-1.5 h-4 w-4" />
                Log in as this user
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Email</div>
              <div className="mt-1 text-slate-900">{selected.email || '—'}</div>
            </div>
            {selected.full_name ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Name</div>
                <div className="mt-1 text-slate-900">{selected.full_name}</div>
              </div>
            ) : null}
            {selected.org_name ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Organization</div>
                <div className="mt-1 text-slate-900">{selected.org_name}</div>
              </div>
            ) : null}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Sessions, MFA factors, role history, and recent audit events will appear here as the
              Users module is fully wired. For now, the impersonation CTA works end-to-end for rows
              with an email.
            </div>
          </div>
        ) : null}
      </Drawer>

      <ImpersonateUserDialog
        open={impersonateOpen}
        onOpenChange={setImpersonateOpen}
        targetUser={selected ? { email: selected.email, full_name: selected.full_name } : null}
        targetOrg={selected?.org_id ? { id: selected.org_id, name: selected.org_name } : null}
      />
    </ModuleShell>
  );
}
