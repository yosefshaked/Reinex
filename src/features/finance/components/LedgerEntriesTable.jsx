import React from 'react';
import { MoreHorizontal } from 'lucide-react';
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
          ) : rows.map((row) => (
            <TableRow key={row.key} className={cn('hover:bg-slate-50/80', row.dimmed ? 'bg-slate-50/50 text-slate-500' : '')}>
              <TableCell className="px-5 py-4 text-right align-top text-sm text-slate-700 sm:px-6">
                {row.date}
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
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
