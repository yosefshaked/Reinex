import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency } from '@/lib/currency.js';
import { buildPayrollTableRows, buildSummaryRows } from '../lib/pay-summary.js';

/**
 * Prints its children and nothing else. The content is placed straight under <body> in a
 * container that is hidden on screen; while printing, the print stylesheet in index.css hides every
 * other child of <body> (the app's chrome included). Remount it (a new `key`) to print again.
 */
export function PrintPortal({ children, onDone }) {
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
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
  }, []);

  return createPortal(
    <div className="pay-print-root" dir="rtl" data-pay-print="">
      {children}
    </div>,
    document.body,
  );
}

function PrintHeader({ orgName, title, monthLabel, employeeName }) {
  return (
    <header className="pay-print-header">
      {orgName ? <div className="pay-print-org">{orgName}</div> : null}
      <h1>{title} · {monthLabel}</h1>
      {employeeName ? <h2>{employeeName}</h2> : null}
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
              <tr className="pay-print-exception">
                <td>! {row.label} ({row.note})</td>
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
      <table className="pay-print-table">
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
