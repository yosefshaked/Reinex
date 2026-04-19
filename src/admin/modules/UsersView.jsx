import React from 'react';
import { UserCheck, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
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

const PER_PAGE = 50;

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function UsersView() {
  useAdminModuleView('users');

  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [impersonateOpen, setImpersonateOpen] = React.useState(false);
  const impersonation = useImpersonation();

  const load = React.useCallback(async (search, pageNum) => {
    setLoading(true);
    setError(null);
    try {
      const params = { per_page: PER_PAGE, page: pageNum };
      if (search) params.q = search;
      const data = await authenticatedFetch('system-admin-users', {
        method: 'GET',
        params,
      });
      setPayload(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load('', 1); }, [load]);

  const handleSearch = () => {
    setPage(1);
    load(query, 1);
  };

  const handleClear = () => {
    setQuery('');
    setPage(1);
    load('', 1);
  };

  const handlePrev = () => {
    const next = Math.max(1, page - 1);
    setPage(next);
    load(query, next);
  };

  const handleNext = () => {
    const next = page + 1;
    setPage(next);
    load(query, next);
  };

  const users = Array.isArray(payload?.users) ? payload.users : [];
  const total = payload?.total ?? null;
  const hasMore = payload?.has_more ?? false;
  const systemAdminCount = users.filter((u) => u.is_system_admin).length;

  const columns = [
    {
      key: 'subject',
      header: 'User',
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-900">{row.full_name || row.email || '—'}</span>
          {row.full_name && row.email
            ? <span className="text-xs text-slate-500">{row.email}</span>
            : null}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) =>
        row.is_system_admin ? (
          <StatusBadge tone="accent" size="sm">System admin</StatusBadge>
        ) : (
          <StatusBadge tone="neutral" size="sm">User</StatusBadge>
        ),
    },
    {
      key: 'orgs',
      header: 'Orgs',
      cell: (row) => (
        <span className="text-slate-600">{row.org_count ?? 0}</span>
      ),
    },
    {
      key: 'joined',
      header: 'Joined',
      cell: (row) => (
        <span className="text-xs text-slate-500">{formatDate(row.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button
          size="sm"
          variant="outline"
          disabled={!row.email}
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

  return (
    <ModuleShell
      title="Users"
      subtitle="All platform users"
      description="Search every user across the platform. Open a user to see their details. Start a real impersonation session from the row action — all impersonations are reason-gated and audit-logged."
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
        <MetricCard label="Users on this page" value={users.length} />
        <MetricCard label="Total users" value={total ?? '—'} />
        <MetricCard label="System admins (page)" value={systemAdminCount} />
        <MetricCard label="Active impersonation" value={impersonation.active ? 'Yes' : 'No'} />
      </div>

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by email or name…"
        onSubmit={handleSearch}
        onClear={handleClear}
      />

      <DataTable
        columns={columns}
        rows={users}
        loading={loading}
        error={error}
        onRetry={() => load(query, page)}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="No users found"
        emptyDescription="Try a different search term or clear the filter."
      />

      {/* Pagination — only shown in non-search mode */}
      {!query && (
        <div className="flex items-center justify-between pt-1 text-sm text-slate-600">
          <span>
            {total != null ? `${total.toLocaleString()} total users` : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={handlePrev}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <span className="text-xs">Page {page}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore || loading}
              onClick={handleNext}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(selected) && !impersonateOpen}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.full_name || selected?.email || 'User'}
        description={selected?.is_system_admin ? 'System administrator' : 'User'}
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
              <div className="mt-1 break-all text-slate-900">{selected.email || '—'}</div>
            </div>
            {selected.full_name ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Name</div>
                <div className="mt-1 text-slate-900">{selected.full_name}</div>
              </div>
            ) : null}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Role</div>
              <div className="mt-1">
                {selected.is_system_admin
                  ? <StatusBadge tone="accent" size="sm">System admin</StatusBadge>
                  : <StatusBadge tone="neutral" size="sm">User</StatusBadge>}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Organizations</div>
              <div className="mt-1 text-slate-900">{selected.org_count ?? 0} membership{selected.org_count !== 1 ? 's' : ''}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Joined</div>
              <div className="mt-1 text-slate-900">{formatDate(selected.created_at)}</div>
            </div>
            {selected.last_sign_in_at ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Last sign-in</div>
                <div className="mt-1 text-slate-900">{formatDate(selected.last_sign_in_at)}</div>
              </div>
            ) : null}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">User ID</div>
              <div className="mt-1 font-mono text-xs text-slate-500 break-all">{selected.id}</div>
            </div>
          </div>
        ) : null}
      </Drawer>

      <ImpersonateUserDialog
        open={impersonateOpen}
        onOpenChange={setImpersonateOpen}
        targetUser={selected ? { email: selected.email, full_name: selected.full_name } : null}
        targetOrg={null}
      />
    </ModuleShell>
  );
}
