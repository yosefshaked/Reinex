import React from 'react';
import posthog from 'posthog-js';
import { ExternalLink, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hasPostHogConfigured } from '@/lib/analytics/posthog.js';
import ModuleShell from '../ui/ModuleShell.jsx';
import DataTable from '../ui/DataTable.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

/**
 * Feature Flags — thin wrapper over PostHog flags.
 *
 * PostHog owns the source of truth for flag configuration (targeting rules,
 * rollouts, per-org overrides). This module surfaces the currently-active
 * flag set for the signed-in admin's PostHog session and links out to the
 * PostHog project for edits.
 *
 * The row drawer is intentionally omitted — editing rules lives in PostHog.
 */

function readFlags() {
  if (!hasPostHogConfigured()) return [];
  try {
    const active = posthog.featureFlags?.getFlags?.() || [];
    const payload = posthog.featureFlags?.getFlagVariants?.() || {};
    // Normalise to rows — active list is flag keys, variants map key -> value.
    const all = new Set([...active, ...Object.keys(payload)]);
    return Array.from(all).sort().map((key) => {
      const value = payload[key];
      const isVariant = typeof value === 'string';
      return {
        key,
        value: value === undefined ? true : value,
        is_variant: isVariant,
        enabled: value !== false && value !== undefined ? true : Boolean(active.includes(key)),
      };
    });
  } catch {
    return [];
  }
}

export default function FeatureFlagsView() {
  useAdminModuleView('feature-flags');

  const [configured] = React.useState(() => hasPostHogConfigured());
  const [rows, setRows] = React.useState(() => readFlags());
  const [reloadedAt, setReloadedAt] = React.useState(() => new Date().toISOString());

  React.useEffect(() => {
    if (!configured) return undefined;
    let unsub = null;
    try {
      unsub = posthog.onFeatureFlags(() => {
        setRows(readFlags());
        setReloadedAt(new Date().toISOString());
      });
    } catch { /* older posthog-js */ }
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [configured]);

  const refresh = () => {
    try {
      posthog.featureFlags?.reloadFeatureFlags?.();
    } catch { /* noop */ }
    setRows(readFlags());
    setReloadedAt(new Date().toISOString());
  };

  const host = (() => {
    try { return posthog?.config?.api_host || ''; } catch { return ''; }
  })();

  const activeCount = rows.filter((r) => r.enabled).length;
  const variantCount = rows.filter((r) => r.is_variant).length;

  const columns = [
    {
      key: 'key',
      header: 'Flag',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Flag className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-mono text-xs text-slate-900">{row.key}</span>
        </div>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      cell: (row) => {
        if (row.is_variant) {
          return <StatusBadge tone="accent" size="sm">{String(row.value)}</StatusBadge>;
        }
        if (row.enabled) return <StatusBadge tone="success" size="sm">enabled</StatusBadge>;
        return <StatusBadge tone="neutral" size="sm">off</StatusBadge>;
      },
    },
  ];

  return (
    <ModuleShell
      title="Feature Flags"
      subtitle="Platform"
      description="PostHog is the single source of truth for flag configuration, targeting, and per-org overrides. This surface shows the flag set currently evaluated for your admin session; use the PostHog console to edit rollouts or create overrides."
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={!configured}>
            Reload from PostHog
          </Button>
          {host ? (
            <Button size="sm" asChild>
              <a href={host} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Open PostHog
              </a>
            </Button>
          ) : null}
        </div>
      }
    >
      {!configured ? (
        <EmptyState
          title="PostHog is not configured"
          description="Set VITE_POSTHOG_KEY (and optionally VITE_POSTHOG_HOST) to enable feature-flag evaluation in this environment."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Flags evaluated" value={rows.length} />
            <MetricCard label="Active" value={activeCount} />
            <MetricCard label="Multivariate" value={variantCount} />
            <MetricCard
              label="Last refresh"
              value={new Date(reloadedAt).toLocaleTimeString()}
            />
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            emptyTitle="No flags evaluated yet"
            emptyDescription="PostHog has not returned any flags for the current session."
            getRowId={(row) => row.key}
          />

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">Why so thin?</div>
            <p className="leading-5">
              Rolling our own flag editor would drift from PostHog's targeting engine and
              experiment tracking. Per-org overrides, rollout %, and flag history all live in
              PostHog — editing them here would just be a slow proxy with a worse audit trail.
            </p>
          </div>
        </>
      )}
    </ModuleShell>
  );
}
