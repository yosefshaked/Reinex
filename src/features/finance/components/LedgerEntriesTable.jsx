import React, { useState } from 'react';
import { ChevronDown, ChevronLeft, MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.jsx';
import { cn } from '@/lib/utils.js';

export default function LedgerEntriesTable({
  title = 'פנקס תנועות',
  description = '',
  rows = [],
  emptyLabel = 'אין תנועות להצגה.',
}) {
  const [expandedRows, setExpandedRows] = useState(() => new Set());

  function toggleExpanded(rowKey) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
        <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>

      <Table className="min-w-[920px]">
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-slate-50">
            <TableHead className="bg-slate-50 px-5 py-3 text-right text-xs font-semibold text-slate-600 sm:px-6">תאריך</TableHead>
            <TableHead className="bg-slate-50 px-5 py-3 text-right text-xs font-semibold text-slate-600">תיאור / פעולה</TableHead>
            <TableHead className="bg-slate-50 px-5 py-3 text-right text-xs font-semibold text-slate-600">סטטוס</TableHead>
            <TableHead className="bg-slate-50 px-5 py-3 text-left text-xs font-semibold text-slate-600">חיוב</TableHead>
            <TableHead className="bg-slate-50 px-5 py-3 text-left text-xs font-semibold text-slate-600">זיכוי</TableHead>
            <TableHead className="bg-slate-50 px-5 py-3 text-left text-xs font-semibold text-slate-600">יתרה</TableHead>
            <TableHead className="bg-slate-50 px-5 py-3 text-left text-xs font-semibold text-slate-600 sm:px-6">פעולות</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-white">
              <TableCell colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : rows.map((row) => {
            const isExpanded = expandedRows.has(row.key);
            const canExpand = Array.isArray(row.childRows) && row.childRows.length > 0;

            return (
              <React.Fragment key={row.key}>
                <TableRow className={cn('hover:bg-slate-50/80', row.dimmed ? 'bg-slate-50/50 text-slate-500' : '')}>
                  <TableCell className="px-5 py-4 text-right align-top text-sm text-slate-700 sm:px-6">
                    <div className="flex items-start justify-between gap-2">
                      {canExpand ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          onClick={() => toggleExpanded(row.key)}
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                          <span className="sr-only">פירוט</span>
                        </Button>
                      ) : null}
                      <span>{row.date}</span>
                    </div>
                  </TableCell>

                  <TableCell className="px-5 py-4 text-right align-top">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-900">{row.primaryText}</div>
                      {Array.isArray(row.detailLines) ? row.detailLines.filter(Boolean).map((line) => (
                        <div key={line} className="text-xs text-slate-500">{line}</div>
                      )) : null}
                    </div>
                  </TableCell>

                  <TableCell className="px-5 py-4 align-top">
                    <div className="flex flex-wrap justify-end gap-2">
                      {Array.isArray(row.statusBadges) ? row.statusBadges.map((badge) => (
                        <Badge key={`${row.key}-${badge.label}`} variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                      )) : null}
                    </div>
                  </TableCell>

                  <TableCell className="px-5 py-4 text-left align-top text-sm font-semibold tabular-nums text-red-600">
                    {row.debit}
                  </TableCell>

                  <TableCell className="px-5 py-4 text-left align-top text-sm font-semibold tabular-nums text-emerald-600">
                    {row.credit}
                  </TableCell>

                  <TableCell className="px-5 py-4 text-left align-top text-sm font-semibold tabular-nums text-slate-900">
                    {row.balance}
                  </TableCell>

                  <TableCell className="px-5 py-4 text-left align-top sm:px-6">
                    {Array.isArray(row.actions) && row.actions.length > 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">פעולות</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[12rem] rounded-xl border-slate-200 p-1.5 shadow-lg shadow-slate-200/70">
                          {row.actions.map((action, index) => (
                            action.separator ? (
                              <DropdownMenuSeparator key={`${row.key}-separator-${index}`} />
                            ) : (
                              <DropdownMenuItem
                                key={`${row.key}-${action.label}`}
                                onClick={action.onSelect}
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
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                </TableRow>

                {canExpand && isExpanded ? (
                  <TableRow className="bg-slate-50/40 hover:bg-slate-50/40">
                    <TableCell colSpan={7} className="px-5 py-2.5 sm:px-6">
                      <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2">
                        {row.childRows.map((child) => (
                          <div key={child.key} className="grid gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 md:grid-cols-[minmax(190px,1.3fr)_minmax(200px,2fr)_minmax(80px,auto)_minmax(80px,auto)]">
                            <div className="space-y-0.5">
                              <div className="font-medium text-slate-900">{child.date}</div>
                              {child.entryId ? <div className="text-[11px] text-slate-500">מזהה: #{child.entryId}</div> : null}
                            </div>
                            <div className="space-y-1">
                              <div className="font-semibold text-slate-900">{child.primaryText}</div>
                              {Array.isArray(child.detailLines) ? child.detailLines.filter(Boolean).map((line) => (
                                <div key={line} className="text-[11px] text-slate-500">{line}</div>
                              )) : null}
                            </div>
                            <div className="text-red-600">{child.debit}</div>
                            <div className="text-emerald-600">{child.credit}</div>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
