import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

function DeltaIndicator({ delta, invertTone = false }) {
  if (delta == null || Number.isNaN(Number(delta))) {
    return null;
  }
  const numeric = Number(delta);
  const isPositive = numeric > 0;
  const isNegative = numeric < 0;
  const goodDirectionUp = !invertTone;
  const tone = isPositive
    ? goodDirectionUp ? 'text-emerald-600' : 'text-rose-600'
    : isNegative
      ? goodDirectionUp ? 'text-rose-600' : 'text-emerald-600'
      : 'text-slate-500';
  const Icon = isPositive ? ArrowUpRight : isNegative ? ArrowDownRight : Minus;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', tone)}>
      <Icon className="h-3 w-3" />
      {Math.abs(numeric)}%
    </span>
  );
}

export default function MetricCard({
  label,
  value,
  hint = null,
  delta = null,
  deltaLabel = null,
  invertDeltaTone = false,
  icon = null,
  loading = false,
  className,
}) {
  return (
    <article
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
        {icon ? <span className="text-slate-400">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">
        {loading ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-slate-100" /> : value}
      </p>
      {(delta != null || hint) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <DeltaIndicator delta={delta} invertTone={invertDeltaTone} />
          {deltaLabel ? <span>{deltaLabel}</span> : null}
          {hint ? <span>{hint}</span> : null}
        </div>
      )}
    </article>
  );
}
