import React from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import { describeError, errorDetailRows, formatErrorDetailsForCopy } from '@/lib/error-support.js';
import { formatLocalDateTime } from '@/lib/local-time.js';
import { cn } from '@/lib/utils.js';

const formatTime = (iso) => formatLocalDateTime(iso) || iso;

/**
 * "פירוט השגיאה" and "העתקה לשליחה לתמיכה" for a caught error (docs/project-rules/20, "Showing an
 * error"). The rows on screen and the copied text come from the same fields, so the user sees
 * exactly what they send. Copying works with or without a support code.
 *
 * Pass either `error` (with optional `action`) or precomputed `details` from describeError.
 */
export default function ErrorDetails({ error = null, details: givenDetails = null, action = '', fallback = '', defaultOpen = false, className = '' }) {
  const details = React.useMemo(
    () => givenDetails || describeError(error, { action, fallback }),
    [givenDetails, error, action, fallback],
  );
  const [open, setOpen] = React.useState(defaultOpen);
  const [copied, setCopied] = React.useState(false);
  const panelId = React.useId();
  const rows = errorDetailRows(details, { formatTime });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatErrorDetailsForCopy(details, { formatTime }));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div dir="rtl" className={cn('mt-2 text-xs text-current', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-current hover:bg-current/10"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          פירוט השגיאה
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-current hover:bg-current/10"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          העתקה לשליחה לתמיכה
        </Button>
        <span role="status" aria-live="polite" className="font-medium">
          {copied ? 'הפרטים הועתקו. אפשר להדביק אותם בפנייה לתמיכה.' : ''}
        </span>
      </div>
      {open ? (
        <dl id={panelId} className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-current/20 bg-background/70 p-2">
          {rows.map((row) => (
            <React.Fragment key={row.key}>
              <dt className="font-medium">{row.label}</dt>
              <dd dir={row.key === 'action' ? 'rtl' : 'ltr'} className={cn('text-start', row.key !== 'action' && 'font-mono')}>
                {row.value}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
