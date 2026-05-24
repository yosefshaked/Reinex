import React from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import { extractSupportCode } from '@/lib/error-support.js';
import { cn } from '@/lib/utils.js';

export default function ErrorSupportCode({ error, code, className }) {
  const supportCode = extractSupportCode(code || error);
  const [copied, setCopied] = React.useState(false);

  if (!supportCode) {
    return null;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(supportCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      dir="ltr"
      className={cn(
        'mt-3 flex w-fit max-w-full items-center gap-2 rounded-md border border-current/20 bg-background/70 px-2.5 py-1.5 text-xs text-current',
        className,
      )}
    >
      <span dir="rtl" className="font-medium">קוד תמיכה</span>
      <code className="truncate font-mono text-[0.78rem] font-semibold tracking-normal">
        {supportCode}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="h-7 w-7 shrink-0 p-0 text-current hover:bg-current/10"
        aria-label={copied ? 'קוד התמיכה הועתק' : 'העתקת קוד התמיכה'}
        title={copied ? 'הועתק' : 'העתק'}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
