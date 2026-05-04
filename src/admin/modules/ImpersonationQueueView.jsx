import React from 'react';
import { RefreshCw, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authenticatedFetch } from '@/lib/api-client.js';
import ModuleShell from '../ui/ModuleShell.jsx';
import DataTable from '../ui/DataTable.jsx';
import FilterBar from '../ui/FilterBar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import ConfirmActionDialog from '../ui/ConfirmActionDialog.jsx';
import Drawer from '../ui/Drawer.jsx';
import { fetchImpersonationSessions } from '../impersonation/impersonation-client.js';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function formatDuration(start, end) {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function StatusCell({ status }) {
  const map = {
    active:  { tone: 'success', label: 'Active', dot: true },
    ended:   { tone: 'neutral', label: 'Ended' },
    expired: { tone: 'warning', label: 'Expired' },
    revoked: { tone: 'danger',  label: 'Revoked' },
  };
  const m = map[status] || { tone: 'neutral', label: status || '—' };
  return <StatusBadge tone={m.tone} dot={m.dot} size="sm">{m.label}</StatusBadge>;
}

export default function ImpersonationQueueView() {
  useAdminModuleView('impersonation-queue');

  const [status, setStatus] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [revokeTarget, setRevokeTarget] = React.useState(null);
  const [revoking, setRevoking] = React.useState(false);

  const load = React.useCallback(async (targetEmail = '') => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchImpersonationSessions({ status, limit: 100, targetEmail });
      setPayload(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => { load(''); }, [load]);

  const handleForceRevoke = async ({ reason }) => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await authenticatedFetch('system-admin-impersonation-exit', {
        method: 'POST',
        body: {
          session_id: revokeTarget.id,
          reason: reason || 'force_revoked_by_admin',
          force_revoke: true,
        },
      });
      captureAdminEvent('impersonation_force_revoked', { has_session_id: Boolean(revokeTarget.id) });
      setRevokeTarget(null);
      setSelected(null);
      await load(query);
    } finally {
      setRevoking(false);
    }
  };

  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const activeCount = payload?.active_count ?? 0;

  const columns = [
    {
      key: 'started_at',
      header: 'Started',
      cell: (row) => (
        <span className="whitespace-nowrap text-xs text-slate-700">
          {formatDateTime(row.started_at)}
        </span>
      ),
    },
    {
      key: 'admin_email',
      header: 'Admin',
      cell: (row) => (
        <span className="text-xs text-slate-900">{row.admin_email || '—'}</span>
      ),
    },
    {
      key: 'target_email',
      header: 'Target',
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-900">{row.target_email}</span>
          {row.target_org_name ? (
            <span className="text-xs text-slate-500">{row.target_org_name}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (row) => (
        <span className="line-clamp-2 block max-w-xs text-xs text-slate-700">
          {row.reason || '—'}
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      cell: (row) => (
        <span className="text-xs text-slate-600">
          {formatDuration(row.started_at, row.ended_at)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusCell status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) =>
        row.status === 'active' ? (
          <Button
            size="sm"
            variant="outline"
            className="border-rose-300 text-rose-700 hover:bg-rose-50"
            onClick={(e) => { e.stopPropagation(); setRevokeTarget(row); }}
          >
            <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
            Revoke
          </Button>
        ) : null,
    },
  ];

  const chips = (
    <>
      {['all', 'active', 'ended'].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setStatus(s)}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
            status === s
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Ended / expired / revoked'}
        </button>
      ))}
    </>
  );

  return (
    <ModuleShell
      title="Impersonation Queue"
      subtitle="Active sessions, approvals, and history"
      description="Every impersonation session initiated from the admin console. Active sessions can be force-revoked from this view — the target user's session is terminated server-side and recorded in the audit log."
      actions={
        <Button variant="outline" size="sm" onClick={() => load(query)}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Active sessions" value={activeCount} hint="Currently in-progress" />
        <MetricCard label="Listed" value={sessions.length} hint="Matching current filter" />
        <MetricCard
          label="Most recent"
          value={sessions[0]?.started_at ? formatDateTime(sessions[0].started_at) : '—'}
        />
        <MetricCard
          label="Unique admins"
          value={new Set(sessions.map((s) => s.admin_email)).size}
        />
      </div>

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Filter by target email…"
        onSubmit={() => load(query)}
        onClear={() => { setQuery(''); load(''); }}
        chips={chips}
      />

      <DataTable
        columns={columns}
        rows={sessions}
        loading={loading}
        error={error}
        onRetry={() => load(query)}
        onRowClick={(row) => setSelected(row)}
        getRowId={(row) => row.id}
        emptyTitle="No impersonation sessions yet"
        emptyDescription="Once an admin uses the Users module to impersonate a customer, the session will appear here immediately."
      />

      {/* Session detail drawer */}
      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={`Session: ${selected?.target_email || '—'}`}
        description={selected?.id ? `id ${selected.id}` : null}
        width="md"
        footer={
          selected?.status === 'active' ? (
            <div className="flex w-full justify-end">
              <Button
                className="border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                variant="outline"
                onClick={() => setRevokeTarget(selected)}
              >
                <ShieldOff className="mr-1.5 h-4 w-4" />
                Force revoke session
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4 text-sm">
            <Row label="Status"><StatusCell status={selected.status} /></Row>
            <Row label="Admin">{selected.admin_email || '—'}</Row>
            <Row label="Target">{selected.target_email || '—'}</Row>
            {selected.target_org_name ? <Row label="Org">{selected.target_org_name}</Row> : null}
            <Row label="Reason">
              <span className="text-slate-700">{selected.reason || '—'}</span>
            </Row>
            <Row label="Started">{formatDateTime(selected.started_at)}</Row>
            <Row label="Expires">{formatDateTime(selected.expires_at)}</Row>
            {selected.ended_at ? <Row label="Ended">{formatDateTime(selected.ended_at)}</Row> : null}
            {selected.ended_reason ? <Row label="End reason">{selected.ended_reason}</Row> : null}
            <Row label="Duration">{formatDuration(selected.started_at, selected.ended_at)}</Row>
            <Row label="Session ID">
              <span className="font-mono text-[11px] text-slate-500 break-all">{selected.id}</span>
            </Row>
          </div>
        ) : null}
      </Drawer>

      {/* Force-revoke confirmation */}
      <ConfirmActionDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
        severity="danger"
        title={`Force revoke session for ${revokeTarget?.target_email || 'user'}?`}
        description="This marks the session as revoked server-side and writes an audit event. The target user's Supabase session token is NOT invalidated server-side (Supabase does not support server-side session revocation), but their impersonated session will no longer be tracked as active."
        confirmLabel="Revoke session"
        requireReason
        reasonLabel="Reason for revocation"
        reasonPlaceholder="e.g. Session left open after issue resolved; admin unreachable."
        loading={revoking}
        onConfirm={handleForceRevoke}
      />
    </ModuleShell>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500 pt-0.5">
        {label}
      </span>
      <span className="flex-1 text-slate-900">{children}</span>
    </div>
  );
}
