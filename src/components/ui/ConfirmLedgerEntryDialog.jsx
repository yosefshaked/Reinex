import React, { useRef } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/currency.js';

function formatDisplayDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

/**
 * Confirmation dialog shown before any manual ledger entry is committed.
 * The ledger is append-only — every confirmed entry is permanent.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   onConfirm: () => void,
 *   saving?: boolean,
 *   entry?: {
 *     type: 'credit' | 'debit',
 *     amount: number,        // agorot integer
 *     accountName?: string,
 *     effectiveAt?: string,
 *     notes?: string,
 *   } | null,
 * }} props
 */
export default function ConfirmLedgerEntryDialog({
  open,
  onOpenChange,
  onConfirm,
  saving = false,
  entry = null,
}) {
  if (!entry) return null;

  const isDebit = entry.type === 'debit';
  const confirmButtonRef = useRef(null);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>אישור רישום בלדר — לא ניתן לבטל</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-start">
              <p className="text-sm text-muted-foreground">
                פעולה זו תירשם לצמיתות בלדר החיוב. לתיקון טעות תידרש פעולת היפוך נפרדת.
              </p>

              <div className="rounded-xl border border-border bg-slate-50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={isDebit
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800'}
                  >
                    {isDebit ? 'חיוב / התאמה ידנית' : 'זיכוי / תשלום'}
                  </Badge>
                  <span className={`text-xl font-bold ${isDebit ? 'text-red-700' : 'text-emerald-700'}`}>
                    {isDebit ? '-' : '+'}{formatCurrency(entry.amount)}
                  </span>
                </div>

                {entry.accountName ? (
                  <div className="text-sm text-zinc-700">
                    <span className="text-muted-foreground">חשבון: </span>
                    {entry.accountName}
                  </div>
                ) : null}

                {entry.effectiveAt ? (
                  <div className="text-sm text-zinc-700">
                    <span className="text-muted-foreground">תאריך: </span>
                    {formatDisplayDate(entry.effectiveAt)}
                  </div>
                ) : null}

                {entry.notes ? (
                  <div className="text-sm text-zinc-700">
                    <span className="text-muted-foreground">הערות: </span>
                    {entry.notes}
                  </div>
                ) : null}
              </div>

              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ⚠️ הלדר הוא מסמך ראשוני בלבד. כל תנועה שתירשם פה לא תימחק לעולם — ניתן רק לבצע היפוך.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-row-reverse gap-2">
          <Button
            ref={confirmButtonRef}
            type="button"
            variant={isDebit ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            {isDebit ? 'כן, רשום התאמה ידנית' : 'כן, רשום תשלום'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            ביטול
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
