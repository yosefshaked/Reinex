import React from 'react';
import { Download } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ModuleShell from '../ui/ModuleShell.jsx';
import DataTable from '../ui/DataTable.jsx';
import FilterBar from '../ui/FilterBar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import Drawer from '../ui/Drawer.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';

/**
 * Audit Log — read-only surface over the audit_log table.
 *
 * System admins see everything, including null-org control-plane events
 * (impersonation_started, org_suspend, system_admin.*) that users cannot.
 * The row drawer renders the raw details/metadata JSON for forensic review.
 */

const PAGE_SIZE = 100;

function retentionTone(category) {
  if (category === 'critical') return 'danger';
  if (category === 'diagnostic') return 'neutral';
  return 'info';
}

function categoryTone(category) {
  if (!category) return 'neutral';
  if (category === 'admin_control' || category === 'security') return 'danger';
  if (category === 'permissions' || category === 'membership') return 'warning';
  return 'info';
}

function formatTimestamp(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function JsonBlock({ value }) {
  if (value === null || value === undefined) {
    return <p className="text-xs italic text-slate-400">null</p>;
  }
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-800">
      {text}
    </pre>
  );
}

export default function AuditLogView() {
  useAdminModuleView('audit-log');

  const [query, setQuery] = React.useState('');
  const [filters, setFilters] = React.useState({
    event_type: '',
    category: '',
    org_id: '',
    actor_user_id: '',
    since: '',
    until: '',
  });
  const [page, setPage] = React.useState(0);
  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selected, setSelected] = React.useState(null);

  const load = React.useCallback(async (nextQuery, nextFilters, nextPage) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        limit: PAGE_SIZE,
        offset: nextPage * PAGE_SIZE,
      };
      if (nextQuery) params.q = nextQuery;
      if (nextFilters.event_type) params.event_type = nextFilters.event_type;
      if (nextFilters.category) params.category = nextFilters.category;
      if (nextFilters.org_id) params.org_id = nextFilters.org_id;
      if (nextFilters.actor_user_id) params.actor_user_id = nextFilters.actor_user_id;
      if (nextFilters.since) params.since = nextFilters.since;
      if (nextFilters.until) params.until = nextFilters.until;

      const data = await authenticatedFetch('system-admin-audit-log', {
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

  React.useEffect(() => {
    load('', filters, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const total = typeof payload?.total === 'number' ? payload.total : null;
  const pageStart = page * PAGE_SIZE;
  const pageEnd = pageStart + rows.length;

  const applyFilters = () => {
    setPage(0);
    load(query, filters, 0);
  };

  const clearAll = () => {
    setQuery('');
    const cleared = { event_type: '', category: '', org_id: '', actor_user_id: '', since: '', until: '' };
    setFilters(cleared);
    setPage(0);
    load('', cleared, 0);
  };

  const goToPage = (next) => {
    if (next < 0) return;
    setPage(next);
    load(query, filters, next);
  };

  const exportCsv = () => {
    captureAdminEvent('audit_log_export', { row_count: rows.length });
    const header = [
      'created_at', 'event_type', 'action_category', 'retention_category',
      'org_id', 'actor_user_id', 'actor_email', 'actor_role',
      'resource_type', 'resource_id', 'correlation_id',
    ];
    const escape = (value) => {
      const s = value === null || value === undefined ? '' : String(value);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [header.join(',')];
    rows.forEach((row) => {
      lines.push(header.map((k) => escape(row?.[k])).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const uniqueCategories = React.useMemo(() => {
    const set = new Set();
    rows.forEach((r) => { if (r.action_category) set.add(r.action_category); });
    return Array.from(set).sort();
  }, [rows]);

  const controlPlaneCount = rows.filter((r) => !r.org_id).length;

  const columns = [
    {
      key: 'created_at',
      header: 'When',
      width: 'w-44',
      cell: (row) => (
        <span className="whitespace-nowrap font-mono text-[11px] text-slate-700">
          {formatTimestamp(row.created_at)}
        </span>
      ),
    },
    {
      key: 'event_type',
      header: 'Event',
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs text-slate-900">{row.event_type || '—'}</span>
          {row.resource_type ? (
            <span className="font-mono text-[10px] text-slate-500">
              {row.resource_type}{row.resource_id ? `:${String(row.resource_id).slice(0, 16)}` : ''}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'action_category',
      header: 'Category',
      cell: (row) => (
        row.action_category ? (
          <StatusBadge tone={categoryTone(row.action_category)} size="sm">
            {row.action_category}
          </StatusBadge>
        ) : <span className="text-slate-400">—</span>
      ),
    },
    {
      key: 'retention_category',
      header: 'Retention',
      cell: (row) => (
        <StatusBadge tone={retentionTone(row.retention_category)} size="sm">
          {row.retention_category || 'standard'}
        </StatusBadge>
      ),
    },
    {
      key: 'actor_email',
      header: 'Actor',
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-xs text-slate-900">{row.actor_email || '—'}</span>
          <span className="text-[10px] text-slate-500">{row.actor_role || 'unknown'}</span>
        </div>
      ),
    },
    {
      key: 'org_id',
      header: 'Org',
      cell: (row) => (
        row.org_id ? (
          <span className="font-mono text-[10px] text-slate-600">{row.org_id.slice(0, 8)}</span>
        ) : (
          <StatusBadge tone="warning" size="sm">control-plane</StatusBadge>
        )
      ),
    },
  ];

  return (
    <ModuleShell
      title="Audit Log"
      subtitle="Compliance"
      description="Every admin and user action persisted to the audit_log table, including control-plane events. System admins see all rows; filters narrow the view without restricting access."
      actions={
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="mr-1.5 h-4 w-4" />
          Export CSV
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Rows in view" value={rows.length} />
        <MetricCard label="Total matches" value={total !== null ? total : '—'} />
        <MetricCard label="Control-plane" value={controlPlaneCount} />
        <MetricCard label="Distinct categories" value={uniqueCategories.length} />
      </div>

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search event, resource, actor email, or resource id…"
        onSubmit={applyFilters}
        onClear={clearAll}
      />

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-3 lg:grid-cols-6">
        <div>
          <Label className="text-xs text-slate-500">Event type</Label>
          <Input
            value={filters.event_type}
            onChange={(e) => setFilters({ ...filters, event_type: e.target.value })}
            placeholder="system_admin.impersonation_started"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Category</Label>
          <Input
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            placeholder="admin_control"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Org id</Label>
          <Input
            value={filters.org_id}
            onChange={(e) => setFilters({ ...filters, org_id: e.target.value })}
            placeholder="uuid"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Actor user id</Label>
          <Input
            value={filters.actor_user_id}
            onChange={(e) => setFilters({ ...filters, actor_user_id: e.target.value })}
            placeholder="uuid"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Since</Label>
          <Input
            type="datetime-local"
            value={filters.since}
            onChange={(e) => setFilters({ ...filters, since: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Until</Label>
          <Input
            type="datetime-local"
            value={filters.until}
            onChange={(e) => setFilters({ ...filters, until: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="md:col-span-3 lg:col-span-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
          <Button size="sm" onClick={applyFilters}>Apply filters</Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={() => load(query, filters, page)}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="No audit rows match these filters"
        emptyDescription="Broaden the query, remove a filter, or extend the time range."
        dense
        getRowId={(row) => row.id}
      />

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          Showing {rows.length ? `${pageStart + 1}–${pageEnd}` : 0}
          {total !== null ? ` of ${total}` : ''}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => goToPage(page - 1)}
            disabled={loading || page === 0}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => goToPage(page + 1)}
            disabled={loading || rows.length < PAGE_SIZE}
          >
            Next
          </Button>
        </div>
      </div>

      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.event_type || 'Audit event'}
        description={selected?.id ? `id ${selected.id}` : null}
        width="xl"
        badge={
          selected ? (
            <StatusBadge tone={retentionTone(selected.retention_category)} size="sm">
              {selected.retention_category || 'standard'}
            </StatusBadge>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3">
              <Info label="Occurred" value={formatTimestamp(selected.created_at)} />
              <Info label="Category" value={selected.action_category || '—'} />
              <Info label="Actor" value={selected.actor_email || '—'} />
              <Info label="Actor role" value={selected.actor_role || '—'} />
              <Info label="Actor id" value={selected.actor_user_id || '—'} mono />
              <Info label="Org id" value={selected.org_id || 'control-plane'} mono />
              <Info label="Resource" value={`${selected.resource_type || '—'}${selected.resource_id ? ' · ' + selected.resource_id : ''}`} />
              <Info label="Correlation" value={selected.correlation_id || '—'} mono />
            </section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Details</h4>
              <JsonBlock value={selected.details} />
            </section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Metadata</h4>
              <JsonBlock value={selected.metadata} />
            </section>
          </div>
        ) : null}
      </Drawer>
    </ModuleShell>
  );
}

function Info({ label, value, mono = false }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-sm text-slate-900 ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '—'}
      </div>
    </div>
  );
}
