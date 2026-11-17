import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import StepReveal from '@/features/finance/components/StepReveal.jsx';
import { LeaveDayRateEditor } from './EmployeeRatesPanel.jsx';
import {
  EMPLOYEE_LEAVE_PAY_CHOICES,
  ENTITLEMENT_CHOICES,
  buildEmployeeLeaveBody,
  describeEmployeeLeavePayChoice,
  employeeLeaveSummaryText,
} from './attendance-month-grid.js';

function ChoiceButton({ selected, onSelect, disabled, label, description, ...rest }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-start text-sm transition ${selected ? 'border-blue-500 bg-blue-50 font-semibold text-slate-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
      {...rest}
    >
      <span className="block">{label}</span>
      {description ? <span className="block text-xs font-normal text-slate-500">{description}</span> : null}
    </button>
  );
}

function draftFrom(current) {
  const storedDays = current?.annual_leave_days;
  return {
    daysChoice: storedDays == null ? 'default' : 'manual',
    manualDays: storedDays == null ? '' : String(storedDays),
    payMethod: current?.leave_pay_method || '',
  };
}

/**
 * The employee's leave in the "נוכחות" tab, next to the balance: read first as one line ("ימים: ... ·
 * תשלום: ..."), and one "שינוי" that opens the same two steps as the organisation's "חופשה" settings.
 * Step 1: the organisation default or a fixed number of days a year (Employees.annual_leave_days).
 * Step 2: the organisation default, one of the averages, or a fixed value per day
 * (Employees.leave_pay_method; the value itself is the dated leave_day rate, set here with
 * LeaveDayRateEditor). Both fields are saved together through PUT /api/instructors.
 */
export default function EmployeeLeaveSettings({ employeeId, orgId, session, current, orgPayPolicy, onChanged }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const open = draft !== null;
  const result = open ? buildEmployeeLeaveBody(draft, { orgId, employeeId }, current) : null;

  async function handleSave() {
    if (!result?.changed) return;
    setSaving(true);
    try {
      await authenticatedFetch('instructors', { session, method: 'PUT', body: result.body });
      toast.success('הגדרות החופשה של העובד/ת נשמרו.');
      setDraft(null);
      await onChanged?.();
    } catch (error) {
      console.error('Failed to save the employee leave settings', error);
      toast.error(error?.status === 403 ? 'רק מנהל/ת יכול/ה לשנות את הגדרות החופשה.' : (error?.message || 'שמירת הגדרות החופשה נכשלה.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-2 space-y-2" data-leave-settings>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
        <span className="font-semibold text-slate-900">חופשה</span>
        <span data-leave-settings-line>{employeeLeaveSummaryText(current, orgPayPolicy)}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          aria-expanded={open}
          onClick={() => setDraft(open ? null : draftFrom(current))}
          disabled={saving}
          data-leave-settings-change
        >
          שינוי
        </Button>
      </div>

      {open ? (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-3" data-leave-settings-form>
          <div className="space-y-1.5" data-leave-step="1">
            <p className="text-sm font-bold text-slate-900">כמה ימי חופשה מגיעים בשנה?</p>
            <div className="grid gap-1 sm:grid-cols-2" role="radiogroup" aria-label="ימי חופשה בשנה">
              {ENTITLEMENT_CHOICES.map((option) => (
                <ChoiceButton
                  key={option.value}
                  selected={draft.daysChoice === option.value}
                  onSelect={() => setDraft((value) => ({ ...value, daysChoice: option.value }))}
                  disabled={saving}
                  label={option.label}
                  data-choice={option.value}
                />
              ))}
            </div>
            {draft.daysChoice === 'manual' ? (
              <div className="flex items-center gap-2">
                <Label htmlFor="leave-entitlement-days" className="text-xs text-slate-600">ימים בשנה</Label>
                <Input
                  id="leave-entitlement-days"
                  className="h-8 w-24"
                  type="number"
                  min="0"
                  max="365"
                  step="0.5"
                  value={draft.manualDays}
                  onChange={(event) => setDraft((value) => ({ ...value, manualDays: event.target.value }))}
                  disabled={saving}
                />
              </div>
            ) : null}
          </div>

          <StepReveal shown={Boolean(draft.daysChoice)} data-leave-step="2">
            <div className="space-y-1.5">
              <p className="text-sm font-bold text-slate-900">כמה משלמים על יום חופשה?</p>
              <div className="grid gap-1 sm:grid-cols-2" role="radiogroup" aria-label="תשלום על יום חופשה">
                {EMPLOYEE_LEAVE_PAY_CHOICES.map((option) => (
                  <ChoiceButton
                    key={option.value || 'default'}
                    selected={draft.payMethod === option.value}
                    onSelect={() => setDraft((value) => ({ ...value, payMethod: option.value }))}
                    disabled={saving}
                    label={option.label}
                    description={describeEmployeeLeavePayChoice(option.value, orgPayPolicy)}
                    data-pay-choice={option.value || 'default'}
                  />
                ))}
              </div>
              {draft.payMethod === 'fixed_rate' ? (
                <div className="flex flex-wrap items-start gap-2" data-leave-day-rate>
                  <span className="pt-1.5 text-sm text-slate-600">ערך ליום</span>
                  <LeaveDayRateEditor employeeId={employeeId} orgId={orgId} session={session} onSaved={onChanged} />
                </div>
              ) : null}
            </div>
          </StepReveal>

          {result === null && String(draft.manualDays).trim() !== '' ? (
            <p className="text-xs font-medium text-red-700" role="alert">מספר הימים צריך להיות בין 0 ל-365 (אפשר חצאים).</p>
          ) : null}

          <div className="flex items-center gap-2" data-leave-settings-actions>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || !result?.changed}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              שמירה
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>ביטול</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
