import React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import EmptyState from './EmptyState.jsx';
import ErrorState from './ErrorState.jsx';
import { TableSkeleton } from './LoadingSkeleton.jsx';

/**
 * Admin data table.
 *
 * Props:
 *   columns: Array<{
 *     key: string,
 *     header: string | ReactNode,
 *     cell?: (row, rowIndex) => ReactNode,   // custom cell renderer
 *     accessor?: (row) => any,               // value accessor (defaults to row[key])
 *     sortable?: boolean,
 *     align?: 'left' | 'right' | 'center',
 *     width?: string,                        // tailwind width class
 *     className?: string,
 *   }>
 *   rows: any[]
 *   getRowId?: (row, i) => string
 *   onRowClick?: (row) => void
 *   loading?: boolean
 *   error?: any
 *   onRetry?: () => void
 *   emptyTitle / emptyDescription / emptyAction — for empty state
 *   sort?: { key: string, direction: 'asc' | 'desc' }
 *   onSortChange?: (next) => void
 *   dense?: boolean
 */
export default function DataTable({
  columns,
  rows,
  getRowId = (_row, i) => i,
  onRowClick = null,
  loading = false,
  error = null,
  onRetry = null,
  emptyTitle = 'No results',
  emptyDescription = null,
  emptyAction = null,
  sort = null,
  onSortChange = null,
  dense = false,
  className,
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <TableSkeleton columns={columns.length} rows={6} />
      </div>
    );
  }
  if (error) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const handleSort = (col) => {
    if (!col.sortable || !onSortChange) return;
    const isSame = sort?.key === col.key;
    const nextDirection = !isSame ? 'asc' : sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key: col.key, direction: nextDirection });
  };

  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white', className)}>
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            {columns.map((col) => {
              const isSorted = sort?.key === col.key;
              const SortIcon = !isSorted
                ? ChevronsUpDown
                : sort.direction === 'asc' ? ChevronUp : ChevronDown;
              return (
                <TableHead
                  key={col.key}
                  className={cn(
                    'text-xs font-semibold uppercase tracking-wide text-slate-500',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.width,
                    col.sortable && 'cursor-pointer select-none hover:text-slate-900',
                  )}
                  onClick={col.sortable ? () => handleSort(col) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable ? <SortIcon className="h-3 w-3" /> : null}
                  </span>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow
              key={getRowId(row, rowIndex)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                onRowClick && 'cursor-pointer hover:bg-slate-50',
              )}
            >
              {columns.map((col) => {
                const value = col.accessor ? col.accessor(row) : row?.[col.key];
                return (
                  <TableCell
                    key={col.key}
                    className={cn(
                      dense ? 'py-2' : 'py-3',
                      'text-sm text-slate-700',
                      col.align === 'right' && 'text-right tabular-nums',
                      col.align === 'center' && 'text-center',
                      col.className,
                    )}
                  >
                    {col.cell ? col.cell(row, rowIndex) : value ?? '—'}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
