import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast.jsx';
import { cancelEmployeeRate } from '@/lib/employee-rate-cancel.js';
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
  const [methodHistoryOpen, setMethodHistoryOpen] = useState(false);
  const [valueHistoryOpen, setValueHistoryOpen] = useState(false);
  const [confirming, setConfirming] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const open = draft !== null;
  const result = open ? buildEmployeeLeaveBody(draft, { orgId, employeeId }, current) : null;
  // One "בתוקף מ-" for step 2: the same date starts the pay-method version and the fixed value.
  const plan = open ? planLeaveDayValue({ ...draft, dayValueDate: draft.methodDate }, leaveDayRate) : null;
  const methodPlan = open ? buildLeavePayMethodVersionBody({ payMethod: draft.payMethod, effectiveDate: draft.methodDate }, { orgId, employeeId }, methodVersions) : null;
  const timeline = leaveDayRateTimeline(leaveDayRates, todayKey());
  const methodTimeline = leavePayMethodTimeline(methodVersions, todayKey(), orgPayPolicy);
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

  // Cancels a future fixed value. Only the value: a "ערך קבוע ליום" method version on the same date is
  // its own setting and stays (the history shows what is left).
  async function handleCancelValue(entry) {
    setCancelling(true);
    try {
      await cancelEmployeeRate({ orgId, employeeId, rateId: entry.id, session });
      toast.success('הערך העתידי בוטל.');
      await loadLeaveDayRate();
      await onChanged?.();
    } catch (error) {
      console.error('Failed to cancel the future leave day value', error);
      toast.error(error?.message || 'ביטול הערך העתידי נכשל.');
    } finally {
      setCancelling(false);
      setConfirming('');
    }
  }

  async function handleCancelMethodVersion({ version }) {
    setCancelling(true);
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
    } finally {
      setCancelling(false);
      setConfirming('');
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
            aria-expanded={methodHistoryOpen}
            onClick={() => setMethodHistoryOpen((value) => !value)}
            data-leave-method-future-note
          >
            {methodTimeline.note}
          </button>
        ) : null}
        {timeline.note ? (
          <button
            type="button"
            className="text-xs font-medium text-blue-700 hover:underline"
            aria-expanded={valueHistoryOpen}
            onClick={() => setValueHistoryOpen((value) => !value)}
            data-leave-future-note
          >
            {timeline.note}
          </button>
        ) : null}
        {methodTimeline.entries.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            aria-expanded={methodHistoryOpen}
            onClick={() => setMethodHistoryOpen((value) => !value)}
            data-leave-method-history-toggle
          >
            היסטוריית שיטת תשלום ({methodTimeline.entries.length})
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${methodHistoryOpen ? 'rotate-180' : ''}`} />
          </Button>
        ) : null}
        {timeline.entries.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            aria-expanded={valueHistoryOpen}
            onClick={() => setValueHistoryOpen((value) => !value)}
            data-leave-day-history-toggle
          >
            היסטוריית ערך קבוע ({timeline.entries.length})
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${valueHistoryOpen ? 'rotate-180' : ''}`} />
          </Button>
        ) : null}
      </div>

      {methodHistoryOpen && methodTimeline.entries.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2" data-leave-method-history>
          <p className="mb-1 text-xs text-slate-500">היסטוריית שיטת תשלום</p>
          <ul className="space-y-2">
            {methodTimeline.entries.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {index > 0 ? <li role="separator" aria-hidden="true" className="mx-auto h-px w-2/3 bg-slate-200" data-leave-method-separator /> : null}
                <li className="flex flex-wrap items-center justify-between gap-2 text-sm" data-leave-method-entry>
                  <span className="font-semibold text-slate-900"><bdi dir="ltr">{formatDateKey(entry.date)}</bdi>{entry.isFuture ? <span className="ms-1 text-xs font-normal text-slate-500">(עתידי)</span> : null}{entry.isCurrent ? <span className="ms-1 text-xs font-normal text-slate-500">(בתוקף)</span> : null}</span>
                  <span className="flex items-center gap-2 text-slate-700">
                    {entry.label}
                    {entry.isFuture && confirming !== entry.date ? (
                      <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming(entry.date)} disabled={cancelling} data-cancel-version>
                        ביטול ההגדרה העתידית
                      </Button>
                    ) : null}
                    {entry.isFuture && confirming === entry.date ? (
                      <span className="flex items-center gap-1" data-cancel-version-confirm>
                        <span className="text-xs font-medium text-slate-700">לבטל?</span>
                        <Button type="button" size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => void handleCancelMethodVersion({ version: { effective_date: entry.date } })} disabled={cancelling}>כן, לבטל</Button>
                        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming('')} disabled={cancelling}>לא</Button>
                      </span>
                    ) : null}
                  </span>
                </li>
              </React.Fragment>
            ))}
          </ul>
        </div>
      ) : null}

      {valueHistoryOpen && timeline.entries.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2" data-leave-day-history>
          <p className="mb-1 text-xs text-slate-500">ערך קבוע ליום חופשה</p>
          <ul className="space-y-2">
            {timeline.entries.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {index > 0 ? <li role="separator" aria-hidden="true" className="mx-auto h-px w-2/3 bg-slate-200" data-leave-day-separator /> : null}
                <li className="flex items-center justify-between gap-2 text-sm" data-leave-day-entry>
                  <span className="font-semibold text-slate-900"><bdi dir="ltr">{formatDateKey(entry.date)}</bdi>{entry.isFuture ? <span className="ms-1 text-xs font-normal text-slate-500">(עתידי)</span> : null}{entry.isCurrent ? <span className="ms-1 text-xs font-normal text-slate-500">(בתוקף)</span> : null}</span>
                  <span className="flex items-center gap-2 text-slate-700">
                    ₪{toShekel(entry.rate).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    {entry.isFuture && confirming !== `value-${entry.id}` ? (
                      <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming(`value-${entry.id}`)} disabled={cancelling} data-cancel-value>
                        ביטול הערך העתידי
                      </Button>
                    ) : null}
                    {entry.isFuture && confirming === `value-${entry.id}` ? (
                      <span className="flex items-center gap-1" data-cancel-value-confirm>
                        <span className="text-xs font-medium text-slate-700">לבטל?</span>
                        <Button type="button" size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => void handleCancelValue(entry)} disabled={cancelling}>כן, לבטל</Button>
                        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming('')} disabled={cancelling}>לא</Button>
                      </span>
                    ) : null}
                  </span>
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
                historyLabel="היסטוריית שיטת תשלום"
                dateRowExtra={draft.payMethod === 'fixed_rate' ? (
                  <div className="flex items-center gap-2" data-leave-day-rate-field>
                    <Label htmlFor="leave-day-value" className="text-sm font-semibold text-slate-700">ערך ליום (בשקלים)</Label>
                    <Input
                      id="leave-day-value"
                      className="h-9 w-28"
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.dayValue}
                      onChange={(event) => setDraft((value) => ({ ...value, dayValue: event.target.value }))}
                      disabled={saving}
                      aria-invalid={plan?.error ? true : undefined}
                    />
                  </div>
                ) : null}
              />
              {methodPlan?.error ? <p className="text-xs text-red-600" data-leave-method-error>{methodPlan.error}</p> : null}
              {draft.payMethod === 'fixed_rate' ? (
                <div className="space-y-1" data-leave-day-rate>
                  <p className="text-xs text-slate-500" data-leave-day-value-date-note>הערך בתוקף מאותו תאריך כמו השיטה.</p>
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
