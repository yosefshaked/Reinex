import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

function Breadcrumbs({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  return (
    <nav className="flex items-center gap-1 text-xs text-slate-500" aria-label="Breadcrumb">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            {item.to && !isLast ? (
              <Link to={item.to} className="hover:text-slate-900 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className={cn(isLast && 'text-slate-700')}>{item.label}</span>
            )}
            {!isLast ? <ChevronRight className="h-3 w-3 text-slate-400" /> : null}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export default function ModuleShell({
  title,
  subtitle = null,
  description = null,
  breadcrumbs = null,
  actions = null,
  tabs = null,
  banner = null,
  children,
  className,
}) {
  return (
    <section dir="ltr" className={cn('space-y-5 text-left', className)}>
      {banner ? <div>{banner}</div> : null}
      <header className="space-y-3">
        {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
            {description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {tabs ? <div className="border-b border-slate-200">{tabs}</div> : null}
      </header>
      {children}
    </section>
  );
}
