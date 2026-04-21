import React from 'react';
import {
  UserCheck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ShieldOff,
  Shield,
  Monitor,
  LogOut,
  Building2,
  RefreshCw,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ModuleShell from '../ui/ModuleShell.jsx';
import DataTable from '../ui/DataTable.jsx';
import FilterBar from '../ui/FilterBar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import Drawer from '../ui/Drawer.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import ConfirmActionDialog from '../ui/ConfirmActionDialog.jsx';
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

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function parseUserAgent(ua) {
  if (!ua) return null;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android';
  if (/edg\//i.test(ua)) return 'Edge';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Browser';
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-slate-800">{children}</div>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div className="pt-1 pb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400 border-b border-slate-100">
      {children}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[80, 60, 100, 70].map((w, i) => (
        <div key={i} className="space-y-1">
          <div className="h-2.5 w-20 rounded bg-slate-100" />
          <div className={`h-4 rounded bg-slate-100`} style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

const ROLE_TONES = {
  owner: 'accent',
  admin: 'info',
  office: 'info',
  instructor: 'neutral',
  member: 'neutral',
};

/** Lazy-fetch detail for the open user. Resets when userId changes. */
function useUserDetail(userId) {
  const [detail, setDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (!userId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    authenticatedFetch('system-admin-user-detail', { method: 'GET', params: { user_id: userId } })
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  return { detail, loading, error };
}

// ---------------------------------------------------------------------------
// Drawer tab panels
// ---------------------------------------------------------------------------

function OverviewTab({ selected, detail, loading }) {
  const user = detail?.user;
  return (
    <div className="space-y-3 pt-2">
      <Field label="Email">
        <span className="break-all">{selected.email || '—'}</span>
        {user?.email_confirmed_at ? (
          <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-emerald-600">
            <ShieldCheck className="h-3 w-3" /> confirmed
          </span>
        ) : user ? (
          <span className="ml-2 text-xs text-amber-600">unconfirmed</span>
        ) : null}
      </Field>

      {selected.full_name ? (
        <Field label="Name">{selected.full_name}</Field>
      ) : null}

      <Field label="Role">
        {selected.is_system_admin
          ? <StatusBadge tone="accent" size="sm">System admin</StatusBadge>
          : <StatusBadge tone="neutral" size="sm">User</StatusBadge>}
      </Field>

      <Field label="Joined">{formatDate(selected.created_at)}</Field>

      {selected.last_sign_in_at ? (
        <Field label="Last sign-in">{formatDateTime(selected.last_sign_in_at)}</Field>
      ) : null}

      {loading && !user ? <DetailSkeleton /> : null}

      {user?.phone ? (
        <Field label="Phone">
          {user.phone}
          {user.phone_confirmed_at ? (
            <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-emerald-600">
              <ShieldCheck className="h-3 w-3" /> confirmed
            </span>
          ) : null}
        </Field>
      ) : null}

      {user?.banned_until ? (
        <Field label="Banned until">
          <span className="text-rose-600">{formatDateTime(user.banned_until)}</span>
        </Field>
      ) : null}

      {Array.isArray(user?.identities) && user.identities.length > 0 ? (
        <div>
          <SectionHeading>Sign-in methods</SectionHeading>
          <div className="mt-2 space-y-1">
            {user.identities.map((id) => (
              <div key={id.provider} className="flex items-center justify-between text-xs">
                <span className="capitalize text-slate-700">{id.provider}</span>
                <span className="text-slate-400">{formatDate(id.last_sign_in_at)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <SectionHeading>User ID</SectionHeading>
        <div className="mt-1.5 font-mono text-xs text-slate-500 break-all">{selected.id}</div>
      </div>
    </div>
  );
}

function SecurityTab({ detail, loading, onForceSignOut }) {
  const factors = detail?.factors ?? [];
  const sessions = detail?.sessions ?? [];

  return (
    <div className="space-y-4 pt-2">
      {/* MFA factors */}
      <div>
        <SectionHeading>MFA factors</SectionHeading>
        {loading && !detail ? (
          <div className="mt-2 h-10 animate-pulse rounded bg-slate-100" />
        ) : factors.length === 0 ? (
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <ShieldOff className="h-4 w-4 text-slate-300" />
            No MFA enrolled
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {factors.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-800 capitalize">
                      {f.friendly_name || f.factor_type}
                    </div>
                    {f.friendly_name ? (
                      <div className="text-xs text-slate-400 uppercase">{f.factor_type}</div>
                    ) : null}
                  </div>
                </div>
                <StatusBadge
                  tone={f.status === 'verified' ? 'success' : 'warning'}
                  size="sm"
                >
                  {f.status}
                </StatusBadge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active sessions */}
      <div>
        <SectionHeading>Active sessions</SectionHeading>
        {loading && !detail ? (
          <div className="mt-2 h-10 animate-pulse rounded bg-slate-100" />
        ) : sessions.length === 0 ? (
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <Monitor className="h-4 w-4 text-slate-300" />
            No active sessions
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {sessions.map((s, i) => (
              <div key={s.id ?? i} className="rounded-md border border-slate-100 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 font-medium text-slate-700">
                    <Monitor className="h-3.5 w-3.5 text-slate-400" />
                    {s.user_agent ? parseUserAgent(s.user_agent) : 'Session'}
                  </span>
                  {s.ip ? <span className="font-mono text-slate-400">{s.ip}</span> : null}
                </div>
                <div className="mt-0.5 text-slate-400">
                  Created {formatDateTime(s.created_at)}
                  {s.refreshed_at ? ` · Active ${formatDateTime(s.refreshed_at)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Force sign-out */}
      {detail ? (
        <div className="rounded-md border border-rose-100 bg-rose-50 p-3">
          <div className="text-xs font-medium text-rose-800">Force sign-out</div>
          <p className="mt-0.5 text-xs text-rose-700">
            Immediately revokes all active sessions for this user across all devices.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 border-rose-300 text-rose-700 hover:bg-rose-100"
            onClick={onForceSignOut}
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            Sign out all devices
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function OrganizationsTab({ selected, detail, loading }) {
  const memberships = detail?.memberships ?? null;

  return (
    <div className="space-y-2 pt-2">
      {loading && !detail ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ) : memberships === null ? null
        : memberships.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Building2 className="h-4 w-4 text-slate-300" />
            No organization memberships
          </div>
        ) : (
          memberships.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-slate-800">{m.org_name}</div>
                <div className="text-xs text-slate-400">Joined {formatDate(m.joined_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                {!m.is_active ? (
                  <StatusBadge tone="warning" size="sm">inactive</StatusBadge>
                ) : null}
                <StatusBadge tone={ROLE_TONES[m.role] ?? 'neutral'} size="sm">
                  {m.role}
                </StatusBadge>
              </div>
            </div>
          ))
        )}

      {/* Fallback: if detail not loaded yet, show count from list row */}
      {!detail && !loading && (
        <div className="text-sm text-slate-600">
          {selected.org_count ?? 0} membership{selected.org_count !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UsersView() {
  useAdminModuleView('users');

  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [impersonateOpen, setImpersonateOpen] = React.useState(false);
  const [forceSignOutOpen, setForceSignOutOpen] = React.useState(false);
  const [forceSignOutWorking, setForceSignOutWorking] = React.useState(false);
  const impersonation = useImpersonation();

  const { detail, loading: detailLoading } = useUserDetail(selected?.id ?? null);

  const load = React.useCallback(async (search, pageNum) => {
    setLoading(true);
    setError(null);
    try {
      const params = { per_page: PER_PAGE, page: pageNum };
      if (search) params.q = search;
      const data = await authenticatedFetch('system-admin-users', { method: 'GET', params });
      setPayload(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load('', 1); }, [load]);

  const handleSearch = () => { setPage(1); load(query, 1); };
  const handleClear = () => { setQuery(''); setPage(1); load('', 1); };
  const handlePrev = () => { const n = Math.max(1, page - 1); setPage(n); load(query, n); };
  const handleNext = () => { const n = page + 1; setPage(n); load(query, n); };

  const handleForceSignOut = async ({ reason } = {}) => {
    if (!selected?.id) return;
    setForceSignOutWorking(true);
    try {
      await authenticatedFetch('system-admin-user-detail', {
        method: 'POST',
        body: { action: 'force_signout', user_id: selected.id, reason },
      });
      setForceSignOutOpen(false);
    } finally {
      setForceSignOutWorking(false);
    }
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
      cell: (row) => <span className="text-slate-600">{row.org_count ?? 0}</span>,
    },
    {
      key: 'joined',
      header: 'Joined',
      cell: (row) => <span className="text-xs text-slate-500">{formatDate(row.created_at)}</span>,
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
          onClick={(e) => {
            e.stopPropagation();
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
      description="Search every user across the platform. Open a user to see their details, MFA status, and active sessions."
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

      {!query && (
        <div className="flex items-center justify-between pt-1 text-sm text-slate-600">
          <span>{total != null ? `${total.toLocaleString()} total users` : ''}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={handlePrev}>
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <span className="text-xs">Page {page}</span>
            <Button variant="outline" size="sm" disabled={!hasMore || loading} onClick={handleNext}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Detail drawer                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Drawer
        open={Boolean(selected) && !impersonateOpen}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.full_name || selected?.email || 'User'}
        description={selected?.is_system_admin ? 'System administrator' : 'User'}
        width="lg"
        badge={
          detailLoading ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />
          ) : null
        }
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
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
              <TabsTrigger value="security" className="flex-1">Security</TabsTrigger>
              <TabsTrigger value="organizations" className="flex-1">Organizations</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <OverviewTab selected={selected} detail={detail} loading={detailLoading} />
            </TabsContent>

            <TabsContent value="security">
              <SecurityTab
                detail={detail}
                loading={detailLoading}
                onForceSignOut={() => setForceSignOutOpen(true)}
              />
            </TabsContent>

            <TabsContent value="organizations">
              <OrganizationsTab selected={selected} detail={detail} loading={detailLoading} />
            </TabsContent>
          </Tabs>
        ) : null}
      </Drawer>

      <ImpersonateUserDialog
        open={impersonateOpen}
        onOpenChange={setImpersonateOpen}
        targetUser={selected ? { email: selected.email, full_name: selected.full_name } : null}
        targetOrg={null}
      />

      <ConfirmActionDialog
        open={forceSignOutOpen}
        onOpenChange={setForceSignOutOpen}
        title="Sign out all devices"
        description={`This will immediately revoke all active sessions for ${selected?.full_name || selected?.email || 'this user'} across every device. They will need to sign in again.`}
        confirmLabel="Sign out all devices"
        severity="destructive"
        requireReason
        loading={forceSignOutWorking}
        onConfirm={handleForceSignOut}
      />
    </ModuleShell>
  );
}
