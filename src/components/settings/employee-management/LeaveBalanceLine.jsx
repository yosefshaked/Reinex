import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2 } from 'lucide-react';
import { formatDateKey } from '@/lib/date-key-format.js';
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { todayKey } from '@/lib/local-time.js';
import {
  BALANCE_ACTIONS,
  BALANCE_REASON_OPTIONS,
  balanceFormError,
  balanceQuantityError,
  buildBalanceEventBody,
  defaultBalanceDate,
  describeBalanceEvent,
  emptyBalanceForm,
  entitlementManualReason,
  leaveBalanceText,
  leaveEntitlementExplanation,
} from './attendance-month-grid.js';

// Usage rows are written by recording leave; only the office's own movements can be removed here.
function isManualBalanceEvent(entry) {
  return Boolean(entry) && !entry.leave_entry_id && !entry.leave_day_id && entry.event_type !== 'usage';
}

/**
 * The leave balance as one line above the attendance grid ("מגיעים N ימי חופשה השנה · נוצלו X ·
 * נשארו Y"): the figures behind it on hover, "הסבר מלא" (why N, in plain sentences), and the
 * office's manual balance movements (allocation, carryover, adjustment) behind "שינוי יתרה". How
 * many days a year and how a leave day is paid are set in the "חופשה" row (EmployeeLeaveSettings).
 */
export default function LeaveBalanceLine({ summary, entitlement, balanceEvents, employee, orgId, session, onChanged }) {
  const employeeId = employee?.id;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyBalanceForm());
  const text = leaveBalanceText(summary, entitlement, Number(todayKey().slice(0, 4)));
  if (!text) return null;
  const manualReason = entitlementManualReason(entitlement);
  const explanation = leaveEntitlementExplanation(entitlement, { name: employee?.first_name || '' });

  const yearPrefix = `${summary.year}-`;
  const manualEvents = (balanceEvents || [])
    .filter((entry) => isManualBalanceEvent(entry) && String(entry.effective_date || '').startsWith(yearPrefix));
  const effectiveDate = form.effectiveDate || defaultBalanceDate(summary.year, todayKey());
  const formError = balanceFormError(form);
  const quantityError = balanceQuantityError(form);
  const actionHint = BALANCE_ACTIONS.find((option) => option.value === form.eventType)?.hint || '';

  async function handleAdd() {
    setSaving(true);
    try {
      await authenticatedFetch('employee-leave', {
        session,
        method: 'POST',
        body: buildBalanceEventBody(form, { orgId, employeeId, effectiveDate }),
      });
      setForm(emptyBalanceForm());
      toast.success('שינוי היתרה נשמר.');
      await onChanged?.();
    } catch (error) {
      console.error('Failed to save leave balance event', error);
      toast.error(error?.message || 'שמירת שינוי היתרה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id) {
    setSaving(true);
    try {
      await authenticatedFetch('employee-leave', {
        session,
        method: 'DELETE',
        body: { entity_type: 'balance_event', org_id: orgId, id },
      });
      toast.success('שינוי היתרה הוסר.');
      await onChanged?.();
    } catch (error) {
      console.error('Failed to delete leave balance event', error);
      toast.error(error?.message || 'מחיקת שינוי היתרה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-2 space-y-1" data-leave-balance>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="cursor-default underline decoration-dotted underline-offset-4" data-leave-balance-line>{text.line}</span>
        </TooltipTrigger>
        <TooltipContent dir="rtl" className="space-y-0.5">
          {text.details.map((line) => <p key={line}>{line}</p>)}
        </TooltipContent>
      </Tooltip>
      {explanation.length ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="link" className="h-7 px-1 text-xs" data-leave-explain-open>הסבר מלא</Button>
          </PopoverTrigger>
          <PopoverContent dir="rtl" align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 text-sm text-slate-700" data-leave-explain>
            {explanation.map((sentence) => <p key={sentence}>{sentence}</p>)}
          </PopoverContent>
        </Popover>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs">שינוי יתרה</Button>
        </PopoverTrigger>
        <PopoverContent dir="rtl" align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-3">
          <div>
            <p className="text-sm font-bold text-slate-900">שינויי יתרה ידניים · {summary.year}</p>
            <p className="text-xs text-slate-500">העברה מהשנה הקודמת, או הוספה והורדה של ימים. כל שינוי נרשם עם סיבה.</p>
          </div>
          {manualEvents.length ? (
            <ul className="space-y-1">
              {manualEvents.map((entry) => {
                const line = describeBalanceEvent(entry, formatDateKey);
                return (
                <li key={entry.id} className="flex items-center justify-between gap-2 text-xs" data-balance-event>
                  <span>
                    <bdi dir="ltr">{line.title}</bdi>
                    {line.reason ? <span className="block text-slate-600">{line.reason}</span> : null}
                    {line.who ? <span className="block text-[11px] text-slate-500">{line.who}</span> : null}
                  </span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => handleRemove(entry.id)} disabled={saving}>הסרה</Button>
                </li>
                );
              })}
            </ul>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="balance-action" className="text-xs text-slate-600">פעולה</Label>
              <Select value={form.eventType} onValueChange={(value) => setForm((current) => ({ ...current, eventType: value }))} disabled={saving}>
                <SelectTrigger id="balance-action" className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BALANCE_ACTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="balance-quantity" className="text-xs text-slate-600">ימים · {actionHint}</Label>
              <Input id="balance-quantity" className="h-8" type="number" step="0.5" value={form.quantityDays} onChange={(event) => setForm((current) => ({ ...current, quantityDays: event.target.value }))} disabled={saving} aria-invalid={quantityError ? true : undefined} aria-describedby={quantityError ? 'balance-quantity-error' : undefined} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="balance-date" className="text-xs text-slate-600">תאריך</Label>
              <Input id="balance-date" className="h-8" type="date" value={effectiveDate} onChange={(event) => setForm((current) => ({ ...current, effectiveDate: event.target.value }))} disabled={saving} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="balance-reason" className="text-xs text-slate-600">סיבה (חובה)</Label>
              <Select value={form.reason} onValueChange={(value) => setForm((current) => ({ ...current, reason: value }))} disabled={saving}>
                <SelectTrigger id="balance-reason" className="h-8"><SelectValue placeholder="בחירת סיבה" /></SelectTrigger>
                <SelectContent>
                  {BALANCE_REASON_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.reason === 'other' ? (
              <div className="col-span-2 space-y-1">
                <Label htmlFor="balance-notes" className="text-xs text-slate-600">מה הסיבה?</Label>
                <Input id="balance-notes" className="h-8" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
              </div>
            ) : null}
          </div>
          {quantityError ? <p id="balance-quantity-error" className="text-xs text-red-600" data-balance-quantity-error>{quantityError}</p> : null}
          <Button type="button" size="sm" onClick={handleAdd} disabled={saving || Boolean(formError)} title={formError || undefined}>
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            הוספה
          </Button>
        </PopoverContent>
      </Popover>
      </div>
      {manualReason ? <p className="text-xs text-amber-700" data-leave-entitlement-reason>{manualReason}</p> : null}
    </div>
  );
}
