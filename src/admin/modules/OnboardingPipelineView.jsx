import React from 'react';
import { RefreshCw, Building2 } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import ModuleShell from '../ui/ModuleShell.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import Drawer from '../ui/Drawer.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

// Stage classification by org age and membership count.
function classifyStage(org) {
  const ageMs = Date.now() - new Date(org.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const members = Number(org.membership_count || 0);

  if (members === 0) return 'no_members';
  if (ageDays <= 3) return 'just_signed_up';
  if (ageDays <= 14) return 'setting_up';
  if (ageDays <= 60) return 'onboarding';
  return 'active';
}

const STAGES = [
  {
    key: 'just_signed_up',
    label: 'Just signed up',
    description: '0–3 days old',
    tone: 'info',
    color: 'border-blue-200 bg-blue-50',
    headerColor: 'bg-blue-100 text-blue-800',
  },
  {
    key: 'no_members',
    label: 'No members',
    description: 'Org created, no team yet',
    tone: 'warning',
    color: 'border-amber-200 bg-amber-50',
    headerColor: 'bg-amber-100 text-amber-800',
  },
  {
    key: 'setting_up',
    label: 'Setting up',
    description: '4–14 days old',
    tone: 'accent',
    color: 'border-violet-200 bg-violet-50',
    headerColor: 'bg-violet-100 text-violet-800',
  },
  {
    key: 'onboarding',
    label: 'Onboarding',
    description: '15–60 days old',
    tone: 'neutral',
    color: 'border-slate-200 bg-slate-50',
    headerColor: 'bg-slate-100 text-slate-700',
  },
  {
    key: 'active',
    label: 'Active',
    description: '60+ days old',
    tone: 'success',
    color: 'border-emerald-200 bg-emerald-50',
    headerColor: 'bg-emerald-100 text-emerald-800',
  },
];

function ageDays(createdAt) {
  if (!createdAt) return null;
  const ms = Date.now() - new Date(createdAt).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function OrgCard({ org, onClick }) {
  const days = ageDays(org.created_at);
  return (
    <button
      type="button"
      onClick={() => onClick(org)}
      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{org.name || '—'}</p>
          <p className="truncate font-mono text-[10px] text-slate-400">{org.slug || org.id?.slice(0, 8)}</p>
        </div>
        <StatusBadge tone={Number(org.membership_count) > 0 ? 'info' : 'warning'} size="sm">
          {Number(org.membership_count) || 0} {Number(org.membership_count) === 1 ? 'member' : 'members'}
        </StatusBadge>
      </div>
      {days !== null ? (
        <p className="mt-1.5 text-[11px] text-slate-500">
          Created {days === 0 ? 'today' : `${days}d ago`}
          {org.created_at ? ` · ${new Date(org.created_at).toLocaleDateString()}` : ''}
        </p>
      ) : null}
    </button>
  );
}

export default function OnboardingPipelineView() {
  useAdminModuleView('onboarding-pipeline');

  const [orgs, setOrgs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [lastLoaded, setLastLoaded] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedFetch('system-admin-users-orgs', {
        method: 'GET',
        params: { limit: 100 },
      });
      const list = Array.isArray(data?.organizations) ? data.organizations : [];
      // Sort newest first.
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setOrgs(list);
      setLastLoaded(new Date().toISOString());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Group orgs by stage.
  const grouped = React.useMemo(() => {
    const map = {};
    STAGES.forEach((s) => { map[s.key] = []; });
    orgs.forEach((org) => {
      const stage = classifyStage(org);
      if (map[stage]) map[stage].push(org);
    });
    return map;
  }, [orgs]);

  const newThisWeek = orgs.filter((o) => ageDays(o.created_at) <= 7).length;
  const noMembers = orgs.filter((o) => Number(o.membership_count || 0) === 0).length;
  const activeCount = grouped['active']?.length ?? 0;

  if (error) {
    return (
      <ModuleShell title="Onboarding Pipeline" subtitle="Customers">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          Failed to load organizations. <button type="button" className="underline" onClick={load}>Retry</button>
        </div>
      </ModuleShell>
    );
  }

  return (
    <ModuleShell
      title="Onboarding Pipeline"
      subtitle="Customers"
      description="New organizations grouped by onboarding stage. Stage is inferred from org age and member count. Click any card to open the detail drawer."
      actions={
        <div className="flex items-center gap-2">
          {lastLoaded ? (
            <span className="text-xs text-slate-400">
              {new Date(lastLoaded).toLocaleTimeString()}
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total orgs" value={loading ? '…' : orgs.length} />
        <MetricCard label="New this week" value={loading ? '…' : newThisWeek} />
        <MetricCard label="No members yet" value={loading ? '…' : noMembers} hint="May need outreach" />
        <MetricCard label="Active (60+ days)" value={loading ? '…' : activeCount} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {STAGES.map((s) => (
            <div key={s.key} className="space-y-2">
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {STAGES.map((stage) => {
            const stageOrgs = grouped[stage.key] || [];
            return (
              <div key={stage.key} className="flex flex-col gap-2">
                {/* Column header */}
                <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${stage.headerColor}`}>
                  <div>
                    <p className="text-xs font-semibold">{stage.label}</p>
                    <p className="text-[10px] opacity-70">{stage.description}</p>
                  </div>
                  <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-bold">
                    {stageOrgs.length}
                  </span>
                </div>

                {/* Org cards */}
                {stageOrgs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                    None
                  </div>
                ) : (
                  <div className="space-y-2">
                    {stageOrgs.map((org) => (
                      <OrgCard key={org.id} org={org} onClick={setSelected} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Org detail drawer */}
      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.name || 'Organization'}
        description={selected?.slug ? `/${selected.slug}` : selected?.id}
        width="md"
      >
        {selected ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <InfoCell label="Stage">
                <StatusBadge tone={STAGES.find((s) => s.key === classifyStage(selected))?.tone || 'neutral'} size="sm">
                  {STAGES.find((s) => s.key === classifyStage(selected))?.label || '—'}
                </StatusBadge>
              </InfoCell>
              <InfoCell label="Members">{String(selected.membership_count ?? 0)}</InfoCell>
              <InfoCell label="Age">{ageDays(selected.created_at) != null ? `${ageDays(selected.created_at)} days` : '—'}</InfoCell>
              <InfoCell label="Created">
                {selected.created_at ? new Date(selected.created_at).toLocaleDateString() : '—'}
              </InfoCell>
              <InfoCell label="Slug" mono>{selected.slug || '—'}</InfoCell>
              <InfoCell label="ID" mono small>{selected.id}</InfoCell>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div className="mb-1.5 font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Building2 className="h-3 w-3" /> Next steps
              </div>
              {classifyStage(selected) === 'no_members' && (
                <p>This org has no team members. Consider reaching out to prompt setup completion.</p>
              )}
              {classifyStage(selected) === 'just_signed_up' && (
                <p>Brand-new signup. Check in after 2–3 days if they haven't added team members.</p>
              )}
              {classifyStage(selected) === 'setting_up' && (
                <p>Recently signed up with at least one member. Monitor for first activity events.</p>
              )}
              {classifyStage(selected) === 'onboarding' && (
                <p>In active onboarding window. Check audit log for activity and any stuck workflows.</p>
              )}
              {classifyStage(selected) === 'active' && (
                <p>Established organization. No onboarding action needed.</p>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </ModuleShell>
  );
}

function InfoCell({ label, children, mono = false, small = false }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-slate-900 ${mono ? 'font-mono ' : ''}${small ? 'text-[11px]' : 'text-sm'}`}>
        {children}
      </div>
    </div>
  );
}
