import React from 'react';
import { RefreshCw, CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import ModuleShell from '../ui/ModuleShell.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

function probeStatusTone(status) {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  if (status === 'unconfigured') return 'neutral';
  return 'danger';
}

function ProbeStatusIcon({ status }) {
  if (status === 'healthy') {
    return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  }
  if (status === 'degraded') {
    return <AlertCircle className="h-5 w-5 text-amber-500" />;
  }
  return <XCircle className="h-5 w-5 text-rose-500" />;
}

function ProbeCard({ probe }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{probe.display_name}</h3>
        <ProbeStatusIcon status={probe.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={probeStatusTone(probe.status)} size="sm">
          {probe.status}
        </StatusBadge>
        {probe.latency_ms != null ? (
          <span className="text-xs text-slate-500">{probe.latency_ms}ms</span>
        ) : null}
      </div>
      {probe.message ? (
        <p className="mt-2 text-xs text-slate-500">{probe.message}</p>
      ) : null}
    </div>
  );
}

export default function IntegrationHealthView() {
  useAdminModuleView('integration_health');

  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [lastChecked, setLastChecked] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedFetch('system-admin-integration-health', { method: 'GET' });
      setPayload(data);
      setLastChecked(new Date());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const probes = Array.isArray(payload?.probes) ? payload.probes : [];
  const healthyCount = probes.filter((p) => p.status === 'healthy').length;
  const overall = payload?.overall ?? '—';

  return (
    <ModuleShell
      title="Integration Health"
      subtitle="Platform"
      description="Live probes against each platform dependency. Click Refresh to re-run all checks."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={`mr-1.5 h-4 w-4${loading ? ' animate-spin' : ''}`} />
          Refresh
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Overall status"
          value={loading ? '…' : overall}
          loading={loading}
        />
        <MetricCard
          label="Total probes"
          value={loading ? '…' : probes.length}
          loading={loading}
        />
        <MetricCard
          label="Healthy"
          value={loading ? '…' : healthyCount}
          loading={loading}
        />
        <MetricCard
          label="Last checked"
          icon={<Clock className="h-4 w-4" />}
          value={lastChecked ? lastChecked.toLocaleTimeString() : '—'}
          loading={loading}
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Failed to load integration health: {error?.message || 'Unknown error'}
        </div>
      ) : null}

      {!loading && probes.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {probes.map((probe) => (
            <ProbeCard key={probe.name} probe={probe} />
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : null}
    </ModuleShell>
  );
}
