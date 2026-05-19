import React from 'react';
import { AlertTriangle, Bug, RefreshCw, Search } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ModuleShell from '../ui/ModuleShell.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import Drawer from '../ui/Drawer.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

const PAGE_SIZE = 50;

const SEVERITY_TONE = {
  info: 'neutral',
  warning: 'warning',
  error: 'danger',
  critical: 'danger',
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

function useErrorEvents({ query, status, severity, route, orgId, actorUserId, offset, refreshKey }) {
  const [state, setState] = React.useState({ loading: true, rows: [], total: 0, error: null });

  React.useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const params = { limit: PAGE_SIZE, offset };
    if (query) params.q = query;
    if (status) params.status = status;
    if (severity) params.severity = severity;
    if (route) params.route = route;
    if (orgId) params.org_id = orgId;
    if (actorUserId) params.actor_user_id = actorUserId;

    authenticatedFetch('system-admin-error-events', { method: 'GET', params })
      .then((data) => {
        if (cancelled) return;
        if (data?.message === 'table_not_found') {
          setState({ loading: false, rows: [], total: 0, error: 'table_not_found' });
          return;
        }
        setState({
          loading: false,
          rows: Array.isArray(data?.errors) ? data.errors : [],
          total: data?.total ?? 0,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ loading: false, rows: [], total: 0, error: error?.message || 'fetch_failed' });
      });

    return () => { cancelled = true; };
  }, [query, status, severity, route, orgId, actorUserId, offset, refreshKey]);

  return state;
}

export default function ErrorEventsView() {
  useAdminModuleView('error-events');

  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [severity, setSeverity] = React.useState('');
  const [route, setRoute] = React.useState('');
  const [orgId, setOrgId] = React.useState('');
  const [actorUserId, setActorUserId] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [selected, setSelected] = React.useState(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  React.useEffect(() => { setOffset(0); }, [status, severity, route, orgId, actorUserId]);

  const { loading, rows, total, error } = useErrorEvents({
    query: debouncedSearch,
    status,
    severity,
    route,
    orgId,
    actorUserId,
    offset,
    refreshKey,
  });

  const serverCount = rows.filter((row) => Number(row.status) >= 500).length;
  const clientCount = rows.filter((row) => Number(row.status) >= 400 && Number(row.status) < 500).length;
  const criticalCount = rows.filter((row) => row.severity === 'critical' || row.severity === 'error').length;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <ModuleShell
      title="Error Events"
      subtitle="Operations"
      description="Search support codes and inspect internal error details. This data is system-admin only and expires automatically after 90 days."
      actions={
        <Button size="sm" variant="outline" onClick={() => setRefreshKey((key) => key + 1)}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Refresh
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Total matching" value={total} />
        <MetricCard label="Server errors (page)" value={serverCount} />
        <MetricCard label="Client errors (page)" value={clientCount} />
        <MetricCard label="High severity (page)" value={criticalCount} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search support code, route, or public message..."
            className="h-9 pl-9"
          />
        </div>
        <Input value={route} onChange={(event) => setRoute(event.target.value)} placeholder="Route" className="h-9 w-48" />
        <Input value={orgId} onChange={(event) => setOrgId(event.target.value)} placeholder="Org ID" className="h-9 w-52 font-mono text-xs" />
        <Input value={actorUserId} onChange={(event) => setActorUserId(event.target.value)} placeholder="User ID" className="h-9 w-52 font-mono text-xs" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
          <option value="">All statuses</option>
          <option value="400">400</option>
          <option value="401">401</option>
          <option value="403">403</option>
          <option value="404">404</option>
          <option value="409">409</option>
          <option value="500">500</option>
          <option value="502">502</option>
          <option value="503">503</option>
        </select>
        <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {error === 'table_not_found' ? (
        <EmptyState
          icon={<Bug className="h-6 w-6" />}
          title="Error events table not set up"
          description="Re-run setup-sql.js against this environment to create the error_events table."
        />
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Failed to load error events: {error}
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading...</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="No error events match"
          description={debouncedSearch || status || severity || route || orgId || actorUserId ? 'Try clearing filters.' : 'No tracked API errors have been recorded yet.'}
        />
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSelected(row)}
              className="grid w-full grid-cols-[180px_90px_1fr_180px] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <div className="font-mono text-xs font-semibold text-slate-900">{row.support_code}</div>
              <StatusBadge tone={Number(row.status) >= 500 ? 'danger' : 'warning'} size="sm">
                {row.status}
              </StatusBadge>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{row.public_message}</div>
                <div className="truncate font-mono text-[11px] text-slate-500">{row.method || '—'} {row.route || '—'}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <StatusBadge tone={SEVERITY_TONE[row.severity] || 'neutral'} size="sm">
                  {row.severity || '—'}
                </StatusBadge>
                <span className="text-[11px] text-slate-400">{formatDate(row.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Page {currentPage} of {totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.support_code || 'Error event'}
        description={selected ? `${selected.status} · ${selected.method || '—'} ${selected.route || '—'}` : null}
        badge={selected ? (
          <StatusBadge tone={SEVERITY_TONE[selected.severity] || 'neutral'} size="sm">
            {selected.severity}
          </StatusBadge>
        ) : null}
        width="xl"
      >
        {selected ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-slate-400">Created</span><div>{formatDate(selected.created_at)}</div></div>
              <div><span className="text-slate-400">Expires</span><div>{formatDate(selected.expires_at)}</div></div>
              <div><span className="text-slate-400">Org</span><div className="font-mono">{selected.org_id || '—'}</div></div>
              <div><span className="text-slate-400">User</span><div className="font-mono">{selected.actor_user_id || '—'}</div></div>
            </div>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Internal Error</h3>
              <JsonBlock value={selected.internal_error} />
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Request Context</h3>
              <JsonBlock value={selected.request_context} />
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Metadata</h3>
              <JsonBlock value={selected.metadata} />
            </section>
          </div>
        ) : null}
      </Drawer>
    </ModuleShell>
  );
}
