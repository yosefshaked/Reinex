import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MoreVertical } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import { cn } from '@/lib/utils.js';

function renderBackControl({ backHref, onBack, backLabel }) {
  if (backHref) {
    return (
      <Link
        to={backHref}
        className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-800"
      >
        <ArrowRight className="h-4 w-4" />
        <span>{backLabel}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-800"
    >
      <ArrowRight className="h-4 w-4" />
      <span>{backLabel}</span>
    </button>
  );
}

export default function ProfileMasterStrip({
  backHref = '',
  onBack = null,
  backLabel = 'חזרה',
  avatarFallback = '?',
  avatarImage = '',
  name = '',
  status = null,
  subtitle = '',
  alertPills = [],
  kpis = [],
  primaryActions = [],
  moreActions = [],
}) {
  return (
    <div className="space-y-3">
      {renderBackControl({ backHref, onBack, backLabel })}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-4 lg:pe-8 lg:border-e lg:border-slate-200">
            <Avatar className="h-16 w-16 shrink-0 rounded-2xl border border-slate-200 bg-slate-100 lg:h-20 lg:w-20">
              {avatarImage ? <AvatarImage src={avatarImage} alt={name} /> : null}
              <AvatarFallback className="rounded-2xl bg-slate-100 text-xl font-bold text-slate-700 lg:text-2xl">
                {avatarFallback}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950">{name}</h1>
                {status ? (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'border px-2.5 py-0.5 text-xs font-medium',
                      status.className || 'border-emerald-200 bg-emerald-50 text-emerald-700',
                    )}
                  >
                    {status.label}
                  </Badge>
                ) : null}
              </div>

              {subtitle ? (
                <p className="text-sm text-slate-500">{subtitle}</p>
              ) : null}

              {alertPills.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {alertPills.map((pill) => (
                    <span
                      key={pill.key}
                      className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
                    >
                      {pill.icon}
                      <span>{pill.label}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-5 lg:flex-1 lg:items-center lg:justify-start lg:ps-2">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="min-w-[92px]">
                <div className="text-xs text-slate-500">{kpi.label}</div>
                <div className={cn('mt-1 text-lg font-semibold text-slate-900', kpi.className)}>
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:ms-auto lg:justify-end">
            {primaryActions.map((action) => (
              <Button
                key={action.label}
                type="button"
                variant={action.variant || 'outline'}
                size="sm"
                onClick={action.onClick}
                disabled={action.disabled}
                className={cn('gap-2', action.className)}
              >
                {action.icon}
                <span>{action.label}</span>
              </Button>
            ))}

            {moreActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-slate-600">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">פעולות נוספות</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {moreActions.map((action, index) => (
                    action.separator ? (
                      <DropdownMenuSeparator key={`separator-${index}`} />
                    ) : (
                      <DropdownMenuItem
                        key={action.label}
                        onClick={action.onClick}
                        disabled={action.disabled}
                        className={action.className}
                      >
                        {action.icon ? <span className="ms-2 inline-flex h-4 w-4 items-center justify-center">{action.icon}</span> : null}
                        <span>{action.label}</span>
                      </DropdownMenuItem>
                    )
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
