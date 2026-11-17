import React, { useEffect, useId, useMemo, useState } from 'react';
import { AlertTriangle, BanknoteX, ChevronDown, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { formatCurrency } from '@/lib/currency.js';
import { toast } from '@/lib/toast.jsx';
import { buildPayrollTableRows, formatMonthLabel, monthBounds } from '../lib/pay-summary.js';
import EmployeePaySummary from './EmployeePaySummary.jsx';
import { PaySummaryPrintSheet, PayrollPrintTable, PrintPortal } from './PaySummaryPrint.jsx';

function EmployeeRow({ row, open, onToggle, children }) {
  const contentId = useId();
  return (
    <li data-payroll-row={row.id} className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-2.5 text-start transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? '' : 'rotate-90'}`} />
          <span className="min-w-0 break-words font-medium text-slate-900">{row.name}</span>
          {row.tags.map((tag) => (
            <span
              key={tag.key}
              data-payroll-tag={tag.key}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tag.tone === 'danger' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
            >
              {tag.tone === 'danger'
                ? <BanknoteX aria-hidden="true" className="h-3 w-3" />
                : <AlertTriangle aria-hidden="true" className="h-3 w-3" />}
              {tag.label}
            </span>
          ))}
        </span>
        <span className="tabular-nums font-semibold text-slate-900">{formatCurrency(row.total)}</span>
      </button>
      {open ? (
        <div id={contentId} className="px-1 pb-3">
          {children}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Everyone's pay for the month: one row per employee with the total and the exception tags, and the
 * total for all at the bottom. A row opens that employee's summary in place; its details are read
 * only then, for that employee. The page's own month switcher drives `monthDate`.
 */
export default function PayrollMonthTable({ payroll, loading, orgId, session, monthDate, onChanged }) {
  const { currentOrg, activeOrg } = useOrg();
  const org = currentOrg ?? activeOrg;
  const [openId, setOpenId] = useState(null);
  const [printRequest, setPrintRequest] = useState(null);
  const [detailedPayroll, setDetailedPayroll] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const monthLabel = formatMonthLabel(monthDate);
  const { start, end } = useMemo(() => monthBounds(monthDate), [monthDate]);
  const rows = useMemo(() => buildPayrollTableRows(payroll?.employees), [payroll]);

  useEffect(() => {
    setOpenId(null);
  }, [start]);

  async function handlePrintDetailed() {
    // One page per employee with every row open needs everyone's details: one request, on demand.
    setLoadingDetails(true);
    try {
      const payload = await authenticatedFetch('payroll', {
        session,
        params: { org_id: orgId, start_date: start, end_date: end, details: '1' },
      });
      setDetailedPayroll(payload || null);
      setPrintRequest({ detailed: true, id: Date.now() });
    } catch (error) {
      console.error('Failed to load pay details for printing', error);
      toast.error(error?.message || 'טעינת פירוט השכר להדפסה נכשלה.');
    } finally {
      setLoadingDetails(false);
    }
  }

  if (loading && !payroll) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        טוען נתוני שכר...
      </div>
    );
  }

  return (
    <div className="space-y-2" data-payroll-table="">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button size="sm" variant="ghost" className="gap-1 px-2" disabled={rows.length === 0} onClick={() => setPrintRequest({ detailed: false, id: Date.now() })}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          סיכום
        </Button>
        <Button size="sm" variant="ghost" className="gap-1 px-2" disabled={rows.length === 0 || loadingDetails} onClick={handlePrintDetailed}>
          {loadingDetails ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Printer className="h-4 w-4" aria-hidden="true" />}
          סיכום עם פירוט
        </Button>
      </div>

      <div className={loading ? 'opacity-60' : ''} aria-busy={loading || undefined}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-200 px-2 pb-2 text-xs text-muted-foreground">
          <span className="ps-6">עובד</span>
          <span>שכר צפוי</span>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">אין נתוני שכר להצגה בחודש הנבחר.</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <EmployeeRow
                key={row.id}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId((current) => (current === row.id ? null : row.id))}
              >
                <EmployeePaySummary
                  orgId={orgId}
                  session={session}
                  employeeId={row.id}
                  monthDate={monthDate}
                  showHeader={false}
                  onChanged={onChanged}
                />
              </EmployeeRow>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t-2 border-slate-300 px-2 py-2.5 font-bold text-slate-900" data-payroll-total="">
          <span className="ps-6">סה&quot;כ לכל העובדים</span>
          <span className="tabular-nums">{formatCurrency(payroll?.totals?.total_amount ?? 0)}</span>
        </div>
      </div>

      {printRequest ? (
        <PrintPortal
          key={printRequest.id}
          title={`${printRequest.detailed ? 'סיכום שכר עם פירוט' : 'סיכום שכר'} — ${monthLabel}`}
          onDone={() => setPrintRequest(null)}
        >
          {printRequest.detailed
            // A page per employee only when there is something to read on it: pay, or a lesson to fix.
            ? (detailedPayroll?.employees || [])
              .filter((pay) => Number(pay.total_amount) !== 0 || Number(pay.unmarked_lesson_count) > 0 || Number(pay.missing_rate_lesson_count) > 0)
              .map((pay) => (
              <PaySummaryPrintSheet key={pay.employee_id} pay={pay} orgName={org?.name} monthLabel={monthLabel} detailed />
            ))
            : (
              <PayrollPrintTable
                employees={payroll?.employees}
                totalAmount={payroll?.totals?.total_amount ?? 0}
                orgName={org?.name}
                monthLabel={monthLabel}
              />
            )}
        </PrintPortal>
      ) : null}
    </div>
  );
}
