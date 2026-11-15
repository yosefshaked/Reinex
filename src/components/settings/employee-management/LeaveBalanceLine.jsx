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
import { leaveBalanceText } from './attendance-month-grid.js';

const BALANCE_EVENT_TYPES = [
  { value: 'allocation', label: 'הקצאה', effect: 'מוסיף ימים' },
  { value: 'carryover', label: 'צבירה משנה קודמת', effect: 'מוסיף ימים' },
  { value: 'adjustment', label: 'התאמה', effect: 'מוסיף, או מוריד במספר שלילי' },
  { value: 'correction', label: 'תיקון', effect: 'מוסיף, או מוריד במספר שלילי' },
  { value: 'reversal', label: 'היפוך', effect: 'מוסיף, או מוריד במספר שלילי' },
];

function balanceEventLabel(value) {
  return BALANCE_EVENT_TYPES.find((option) => option.value === value)?.label || value || 'שינוי';
}

// Usage rows are written by recording leave; only the office's own movements can be removed here.
function isManualBalanceEvent(entry) {
  return Boolean(entry) && !entry.leave_entry_id && !entry.leave_day_id && entry.event_type !== 'usage';
}

/**
 * The leave balance as one line above the attendance grid: the figures behind it on hover, and the
 * office's manual balance movements (allocation, carryover, adjustment) behind a small popover.
 */
export default function LeaveBalanceLine({ summary, balanceEvents, employeeId, orgId, session, onChanged }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ eventType: 'carryover', quantityDays: '', effectiveDate: '', notes: '' });
  const text = leaveBalanceText(summary);
  if (!text) return null;

  const yearPrefix = `${summary.year}-`;
  const manualEvents = (balanceEvents || [])
    .filter((entry) => isManualBalanceEvent(entry) && String(entry.effective_date || '').startsWith(yearPrefix));
  const effectiveDate = form.effectiveDate || `${summary.year}-01-01`;

  async function handleAdd() {
    setSaving(true);
    try {
      await authenticatedFetch('employee-leave', {
        session,
        method: 'POST',
        body: {
          entity_type: 'balance_event',
          org_id: orgId,
          employee_id: employeeId,
          event_type: form.eventType,
          quantity_days: Number(form.quantityDays),
          effective_date: effectiveDate,
          notes: form.notes || null,
        },
      });
      setForm({ eventType: 'carryover', quantityDays: '', effectiveDate: '', notes: '' });
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
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600" data-leave-balance>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="cursor-default underline decoration-dotted underline-offset-4">{text.line}</span>
        </TooltipTrigger>
        <TooltipContent dir="rtl" className="space-y-0.5">
          {text.details.map((line) => <p key={line}>{line}</p>)}
        </TooltipContent>
      </Tooltip>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs">שינוי יתרה</Button>
        </PopoverTrigger>
        <PopoverContent dir="rtl" align="start" className="w-80 space-y-3">
          <div>
            <p className="text-sm font-bold text-slate-900">שינויי יתרה ידניים · {summary.year}</p>
            <p className="text-xs text-slate-500">הקצאה, צבירה או תיקון שלא באים מרישום חופשה.</p>
          </div>
          {manualEvents.length ? (
            <ul className="space-y-1">
              {manualEvents.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 text-xs">
                  <span title={entry.notes || undefined}>
                    {formatDateKey(entry.effective_date)} · {balanceEventLabel(entry.event_type)} · <bdi dir="ltr">{Number(entry.quantity_days) > 0 ? '+' : ''}{Number(entry.quantity_days)}</bdi>
                  </span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => handleRemove(entry.id)} disabled={saving}>הסרה</Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">סוג</Label>
              <Select value={form.eventType} onValueChange={(value) => setForm((current) => ({ ...current, eventType: value }))} disabled={saving}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BALANCE_EVENT_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label} <span className="text-[11px] text-slate-500">· {option.effect}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="balance-quantity" className="text-xs text-slate-600">ימים</Label>
              <Input id="balance-quantity" className="h-8" type="number" step="0.5" value={form.quantityDays} onChange={(event) => setForm((current) => ({ ...current, quantityDays: event.target.value }))} disabled={saving} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="balance-date" className="text-xs text-slate-600">תאריך</Label>
              <Input id="balance-date" className="h-8" type="date" value={effectiveDate} onChange={(event) => setForm((current) => ({ ...current, effectiveDate: event.target.value }))} disabled={saving} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="balance-notes" className="text-xs text-slate-600">הערה</Label>
              <Input id="balance-notes" className="h-8" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
            </div>
          </div>
          <Button type="button" size="sm" onClick={handleAdd} disabled={saving || form.quantityDays === ''}>
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            הוספה
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
