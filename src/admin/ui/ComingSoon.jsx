import React from 'react';
import { Sparkles } from 'lucide-react';
import ModuleShell from './ModuleShell.jsx';
import EmptyState from './EmptyState.jsx';

export default function ComingSoon({ title, subtitle, description, plannedFeatures = [] }) {
  return (
    <ModuleShell title={title} subtitle={subtitle}>
      <EmptyState
        icon={<Sparkles className="h-6 w-6 text-violet-500" />}
        title="This module is coming online soon"
        description={
          description ||
          'We have designed this area as part of the upgraded system admin console. It is queued in the build sequence and will be wired up with real data shortly.'
        }
      />
      {plannedFeatures.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Planned capabilities
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {plannedFeatures.map((feature, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-400" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ModuleShell>
  );
}
