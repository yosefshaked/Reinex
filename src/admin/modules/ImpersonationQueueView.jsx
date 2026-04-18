import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ModuleShell from '../ui/ModuleShell.jsx';
import DataTable from '../ui/DataTable.jsx';
import FilterBar from '../ui/FilterBar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import { fetchImpersonationSessions } from '../impersonation/impersonation-client.js';
import { useAdminModuleView } from '../lib/admin-analytics.js';

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
    active: { tone: 'success', label: 'Active', dot: true },
    ended: { tone: 'neutral', label: 'Ended' },
    expired: { tone: 'warning', label: 'Expired' },
    revoked: { tone: 'danger', label: 'Revoked' },
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

  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const activeCount = payload?.active_count ?? 0;

  const columns = [
    {
      key: 'started_at',
      header: 'Started',
      cell: (row) => formatDateTime(row.started_at),
    },
    {
      key: 'admin_email',
      header: 'Admin',
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
        <span className="line-clamp-2 block max-w-md text-sm text-slate-700">
          {row.reason || '—'}
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      cell: (row) => formatDuration(row.started_at, row.ended_at),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusCell status={row.status} />,
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
      description="Every impersonation session initiated from the admin console. Active sessions appear at the top with a live badge."
      actions={
        <Button variant="outline" size="sm" onClick={() => load(query)}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Active sessions" value={activeCount} hint="Currently logged-in-as" />
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
        getRowId={(row) => row.id}
        emptyTitle="No impersonation sessions yet"
        emptyDescription="Once an admin uses the Users module to impersonate a customer, the session will appear here immediately."
      />
    </ModuleShell>
  );
}
