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
    <div className="space-y-3 font-['Nunito',system-ui,sans-serif]">
      {renderBackControl({ backHref, onBack, backLabel })}

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-8">
          <div className="flex min-w-0 items-center gap-4 text-right lg:pe-8 lg:border-e lg:border-slate-200">
            <Avatar className="h-[4.5rem] w-[4.5rem] shrink-0 rounded-[1.5rem] border border-violet-200/80 bg-violet-50 shadow-sm shadow-violet-100 lg:h-20 lg:w-20">
              {avatarImage ? <AvatarImage src={avatarImage} alt={name} /> : null}
              <AvatarFallback className="rounded-[1.5rem] bg-violet-100 text-xl font-extrabold text-violet-700 lg:text-2xl">
                {avatarFallback}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950">{name}</h1>
                {status ? (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-semibold',
                      status.className || 'border-emerald-200 bg-emerald-50 text-emerald-700',
                    )}
                  >
                    {status.label}
                  </Badge>
                ) : null}
              </div>

              {subtitle ? (
                <p className="text-sm font-medium text-slate-500">{subtitle}</p>
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

          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-6 lg:flex-1 lg:items-center lg:justify-start lg:ps-2">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="min-w-[92px]">
                <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">{kpi.label}</div>
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
                className={cn(
                  'gap-2 rounded-xl border-slate-200 bg-white px-3.5 text-slate-700 shadow-sm shadow-slate-100/80 hover:border-slate-300 hover:bg-slate-50',
                  action.className,
                )}
              >
                {action.icon}
                <span>{action.label}</span>
              </Button>
            ))}

            {moreActions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">פעולות נוספות</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[12rem] rounded-xl border-slate-200 p-1.5 shadow-lg shadow-slate-200/70">
                  {moreActions.map((action, index) => (
                    action.separator ? (
                      <DropdownMenuSeparator key={`separator-${index}`} />
                    ) : (
                      <DropdownMenuItem
                        key={action.label}
                        onClick={action.onClick}
                        disabled={action.disabled}
                        className={cn('rounded-lg px-3 py-2 text-sm text-slate-700', action.className)}
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
