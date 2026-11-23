import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import StepReveal from '@/features/finance/components/StepReveal.jsx';
import DatedSettingFields from '@/features/settings/components/DatedSettingFields.jsx';
import { todayKey } from '@/lib/local-time.js';
import { toShekel } from '@/lib/currency.js';
import { formatDateKey } from '@/lib/date-key-format.js';
import {
  EMPLOYEE_LEAVE_PAY_CHOICES,
  ENTITLEMENT_CHOICES,
  buildEmployeeLeaveBody,
  buildLeavePayMethodVersionBody,
  leavePayMethodTimeline,
  leavePayMethodVersionText,
  planLeaveDayValue,
  leaveDayRateTimeline,
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

function draftFrom(current, leaveDayRate) {
  const storedDays = current?.annual_leave_days;
  return {
    dayValue: leaveDayRate ? String(toShekel(leaveDayRate.rate)) : '',
    dayValueDate: todayKey(),
    daysChoice: storedDays == null ? 'default' : 'manual',
    manualDays: storedDays == null ? '' : String(storedDays),
    payMethod: current?.leave_pay_method || '',
    methodDate: todayKey(),
  };
}

/**
 * The employee's leave in the "נוכחות" tab, next to the balance: read first as one line ("ימים: ... ·
 * תשלום: ..."), and one "שינוי" that opens the same two steps as the organisation's "חופשה" settings.
 * Step 1: the organisation default or a fixed number of days a year (Employees.annual_leave_days).
 * Step 2: the organisation default, one of the averages, or a fixed value per day
 * (a dated version of the employee's own method, from "בתוקף מ-", with a history, a "ישתנה ב-" note and
 * cancel of a future version; a leave day is valued by the method in force on that day). The fixed
 * value is an input in the same dialog (the dated leave_day rate in RateHistory, written through
 * api/employee-rates) and is required for that method. One save: the value first, then the method
 * version (POST /api/employee-leave, which refuses "fixed_rate" without a value), then the yearly days
 * (PUT /api/instructors; not dated).
 */
export default function EmployeeLeaveSettings({ employeeId, orgId, session, current, methodVersions = [], orgPayPolicy, onChanged }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [leaveDayRate, setLeaveDayRate] = useState(null);
  const [leaveDayRates, setLeaveDayRates] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const open = draft !== null;
  const result = open ? buildEmployeeLeaveBody(draft, { orgId, employeeId }, current) : null;
  const plan = open ? planLeaveDayValue(draft, leaveDayRate) : null;
  const methodPlan = open ? buildLeavePayMethodVersionBody({ payMethod: draft.payMethod, effectiveDate: draft.methodDate }, { orgId, employeeId }, methodVersions) : null;
  const timeline = leaveDayRateTimeline(leaveDayRates, todayKey());
  const methodTimeline = leavePayMethodTimeline(methodVersions, todayKey(), orgPayPolicy);
  const historyCount = methodTimeline.entries.length + timeline.entries.length;
  const canSave = Boolean(result) && !plan?.error && !methodPlan?.error && (result.changed || plan?.needsSave || methodPlan?.changed);

  // The leave_day rate in force today, to prefill the value.
  const loadLeaveDayRate = useCallback(async () => {
    if (!employeeId || !orgId) return null;
    try {
      const payload = await authenticatedFetch('employee-rates', { session, params: { org_id: orgId, employee_id: employeeId } });
      const today = todayKey();
      const rates = Array.isArray(payload?.rates) ? payload.rates : [];
      setLeaveDayRates(rates);
      const row = rates
        .filter((rate) => rate.pay_basis === 'leave_day' && !rate.service_id && rate.effective_date <= today)
        .sort((left, right) => right.effective_date.localeCompare(left.effective_date))[0] || null;
      setLeaveDayRate(row);
      return row;
    } catch (error) {
      console.error('Failed to load the leave day value', error);
      return null;
    }
  }, [employeeId, orgId, session]);

  useEffect(() => {
    void loadLeaveDayRate();
  }, [loadLeaveDayRate]);

  // The value arrives after the dialog was opened: prefill it, unless something was typed already.
  useEffect(() => {
    if (!leaveDayRate) return;
    setDraft((value) => (value && value.dayValue === '' ? { ...value, dayValue: String(toShekel(leaveDayRate.rate)) } : value));
  }, [leaveDayRate]);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      if (plan.needsSave) {
        await authenticatedFetch('employee-rates', {
          session,
          method: 'POST',
          body: {
            org_id: orgId,
            employee_id: employeeId,
            pay_basis: 'leave_day',
            service_id: null,
            rate: plan.rate,
            effective_date: plan.effectiveDate,
            replace_existing: true,
          },
        });
      }
      if (methodPlan.changed) {
        await authenticatedFetch('employee-leave', { session, method: 'POST', body: methodPlan.body });
      }
      if (result.changed) {
        await authenticatedFetch('instructors', { session, method: 'PUT', body: result.body });
      }
      toast.success('הגדרות החופשה של העובד/ת נשמרו.');
      setDraft(null);
      await loadLeaveDayRate();
      await onChanged?.();
    } catch (error) {
      console.error('Failed to save the employee leave settings', error);
      toast.error(error?.status === 403 ? 'רק מנהל/ת יכול/ה לשנות את הגדרות החופשה.' : (error?.message || 'שמירת הגדרות החופשה נכשלה.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelMethodVersion({ version }) {
    try {
      await authenticatedFetch('employee-leave', {
        session,
        method: 'DELETE',
        body: { entity_type: 'leave_pay_method_version', org_id: orgId, employee_id: employeeId, effective_date: version.effective_date },
      });
      toast.success('ההגדרה העתידית בוטלה.');
      await onChanged?.();
    } catch (error) {
      console.error('Failed to cancel the future leave pay method', error);
      toast.error(error?.message || 'ביטול ההגדרה העתידית נכשל.');
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
          onClick={() => setDraft(open ? null : draftFrom(current, leaveDayRate))}
          disabled={saving}
          data-leave-settings-change
        >
          שינוי
        </Button>
        {methodTimeline.note ? (
          <button
            type="button"
            className="text-xs font-medium text-blue-700 hover:underline"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
            data-leave-method-future-note
          >
            {methodTimeline.note}
          </button>
        ) : null}
        {timeline.note ? (
          <button
            type="button"
            className="text-xs font-medium text-blue-700 hover:underline"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
            data-leave-future-note
          >
            {timeline.note}
          </button>
        ) : null}
        {historyCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
            data-leave-day-history-toggle
          >
            היסטוריה ({historyCount})
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
          </Button>
        ) : null}
      </div>

      {historyOpen && methodTimeline.entries.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2" data-leave-method-history>
          <p className="mb-1 text-xs text-slate-500">תשלום על יום חופשה</p>
          <ul className="space-y-2">
            {methodTimeline.entries.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {index > 0 ? <li role="separator" aria-hidden="true" className="mx-auto h-px w-2/3 bg-slate-200" data-leave-method-separator /> : null}
                <li className="flex items-center justify-between gap-2 text-sm" data-leave-method-entry>
                  <span className="font-semibold text-slate-900"><bdi dir="ltr">{formatDateKey(entry.date)}</bdi>{entry.isFuture ? <span className="ms-1 text-xs font-normal text-slate-500">(עתידי)</span> : null}{entry.isCurrent ? <span className="ms-1 text-xs font-normal text-slate-500">(בתוקף)</span> : null}</span>
                  <span className="text-slate-700">{entry.label}</span>
                </li>
              </React.Fragment>
            ))}
          </ul>
        </div>
      ) : null}

      {historyOpen && timeline.entries.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2" data-leave-day-history>
          <p className="mb-1 text-xs text-slate-500">ערך קבוע ליום חופשה</p>
          <ul className="space-y-2">
            {timeline.entries.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {index > 0 ? <li role="separator" aria-hidden="true" className="mx-auto h-px w-2/3 bg-slate-200" data-leave-day-separator /> : null}
                <li className="flex items-center justify-between gap-2 text-sm" data-leave-day-entry>
                  <span className="font-semibold text-slate-900"><bdi dir="ltr">{formatDateKey(entry.date)}</bdi>{entry.isFuture ? <span className="ms-1 text-xs font-normal text-slate-500">(עתידי)</span> : null}{entry.isCurrent ? <span className="ms-1 text-xs font-normal text-slate-500">(בתוקף)</span> : null}</span>
                  <span className="text-slate-700">₪{toShekel(entry.rate).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                </li>
              </React.Fragment>
            ))}
          </ul>
        </div>
      ) : null}

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
              <DatedSettingFields
                idPrefix="leave-pay-method"
                effectiveDate={draft.methodDate}
                onEffectiveDateChange={(value) => setDraft((state) => ({ ...state, methodDate: value }))}
                versions={methodVersions}
                describeVersion={(version) => leavePayMethodVersionText(version, orgPayPolicy)}
                changed={Boolean(methodPlan?.changed)}
                disabled={saving}
                pastDateWarning="השיטה תחול על ימי חופשה שכבר עברו. השכר על ימי החופשה מהתאריך הזה יחושב מחדש לפיה."
                onCancelVersion={handleCancelMethodVersion}
              />
              {methodPlan?.error ? <p className="text-xs text-red-600" data-leave-method-error>{methodPlan.error}</p> : null}
              {draft.payMethod === 'fixed_rate' ? (
                <div className="space-y-1" data-leave-day-rate>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="leave-day-value" className="text-xs text-slate-600">ערך ליום (בשקלים)</Label>
                      <Input
                        id="leave-day-value"
                        className="h-8 w-28"
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.dayValue}
                        onChange={(event) => setDraft((value) => ({ ...value, dayValue: event.target.value }))}
                        disabled={saving}
                        aria-invalid={plan?.error ? true : undefined}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="leave-day-value-date" className="text-xs text-slate-600">בתוקף מ-</Label>
                      <Input
                        id="leave-day-value-date"
                        className="h-8 w-40"
                        type="date"
                        value={draft.dayValueDate}
                        onChange={(event) => setDraft((value) => ({ ...value, dayValueDate: event.target.value }))}
                        disabled={saving}
                      />
                    </div>
                  </div>
                  {plan?.error ? <p className="text-xs text-red-600" data-leave-day-value-error>{plan.error}</p> : null}
                </div>
              ) : null}
            </div>
          </StepReveal>

          {result === null && String(draft.manualDays).trim() !== '' ? (
            <p className="text-xs font-medium text-red-700" role="alert">מספר הימים צריך להיות בין 0 ל-365 (אפשר חצאים).</p>
          ) : null}

          <div className="flex items-center gap-2" data-leave-settings-actions>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || !canSave}>
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
