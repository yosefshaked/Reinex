import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EmptyState({
  icon = null,
  title = 'Nothing to show yet',
  description = null,
  action = null,
  className,
}) {
  const Icon = icon || <Inbox className="h-6 w-6" />;
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
        {Icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-slate-600">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
