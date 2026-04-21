import React from 'react';
import { RefreshCw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import ModuleShell from '../ui/ModuleShell.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import DataTable from '../ui/DataTable.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

function statusTone(status) {
  if (status === 'ok') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'error') return 'danger';
  return 'neutral';
}

function CheckStatusCell({ status }) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <StatusBadge tone="success" size="sm">ok</StatusBadge>
      </span>
    );
  }
  if (status === 'warning') {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-700">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <StatusBadge tone="warning" size="sm">warning</StatusBadge>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-rose-700">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <StatusBadge tone="danger" size="sm">error</StatusBadge>
    </span>
  );
}

const TABLE_COUNT_COLUMNS = [
  {
    key: 'table',
    header: 'Table',
    cell: (row) => (
      <span className="font-mono text-sm text-slate-800">{row.table}</span>
    ),
  },
  {
    key: 'count',
    header: 'Count',
    align: 'right',
    cell: (row) => (
      <span className="tabular-nums text-sm text-slate-900">
        {row.count === null ? '—' : row.count.toLocaleString()}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <StatusBadge tone={statusTone(row.status)} size="sm">
        {row.status}
      </StatusBadge>
    ),
  },
];

const CHECK_COLUMNS = [
  {
    key: 'display_name',
    header: 'Check',
    cell: (row) => (
      <span className="font-medium text-slate-900">{row.display_name}</span>
    ),
  },
  {
    key: 'description',
    header: 'Description',
    cell: (row) => (
      <span className="text-sm text-slate-600">{row.description}</span>
    ),
  },
  {
    key: 'count',
    header: 'Count',
    align: 'right',
    cell: (row) => (
      <span className="tabular-nums text-sm text-slate-900">
        {row.count === null ? '—' : row.count.toLocaleString()}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <CheckStatusCell status={row.status} />,
  },
];

export default function DataQualityView() {
  useAdminModuleView('data_quality');

  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedFetch('system-admin-data-quality', { method: 'GET' });
      setPayload(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const tableCounts = Array.isArray(payload?.table_counts) ? payload.table_counts : [];
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];

  const totalTables = tableCounts.length;
  const passingChecks = checks.filter((c) => c.status === 'ok').length;
  const warningChecks = checks.filter((c) => c.status === 'warning').length;
  const errorChecks = checks.filter((c) => c.status === 'error').length;

  const checkedAt = payload?.checked_at
    ? new Date(payload.checked_at).toLocaleTimeString()
    : null;

  return (
    <ModuleShell
      title="Data Quality"
      subtitle="Operations"
      description="Row counts and integrity checks across core tables. Run on demand — checks take a few seconds."
      actions={
        <div className="flex items-center gap-3">
          {checkedAt ? (
            <span className="text-xs text-slate-500">Last checked at {checkedAt}</span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5${loading ? ' animate-spin' : ''}`} />
            {loading ? 'Checking…' : 'Refresh'}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Tables checked" value={totalTables} />
        <MetricCard label="Checks passing" value={passingChecks} />
        <MetricCard label="Warnings" value={warningChecks} />
        <MetricCard label="Errors" value={errorChecks} />
      </div>

      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Table Counts
        </div>
        <DataTable
          columns={TABLE_COUNT_COLUMNS}
          rows={tableCounts}
          loading={loading}
          error={error}
          onRetry={load}
          emptyTitle="No table counts available"
          emptyDescription="Run a refresh to load row counts."
        />
      </section>

      <section>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Integrity Checks
        </div>
        <DataTable
          columns={CHECK_COLUMNS}
          rows={checks}
          loading={loading}
          error={error}
          onRetry={load}
          emptyTitle="No integrity checks available"
          emptyDescription="Run a refresh to execute checks."
        />
      </section>
    </ModuleShell>
  );
}
