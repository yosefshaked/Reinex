import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import ModuleShell from './ModuleShell.jsx';
import MetricCard from './MetricCard.jsx';
import StatusBadge from './StatusBadge.jsx';
import { ADMIN_NAV } from './navConfig.js';
import { cn } from '@/lib/utils';
import { useAdminModuleView } from '../lib/admin-analytics.js';

function ModuleTile({ item }) {
  const Icon = item.icon;
  const isLive = item.status === 'live';
  return (
    <Link
      to={item.to}
      className={cn(
        'group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition',
        'hover:border-slate-300 hover:shadow-md',
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1',
          isLive
            ? 'bg-slate-50 text-slate-700 ring-slate-200'
            : 'bg-violet-50 text-violet-600 ring-violet-200',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-900 group-hover:underline">
            {item.label}
          </p>
          {!isLive ? (
            <StatusBadge tone="accent" size="sm">
              soon
            </StatusBadge>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-slate-600">{item.description}</p>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
    </Link>
  );
}

export default function DashboardView() {
  useAdminModuleView('dashboard');

  const visibleGroups = ADMIN_NAV.filter((g) => g.group !== 'Overview');
  const liveCount = ADMIN_NAV.flatMap((g) => g.items).filter((i) => i.status === 'live').length;
  const soonCount = ADMIN_NAV.flatMap((g) => g.items).filter((i) => i.status === 'coming-soon').length;

  return (
    <ModuleShell
      title="System admin dashboard"
      subtitle="High-view control plane"
      description="Every area of the platform, organised into eight groups. Live modules are wired to production data; coming-soon modules are designed and queued in the build sequence."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Live modules" value={liveCount} hint="Production-ready" />
        <MetricCard label="In build" value={soonCount} hint="Designed, queued for wiring" />
        <MetricCard label="Groups" value={visibleGroups.length} hint="Top-level areas" />
        <MetricCard label="Analytics" value="PostHog" hint="EU region, auto page-view capture" />
      </div>

      <div className="space-y-6">
        {visibleGroups.map((group) => (
          <section key={group.group}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {group.group}
              </h3>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <ModuleTile key={item.to} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </ModuleShell>
  );
}
