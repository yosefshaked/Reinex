import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BanknoteX, ChevronDown, Info, Loader2, Plus, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { formatCurrency } from '@/lib/currency.js';
import { toast } from '@/lib/toast.jsx';
import { isAdminOrOffice } from '@/features/students/utils/endpoints.js';
import { AddLessonRateDialog } from '@/components/settings/employee-management/EmployeeRatesPanel.jsx';
import { buildLessonCalendarPath, buildSummaryRows, formatMonthLabel, monthBounds } from '../lib/pay-summary.js';
import { PaySummaryPrintSheet, PrintPortal } from './PaySummaryPrint.jsx';

/** A row that opens in place: button semantics, aria-expanded, the content right under it. */
const EXCEPTION_TONES = {
  warning: {
    row: 'rounded-xl bg-amber-50',
    hover: 'hover:bg-amber-100',
    icon: 'text-amber-600',
    label: 'font-semibold text-amber-900',
    note: 'text-amber-800',
    Icon: AlertTriangle,
  },
  danger: {
    row: 'rounded-xl bg-red-50',
    hover: 'hover:bg-red-100',
    icon: 'text-red-600',
    label: 'font-semibold text-red-900',
    note: 'text-red-800',
    Icon: BanknoteX,
  },
};

/** A small amber count of lessons nobody marked: icon and words, not colour alone. */
function UnmarkedBadge({ label }) {
  if (!label) return null;
  return (
    <span data-pay-unmarked-badge="" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
      <AlertTriangle aria-hidden="true" className="h-3 w-3" />
      {label}
    </span>
  );
}

// The small "איך חושב" icon beside a row: a popover with a few plain lines about how the row was worked out.
function HowCalculated({ groups }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="איך חושב"
          data-pay-how
          className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Info aria-hidden="true" className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-xs space-y-2 p-3 text-sm text-slate-700" data-pay-how-content>
        {groups.map((group) => (
          <div key={group.key} className="space-y-0.5">
            {group.lines.map((line) => <p key={line}>{line}</p>)}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ExpandableRow({ label, badge, amount, amountLabel, note, tone, open, onToggle, children, dataKey, info = null, infoGutter = false, nested = false }) {
  const contentId = useId();
  const toneStyle = tone ? EXCEPTION_TONES[tone] : null;
  const ToneIcon = toneStyle?.Icon;
  return (
    <li data-pay-row={dataKey} data-pay-tone={tone || undefined} className={toneStyle ? toneStyle.row : ''}>
      <div className="flex items-center">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className={`grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 text-start transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${nested ? 'py-1.5 text-sm' : 'py-2'} ${toneStyle ? toneStyle.hover : ''}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? '' : 'rotate-90'}`} />
          {ToneIcon ? <ToneIcon aria-hidden="true" className={`h-4 w-4 shrink-0 ${toneStyle.icon}`} /> : null}
          <span className={`min-w-0 break-words ${toneStyle ? toneStyle.label : 'text-slate-800'}`}>{label}</span>
          <UnmarkedBadge label={badge} />
        </span>
        <span className="flex flex-col items-end text-end">
          {amountLabel ? (
            <span className={`tabular-nums font-semibold ${toneStyle ? toneStyle.label : 'text-slate-900'}`}>{amountLabel}</span>
          ) : amount !== null && amount !== undefined ? (
            <span className={`tabular-nums ${nested ? '' : 'font-semibold'} text-slate-900`}>{formatCurrency(amount)}</span>
          ) : null}
          {note ? <span className={`text-xs font-medium ${toneStyle ? toneStyle.note : 'text-amber-800'}`}>{note}</span> : null}
        </span>
      </button>
      {infoGutter ? <span className="flex w-7 shrink-0 justify-center">{info}</span> : null}
      </div>
      {open ? (
        <div id={contentId} className="pb-2 ps-7 pe-2">
          {children}
        </div>
      ) : null}
    </li>
  );
}

function DetailLine({ text, amount, amountLabel, children }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-1 text-sm">
      <span className="min-w-0 break-words text-slate-600">
        {text}
        {children}
      </span>
      <span className="tabular-nums text-slate-800" dir={amountLabel ? 'ltr' : undefined}>
        {amountLabel ?? (amount === null || amount === undefined ? '' : formatCurrency(amount))}
      </span>
    </li>
  );
}

function lessonText(line) {
  return [line.dateLabel, line.time, `${line.minutes} דק'`, line.stateLabel].filter(Boolean).join(' · ');
}

/**
 * A lesson in a service's list. One nobody marked says so where it is (icon and "לא סומן", amber)
 * with the link to mark it in the calendar; its state words are not repeated next to the marker.
 */
function LessonLine({ line }) {
  if (!line.unmarked) return <DetailLine text={lessonText(line)} amount={line.amount} />;
  const text = lessonText({ ...line, stateLabel: line.stateLabel === 'לא סומן' ? '' : line.stateLabel });
  return (
    <DetailLine text={text} amount={line.amount}>
      <span data-pay-unmarked-lesson="" className="ms-2 inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-amber-800">
        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-amber-600" />
        לא סומן
      </span>
      <Link
        to={buildLessonCalendarPath(line)}
        className="ms-2 whitespace-nowrap text-xs font-semibold text-blue-700 underline-offset-2 hover:underline"
      >
        למפגש ביומן
      </Link>
    </DetailLine>
  );
}

/**
 * One employee's pay for one month: the total, one row per part, and the exception rows. Detail
 * only on request: a row opens in place, one at a time. Everything shown comes from
 * `GET /api/payroll?details=1`; nothing is computed here.
 *
 * `onMonthChange` shows the month switcher; `showHeader` false hides the switcher and the print
 * buttons (the all-employees page has its own). `reloadKey` reloads after a change elsewhere.
 */
export default function EmployeePaySummary({
  orgId,
  session,
  employeeId,
  monthDate,
  onMonthChange,
  showHeader = true,
  reloadKey = 0,
  onLoaded,
  onChanged,
}) {
  const { currentOrg, activeOrg } = useOrg();
  const org = currentOrg ?? activeOrg;
  const canManagePay = isAdminOrOffice(org?.membership?.role);
  const { start, end } = useMemo(() => monthBounds(monthDate), [monthDate]);
  const monthLabel = formatMonthLabel(monthDate);

  const [pay, setPay] = useState(null);
  const [loading, setLoading] = useState(false);
  const [openRow, setOpenRow] = useState(null);
  const [openGroup, setOpenGroup] = useState(null);
  const [rateTarget, setRateTarget] = useState(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [printRequest, setPrintRequest] = useState(null);
  const [localReload, setLocalReload] = useState(0);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  useEffect(() => {
    if (!orgId || !employeeId) return undefined;
    let cancelled = false;
    setLoading(true);
    authenticatedFetch('payroll', {
      session,
      params: { org_id: orgId, employee_id: employeeId, start_date: start, end_date: end, details: '1' },
    })
      .then((payload) => {
        if (cancelled) return;
        setPay(Array.isArray(payload?.employees) ? payload.employees[0] || null : null);
        onLoadedRef.current?.(payload);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load the pay summary', error);
        toast.error(error?.message || 'טעינת סיכום השכר נכשלה.');
        setPay(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [employeeId, end, localReload, orgId, reloadKey, session, start]);

  useEffect(() => {
    setOpenRow(null);
    setOpenGroup(null);
  }, [start, employeeId]);

  const summary = useMemo(() => buildSummaryRows(pay), [pay]);

  const toggleRow = useCallback((key) => {
    setOpenRow((current) => (current === key ? null : key));
    setOpenGroup(null);
  }, []);

  const handleRateSaved = useCallback(() => {
    setRateTarget(null);
    setLocalReload((value) => value + 1);
    onChanged?.();
  }, [onChanged]);

  function renderRowContent(row) {
    if (row.groups) {
      return (
        <ul className="space-y-0.5">
          {row.groups.map((group) => (
            <ExpandableRow
              key={group.key}
              dataKey={`service-${group.serviceId || 'none'}`}
              nested
              label={`${group.name} · ${group.countLabel}`}
              badge={group.unmarkedLabel}
              amount={group.amount}
              open={openGroup === group.key}
              onToggle={() => setOpenGroup((current) => (current === group.key ? null : group.key))}
            >
              <ul>
                {group.lessons.map((line) => <LessonLine key={line.id} line={line} />)}
              </ul>
            </ExpandableRow>
          ))}
        </ul>
      );
    }
    if (row.periods) {
      return (
        <ul>
          {row.periods.map((period) => (
            <DetailLine key={period.key} text={`${period.rangeLabel} · ${period.label}`} amount={period.amount} />
          ))}
        </ul>
      );
    }
    if (row.leaveLines) {
      return (
        <ul>
          {row.leaveLines.map((line) => <DetailLine key={line.key} text={`${line.dateLabel} · ${line.portionLabel}`} amount={line.amount} amountLabel={line.amountLabel ?? undefined} />)}
        </ul>
      );
    }
    if (row.correctionLines) {
      return (
        <ul>
          {row.correctionLines.map((line) => (
            <DetailLine
              key={line.key}
              text={[line.dateLabel, line.kindLabel, line.note].filter(Boolean).join(' · ')}
              amountLabel={line.amountLabel}
            />
          ))}
        </ul>
      );
    }
    return <p className="py-1 text-sm text-slate-500">משכורת חודשית יחסית לימי העבודה בחודש.</p>;
  }

  function renderExceptionContent(row) {
    if (row.dateLines) {
      return (
        <ul>
          {row.dateLines.map((line) => <DetailLine key={line.key} text={line.dateLabel} amount={null} />)}
        </ul>
      );
    }
    const lines = row.lessons || [];
    return (
      <ul>
        {lines.map((line) => (
          <DetailLine key={line.id} text={`${line.serviceName ? `${line.serviceName} · ` : ''}${lessonText(line)}`} amount={null}>
            {row.key === 'missing_rate' && canManagePay ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ms-2 h-7 gap-1 px-2 text-xs"
                onClick={() => setRateTarget(line)}
                disabled={ratesLoading}
                aria-busy={ratesLoading || undefined}
              >
                {ratesLoading && rateTarget?.id === line.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                הוספת תעריף
              </Button>
            ) : null}
          </DetailLine>
        ))}
        {row.key === 'missing_rate' && !canManagePay ? (
          <li className="py-1 text-xs text-slate-600">רק מנהל/ת או משרד יכולים להוסיף תעריף.</li>
        ) : null}
      </ul>
    );
  }

  const hasContent = summary.rows.length > 0 || summary.exceptions.length > 0;
  // One narrow column for the "איך חושב" icon, kept on every top row so the amounts stay aligned.
  const hasHowCalculated = summary.rows.some((row) => row.basisLines?.length > 0);

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-pay-summary="">
      {showHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {onMonthChange ? (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => onMonthChange(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}>הקודם</Button>
              <div className="min-w-[110px] text-center text-sm font-semibold text-slate-700" aria-live="polite">{monthLabel}</div>
              <Button size="sm" variant="outline" onClick={() => onMonthChange(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}>הבא</Button>
            </div>
          ) : <span />}
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="gap-1 px-2" disabled={!pay} onClick={() => setPrintRequest({ detailed: false, id: Date.now() })}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              סיכום
            </Button>
            <Button size="sm" variant="ghost" className="gap-1 px-2" disabled={!pay} onClick={() => setPrintRequest({ detailed: true, id: Date.now() })}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              סיכום עם פירוט
            </Button>
          </div>
        </div>
      ) : null}

      {loading && !pay ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          טוען סיכום שכר...
        </div>
      ) : (
        <div className={loading ? 'opacity-60' : ''} aria-busy={loading || undefined}>
          <div className="px-2">
            <div className="text-xs text-slate-500">שכר צפוי לחודש</div>
            <div className="text-3xl font-bold tabular-nums text-slate-900" data-pay-total="">{formatCurrency(summary.total)}</div>
          </div>
          {hasContent ? (
            <ul className="mt-2 space-y-0.5">
              {summary.rows.map((row) => (
                <ExpandableRow
                  key={row.key}
                  dataKey={row.key}
                  label={row.label}
                  badge={row.unmarkedLabel}
                  amount={row.amount}
                  note={row.note}
                  info={row.basisLines?.length ? <HowCalculated groups={row.basisLines} /> : null}
                  infoGutter={hasHowCalculated}
                  open={openRow === row.key}
                  onToggle={() => toggleRow(row.key)}
                >
                  {renderRowContent(row)}
                </ExpandableRow>
              ))}
              {summary.exceptions.map((row) => (
                <ExpandableRow
                  key={row.key}
                  dataKey={row.key}
                  tone={row.tone}
                  label={row.label}
                  amount={row.amount}
                  amountLabel={row.amountLabel}
                  note={row.note}
                  open={openRow === row.key}
                  onToggle={() => toggleRow(row.key)}
                >
                  {renderExceptionContent(row)}
                </ExpandableRow>
              ))}
            </ul>
          ) : (
            <p className="mt-2 px-2 text-sm text-slate-500">אין שכר בחודש הזה.</p>
          )}
        </div>
      )}

      {canManagePay ? (
        <AddLessonRateDialog
          open={Boolean(rateTarget)}
          onOpenChange={(open) => { if (!open) setRateTarget(null); }}
          onLoadingChange={setRatesLoading}
          orgId={orgId}
          session={session}
          employeeId={rateTarget?.employeeId || employeeId}
          serviceId={rateTarget?.serviceId}
          rateDate={rateTarget?.date}
          onSaved={handleRateSaved}
        />
      ) : null}

      {printRequest && pay ? (
        <PrintPortal
          key={printRequest.id}
          title={[printRequest.detailed ? 'סיכום שכר עם פירוט' : 'סיכום שכר', pay.employee_name, monthLabel].filter(Boolean).join(' — ')}
          onDone={() => setPrintRequest(null)}
        >
          <PaySummaryPrintSheet pay={pay} orgName={org?.name} monthLabel={monthLabel} detailed={printRequest.detailed} />
        </PrintPortal>
      ) : null}
    </section>
  );
}
