import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/currency.js';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { buildPayrollTableRows, buildSummaryRows } from '../lib/pay-summary.js';
import { PAY_PRINT_CSS } from './pay-print-styles.js';

const PrintContext = createContext({ logoUrl: null, systemLogoUrl: '', printedAt: '' });

/** Reinex's own logo, the one the app shows (Logo.jsx, OrgLogo.jsx), as an absolute URL for the iframe. */
function systemLogoUrl() {
  return new URL('/icon.svg', window.location.origin).href;
}

/** "17/11/2026", the day the page was printed. */
function formatPrintDate(date) {
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

const wait = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

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

/** Waits for the iframe's fonts (installed fonts; at most 3 seconds) so the print never waits long. */
async function waitForFonts(doc) {
  if (!doc.fonts) return;
  await Promise.race([doc.fonts.ready, wait(3000)]);
}

/** Waits until every image in the document has loaded or failed (at most `ms`). */
function waitForImages(doc, ms) {
  const pending = Array.from(doc.images).filter((image) => !image.complete);
  if (pending.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(pending.map((image) => new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }))),
    wait(ms),
  ]);
}

/** A hidden, empty iframe that holds the printout's own document: its styles, its font, nothing of the app. */
function createPrintFrame() {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-pay-print-frame', '');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.title = 'הדפסה';
  Object.assign(iframe.style, {
    position: 'fixed', top: '0', left: '0', width: '0', height: '0', border: '0', opacity: '0', pointerEvents: 'none',
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();
  const style = doc.createElement('style');
  style.textContent = PAY_PRINT_CSS;
  doc.head.appendChild(style);
  return { iframe, window: iframe.contentWindow, document: doc };
}

/**
 * Prints its children and nothing else. The printout is laid out in a hidden iframe with its own
 * document (styles in pay-print-styles.js), so it never shows in the app's page and no app style
 * reaches it (an accessibility filter on the app's <html> made Chrome print the page as a picture);
 * the iframe's window is what is printed. Before printing it loads the organization's logo (the
 * `org-logo` endpoint the header uses) and Reinex's logo and waits for them and for the fonts
 * (each with a time limit). `title` names the document (the browser offers it as the PDF file
 * name). Remount it (a new `key`) to print again; `onDone` runs when the print dialog closes.
 */
export function PrintPortal({ children, onDone, title }) {
  const { activeOrgId } = useOrg();
  const onDoneRef = useRef(onDone);
  const [printedAt] = useState(() => formatPrintDate(new Date()));
  const [frame, setFrame] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const created = createPrintFrame();
    setFrame(created);
    return () => {
      created.iframe.remove();
    };
  }, []);

  useEffect(() => {
    if (frame) frame.document.title = title || '';
  }, [frame, title]);

  useEffect(() => {
    if (!frame) return undefined;
    let cancelled = false;
    (async () => {
      const loadOrgLogo = async () => {
        if (!activeOrgId) return null;
        try {
          const data = await authenticatedFetch(`org-logo?org_id=${encodeURIComponent(activeOrgId)}`, { method: 'GET' });
          const url = data?.logo_url || null;
          if (url) await preloadImage(url);
          return url;
        } catch {
          return null;
        }
      };
      const [url] = await Promise.all([
        loadOrgLogo(),
        preloadImage(systemLogoUrl()),
        waitForFonts(frame.document),
      ]);
      if (cancelled) return;
      setLogoUrl(url);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, frame]);

  useEffect(() => {
    if (!ready || !frame) return undefined;
    let cancelled = false;
    // A browser that never fires afterprint on a frame leaves it hidden until the next print
    // replaces it; removing it early could cut off a print that is still being prepared.
    const finish = () => onDoneRef.current?.();
    frame.window.addEventListener('afterprint', finish, { once: true });
    (async () => {
      await waitForImages(frame.document, 2500);
      if (cancelled) return;
      frame.window.focus();
      frame.window.print();
    })();
    return () => {
      cancelled = true;
      frame.window.removeEventListener('afterprint', finish);
    };
  }, [frame, ready]);

  if (!frame) return null;
  return createPortal(
    <PrintContext.Provider value={{ logoUrl, systemLogoUrl: systemLogoUrl(), printedAt }}>
      <div className="pay-print-root" data-pay-print="">
        {children}
      </div>
    </PrintContext.Provider>,
    frame.document.body,
  );
}

function PrintHeader({ orgName, title, monthLabel, employeeName }) {
  const { logoUrl, systemLogoUrl: reinexLogoUrl, printedAt } = useContext(PrintContext);
  return (
    <header className="pay-print-header">
      <div className="pay-print-heading">
        {orgName ? <div className="pay-print-org">{orgName}</div> : null}
        <h1>{title} — {monthLabel}</h1>
        {employeeName ? <h2>{employeeName}</h2> : null}
        <div className="pay-print-date">הופק ב-{printedAt}</div>
      </div>
      <div className="pay-print-logos">
        <img className="pay-print-logo" src={reinexLogoUrl} alt="Reinex" />
        {logoUrl ? <img className="pay-print-logo" src={logoUrl} alt="לוגו הארגון" /> : null}
      </div>
    </header>
  );
}

/** "⚠ 1 לא סומן": an icon and the words, so it reads in grayscale too. */
function UnmarkedFlag({ label }) {
  if (!label) return null;
  return (
    <span className="pay-print-flag" data-pay-print-unmarked="">
      <AlertTriangle aria-hidden="true" />
      {label}
    </span>
  );
}

function LessonLines({ lines }) {
  return (lines || []).map((line) => {
    const stateLabel = line.unmarked && line.stateLabel === 'לא סומן' ? '' : line.stateLabel;
    return (
      <tr key={line.id} className="pay-print-sub2">
        <td>
          {[line.dateLabel, line.time, `${line.minutes} דק'`, stateLabel].filter(Boolean).join(' · ')}
          {line.unmarked ? <UnmarkedFlag label="לא סומן" /> : null}
        </td>
        <td>{line.missingRate ? '' : formatCurrency(line.amount)}</td>
      </tr>
    );
  });
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
                <td>
                  {row.label}
                  <UnmarkedFlag label={row.unmarkedLabel} />
                </td>
                <td>{row.amount === null || row.amount === undefined ? row.note : formatCurrency(row.amount)}</td>
              </tr>
              {detailed && row.groups ? row.groups.map((group) => (
                <React.Fragment key={group.key}>
                  <tr className="pay-print-sub">
                    <td>
                      {group.name} · {group.countLabel}
                      <UnmarkedFlag label={group.unmarkedLabel} />
                    </td>
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
              {detailed && row.basisLines ? row.basisLines.map((line) => (
                <tr key={line.key} className="pay-print-note">
                  <td colSpan={2}>{line.lines.map((text) => <div key={text}>{text}</div>)}</td>
                </tr>
              )) : null}
              {detailed && row.leaveLines ? row.leaveLines.map((line) => (
                <tr key={line.key} className="pay-print-sub">
                  <td>{line.dateLabel} · {line.portionLabel}</td>
                  <td>{line.amountLabel || (line.amount === null ? '' : formatCurrency(line.amount))}</td>
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
                <td>{row.key === 'missing_rate' ? 'חסר: ' : ''}{row.label} ({row.note})</td>
                <td>{row.amountLabel || (row.amount === null ? '' : formatCurrency(row.amount))}</td>
              </tr>
              {detailed && row.dateLines ? row.dateLines.map((line) => (
                <tr key={line.key} className="pay-print-sub">
                  <td>{line.dateLabel}</td>
                  <td />
                </tr>
              )) : null}
              {detailed && !row.dateLines ? <LessonLines lines={row.lessons} /> : null}
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
