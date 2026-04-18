import React from 'react';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const SEVERITY = {
  info: {
    icon: Info,
    iconClass: 'text-sky-500 bg-sky-50 ring-sky-200',
    actionClass: 'bg-sky-600 hover:bg-sky-700 text-white',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-600 bg-amber-50 ring-amber-200',
    actionClass: 'bg-amber-600 hover:bg-amber-700 text-white',
  },
  destructive: {
    icon: ShieldAlert,
    iconClass: 'text-rose-600 bg-rose-50 ring-rose-200',
    actionClass: 'bg-rose-600 hover:bg-rose-700 text-white',
  },
};

/**
 * Admin-grade confirm dialog. Replaces window.prompt / window.confirm for
 * destructive or auditable actions.
 *
 * Props:
 *   open, onOpenChange
 *   title, description
 *   severity: 'info' | 'warning' | 'destructive' (default 'warning')
 *   confirmLabel, cancelLabel
 *   requireReason: boolean — show reason textarea, value is passed to onConfirm
 *   reasonLabel, reasonPlaceholder
 *   requireTypedConfirm: string | null — user must type this exact phrase to enable action
 *   extraFields: Array<{ key, label, placeholder, required, type }>
 *     — additional inputs; values object passed to onConfirm as 2nd arg
 *   onConfirm: async ({ reason, fields }) => void
 *   loading: boolean
 */
export default function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description = null,
  severity = 'warning',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  requireReason = false,
  reasonLabel = 'Reason',
  reasonPlaceholder = 'Why are you performing this action?',
  requireTypedConfirm = null,
  extraFields = [],
  onConfirm,
  loading = false,
}) {
  const sev = SEVERITY[severity] || SEVERITY.warning;
  const Icon = sev.icon;

  const [reason, setReason] = React.useState('');
  const [fields, setFields] = React.useState({});
  const [typed, setTyped] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setReason('');
      setFields({});
      setTyped('');
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  const typedMatches = !requireTypedConfirm || typed.trim() === requireTypedConfirm;
  const reasonOk = !requireReason || reason.trim().length >= 3;
  const extraOk = extraFields.every((f) => !f.required || String(fields[f.key] || '').trim());
  const canConfirm = typedMatches && reasonOk && extraOk && !submitting && !loading;

  const handleConfirm = async (event) => {
    event?.preventDefault?.();
    if (!canConfirm) return;
    setSubmitting(true);
    setError('');
    try {
      await onConfirm?.({ reason: reason.trim(), fields });
    } catch (err) {
      setError(err?.message || 'Action failed.');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1',
              sev.iconClass,
            )}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
              {description ? (
                <AlertDialogDescription className="text-sm leading-6">
                  {description}
                </AlertDialogDescription>
              ) : null}
            </div>
          </div>
        </AlertDialogHeader>

        <form onSubmit={handleConfirm} className="space-y-3 pt-1">
          {extraFields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`cad-${f.key}`} className="text-xs font-medium text-slate-700">
                {f.label}
                {f.required ? <span className="text-rose-500"> *</span> : null}
              </Label>
              <Input
                id={`cad-${f.key}`}
                type={f.type || 'text'}
                placeholder={f.placeholder}
                value={fields[f.key] || ''}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                autoComplete="off"
              />
            </div>
          ))}

          {requireReason ? (
            <div className="space-y-1.5">
              <Label htmlFor="cad-reason" className="text-xs font-medium text-slate-700">
                {reasonLabel}
                <span className="text-rose-500"> *</span>
              </Label>
              <Textarea
                id="cad-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
                rows={3}
                className="resize-none"
              />
              <p className="text-[11px] text-slate-500">
                This reason is written to the audit log and cannot be edited later.
              </p>
            </div>
          ) : null}

          {requireTypedConfirm ? (
            <div className="space-y-1.5">
              <Label htmlFor="cad-typed" className="text-xs font-medium text-slate-700">
                Type <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] font-mono text-slate-900">
                  {requireTypedConfirm}
                </code> to confirm
              </Label>
              <Input
                id="cad-typed"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter className="!mt-4">
            <AlertDialogCancel disabled={submitting} type="button">
              {cancelLabel}
            </AlertDialogCancel>
            <Button
              type="submit"
              disabled={!canConfirm}
              className={cn(sev.actionClass, 'min-w-[7rem]')}
            >
              {submitting || loading ? 'Working…' : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
