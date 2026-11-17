import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency } from '@/lib/currency.js';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { buildPayrollTableRows, buildSummaryRows } from '../lib/pay-summary.js';

const PrintContext = createContext({ logoUrl: null, printedAt: '' });

/** "17/11/2026", the day the page was printed. */
function formatPrintDate(date) {
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** Resolves once the image has loaded (or failed, or 2.5 seconds passed) so the print never waits on it. */
function preloadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(resolve, 2500);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    image.onload = done;
    image.onerror = done;
    image.src = url;
  });
}

/**
 * Prints its children and nothing else. The content is placed straight under <body> in a
 * container that is hidden on screen; while printing, the print stylesheet in index.css hides every
 * other child of <body> (the app's chrome included). It fetches the organization's logo (the same
 * `org-logo` endpoint the sidebar uses) before printing and gives the headers the logo and the print
 * date. Remount it (a new `key`) to print again.
 */
export function PrintPortal({ children, onDone }) {
  const { activeOrgId } = useOrg();
  const onDoneRef = useRef(onDone);
  const [printedAt] = useState(() => formatPrintDate(new Date()));
  const [logoUrl, setLogoUrl] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let url = null;
      if (activeOrgId) {
        try {
          const data = await authenticatedFetch(`org-logo?org_id=${encodeURIComponent(activeOrgId)}`, { method: 'GET' });
          url = data?.logo_url || null;
        } catch {
          url = null;
        }
      }
      if (url) await preloadImage(url);
      if (cancelled) return;
      setLogoUrl(url);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  useEffect(() => {
    if (!ready) return undefined;
    const { body } = document;
    body.classList.add('pay-printing');
    const finish = () => {
      body.classList.remove('pay-printing');
      onDoneRef.current?.();
    };
    window.addEventListener('afterprint', finish, { once: true });
    // Let the portal paint before the print dialog takes its snapshot.
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
      body.classList.remove('pay-printing');
    };
  }, [ready]);

  return createPortal(
    <PrintContext.Provider value={{ logoUrl, printedAt }}>
      <div className="pay-print-root" dir="rtl" data-pay-print="">
        {children}
        <footer className="pay-print-footer">הופק ב-{printedAt}</footer>
      </div>
    </PrintContext.Provider>,
    document.body,
  );
}

function PrintHeader({ orgName, title, monthLabel, employeeName }) {
  const { logoUrl, printedAt } = useContext(PrintContext);
  return (
    <header className="pay-print-header">
      {logoUrl ? <img className="pay-print-logo" src={logoUrl} alt="" /> : null}
      <div className="pay-print-heading">
        {orgName ? <div className="pay-print-org">{orgName}</div> : null}
        <h1>{title} — {monthLabel}</h1>
        {employeeName ? <h2>{employeeName}</h2> : null}
      </div>
      <div className="pay-print-date">הופק ב-{printedAt}</div>
    </header>
  );
}

function LessonLines({ lines }) {
  return (lines || []).map((line) => (
    <tr key={line.id} className="pay-print-sub2">
      <td>{[line.dateLabel, line.time, `${line.minutes} דק'`, line.stateLabel].filter(Boolean).join(' · ')}</td>
      <td>{line.missingRate ? '' : formatCurrency(line.amount)}</td>
    </tr>
  ));
}

/** One employee's month on one page: the rows, and with `detailed` everything each row opens to. */
export function PaySummaryPrintSheet({ pay, orgName, monthLabel, detailed }) {
  const { total, rows, exceptions } = buildSummaryRows(pay);
  return (
    <section className="pay-print-page">
      <PrintHeader
        orgName={orgName}
        title={detailed ? 'סיכום שכר עם פירוט' : 'סיכום שכר'}
        monthLabel={monthLabel}
        employeeName={pay?.employee_name}
      />
      <table className="pay-print-table">
        <thead>
          <tr>
            <th>פריט</th>
            <th>סכום</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <React.Fragment key={row.key}>
              <tr className="pay-print-main">
                <td>{row.label}</td>
                <td>{formatCurrency(row.amount)}</td>
              </tr>
              {detailed && row.groups ? row.groups.map((group) => (
                <React.Fragment key={group.key}>
                  <tr className="pay-print-sub">
                    <td>{group.name} · {group.countLabel}</td>
                    <td>{formatCurrency(group.amount)}</td>
                  </tr>
                  <LessonLines lines={group.lessons} />
                </React.Fragment>
              )) : null}
              {detailed && row.periods ? row.periods.map((period) => (
                <tr key={period.key} className="pay-print-sub">
                  <td>{period.rangeLabel} · {period.label}</td>
                  <td>{formatCurrency(period.amount)}</td>
                </tr>
              )) : null}
              {detailed && row.leaveLines ? row.leaveLines.map((line) => (
                <tr key={line.key} className="pay-print-sub">
                  <td>{line.dateLabel} · {line.portionLabel}</td>
                  <td>{formatCurrency(line.amount)}</td>
                </tr>
              )) : null}
              {detailed && row.correctionLines ? row.correctionLines.map((line) => (
                <tr key={line.key} className="pay-print-sub">
                  <td>{[line.dateLabel, line.kindLabel, line.note].filter(Boolean).join(' · ')}</td>
                  <td dir="ltr">{line.amountLabel}</td>
                </tr>
              )) : null}
            </React.Fragment>
          ))}
          <tr className="pay-print-total">
            <td>סה&quot;כ לתשלום</td>
            <td>{formatCurrency(total)}</td>
          </tr>
          {exceptions.map((row) => (
            <React.Fragment key={row.key}>
              <tr className={`pay-print-exception pay-print-exception-${row.tone}`}>
                <td>{row.tone === 'danger' ? 'חסר: ' : 'שימו לב: '}{row.label} ({row.note})</td>
                <td>{row.amountLabel || (row.amount === null ? '' : formatCurrency(row.amount))}</td>
              </tr>
              {detailed ? <LessonLines lines={row.lessons} /> : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Everyone's month in one table, with the total for all employees. */
export function PayrollPrintTable({ employees, totalAmount, orgName, monthLabel }) {
  const rows = buildPayrollTableRows(employees);
  return (
    <section className="pay-print-page">
      <PrintHeader orgName={orgName} title="סיכום שכר" monthLabel={monthLabel} />
      <table className="pay-print-table pay-print-table-flat">
        <thead>
          <tr>
            <th>עובד</th>
            <th>סכום</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="pay-print-main">
              <td>
                {row.name}
                {row.tags.length > 0 ? ` (${row.tags.map((tag) => tag.label).join(', ')})` : ''}
              </td>
              <td>{formatCurrency(row.total)}</td>
            </tr>
          ))}
          <tr className="pay-print-total">
            <td>סה&quot;כ לכל העובדים</td>
            <td>{formatCurrency(totalAmount)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
