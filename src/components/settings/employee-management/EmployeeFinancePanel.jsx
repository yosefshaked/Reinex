import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog.jsx';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toAgorot, formatCurrency } from '@/lib/currency.js';
import { LeaveDayRateEditor } from './EmployeeRatesPanel.jsx';
import EmployeePaySummary from '@/features/finance/components/EmployeePaySummary.jsx';

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toLocalDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * How a paid leave day is valued. This is a method on the employee, not a rate for work, chosen
 * here for every employee type: the org default applies when none is set, and a farm can override it
 * per employee with a fixed day value, which is a dated leave_day rate set in the same box.
 */
const LEAVE_PAY_METHODS = [
  { value: '', label: 'ברירת המחדל של הארגון' },
  { value: 'legal', label: 'ממוצע חוקי' },
  { value: 'avg_hourly_x_avg_day_hours', label: 'ממוצע היסטורי' },
  { value: 'fixed_rate', label: 'ערך קבוע ליום' },
];

/** What a leave day is worth under each method, in words, using the organisation's own settings. */
function describeLeavePayMethod(method, policy) {
  const months = Number(policy?.lookback_months) > 0 ? Number(policy.lookback_months) : 3;
  const period = months === 1 ? 'בחודש האחרון' : `ב-${months} החודשים האחרונים`;
  if (method === 'legal') {
    return policy?.legal_allow_12m_if_better === false
      ? `השכר היומי הממוצע בימים שעבד/ה ${period}.`
      : `השכר היומי הממוצע בימים שעבד/ה ${period}, או ב-12 החודשים האחרונים אם שם הממוצע גבוה יותר.`;
  }
  if (method === 'avg_hourly_x_avg_day_hours') {
    return `השכר היומי הממוצע בימים שעבד/ה ${period} בלבד, בלי השוואה ל-12 חודשים.`;
  }
  if (method === 'fixed_rate') {
    return 'סכום קבוע ליום חופשה. הסכום והתאריך שממנו הוא חל נקבעים כאן.';
  }
  const orgDefault = LEAVE_PAY_METHODS.find((option) => option.value === policy?.default_method)?.label || 'ממוצע חוקי';
  return `כמו שאר העובדים בארגון. כרגע: "${orgDefault}".`;
}

function getLeavePayMethodLabel(method) {
  return (LEAVE_PAY_METHODS.find((option) => option.value === (method || '')) || LEAVE_PAY_METHODS[0]).label;
}

/**
 * The leave-pay box: the method as text with "שינוי", and for the fixed method the dated day value.
 * The method is saved on the employee through PUT /api/instructors (the same field the card used).
 */
function LeavePayBox({ employee, orgId, session, policy, onSaved, onEmployeeChanged }) {
  const [method, setMethod] = useState(employee?.leave_pay_method || '');
  const [choice, setChoice] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMethod(employee?.leave_pay_method || '');
    setChoice(null);
  }, [employee?.id, employee?.leave_pay_method]);

  async function handleSave() {
    setSaving(true);
    try {
      await authenticatedFetch('instructors', {
        session,
        method: 'PUT',
        body: { org_id: orgId, instructor_id: employee.id, leave_pay_method: choice || null },
      });
      setMethod(choice);
      setChoice(null);
      toast.success('שיטת תשלום החופשה נשמרה.');
      onSaved?.();
      await onEmployeeChanged?.();
    } catch (error) {
      console.error('Failed to save leave pay method', error);
      toast.error(error?.message || 'שמירת שיטת תשלום החופשה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-leave-pay-box>
      <div>
        <h3 className="text-sm font-bold text-slate-900">תשלום חופשה</h3>
        <p className="text-xs text-slate-500">כמה שווה יום חופשה בתשלום של העובד/ת.</p>
      </div>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2">
        <span className="text-sm text-slate-600">שיטה</span>
        <span className="flex items-center gap-2">
          <span className="font-bold text-slate-900">{getLeavePayMethodLabel(method)}</span>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setChoice(choice === null ? method : null)} disabled={saving}>
            שינוי
          </Button>
        </span>
      </div>
      {choice === null ? (
        <p className="text-xs text-slate-500" data-leave-pay-explain>{describeLeavePayMethod(method, policy)}</p>
      ) : null}
      {choice !== null ? (
        <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
          <div className="grid gap-1" role="radiogroup" aria-label="שיטת תשלום חופשה">
            {LEAVE_PAY_METHODS.map((option) => (
              <button
                key={option.value || 'default'}
                type="button"
                role="radio"
                aria-checked={choice === option.value}
                onClick={() => setChoice(option.value)}
                disabled={saving}
                className={`rounded-lg border px-3 py-1.5 text-start text-sm transition ${choice === option.value ? 'border-blue-500 bg-blue-50 font-semibold text-slate-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="block">{option.label}</span>
                <span className="block text-xs font-normal text-slate-500">{describeLeavePayMethod(option.value, policy)}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || choice === method}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              שמירה
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setChoice(null)} disabled={saving}>ביטול</Button>
          </div>
        </div>
      ) : null}
      {method === 'fixed_rate' ? (
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2">
          <span className="pt-1.5 text-sm text-slate-600">ערך ליום</span>
          <LeaveDayRateEditor employeeId={employee?.id} orgId={orgId} session={session} onSaved={onSaved} />
        </div>
      ) : null}
    </section>
  );
}

export default function EmployeeFinancePanel({ employee, orgId, session, onEditEmployee, onEmployeeChanged }) {
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [leavePolicy, setLeavePolicy] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  // Bumped after a change here (a correction, a leave-day value) so the pay summary reads again.
  const [summaryReloadKey, setSummaryReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    correctionType: 'bonus',
    amount: '',
    effectiveDate: toLocalDateString(startOfMonth(new Date())),
    notes: '',
  });
  const [pendingRemoval, setPendingRemoval] = useState(null);

  const monthStart = useMemo(() => toLocalDateString(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => toLocalDateString(endOfMonth(monthDate)), [monthDate]);

  // A correction belongs to the month on screen. Defaulting to today put a fix for last month into
  // this one whenever the office was looking back.
  useEffect(() => {
    setForm((current) => ({ ...current, effectiveDate: monthStart }));
  }, [monthStart]);

  const loadData = useCallback(async () => {
    if (!employee?.id || !orgId) return;
    try {
      const adjustmentsPayload = await authenticatedFetch('payroll-adjustments', {
        session,
        params: {
          org_id: orgId,
          employee_id: employee.id,
          start_date: monthStart,
          end_date: monthEnd,
        },
      });
      setAdjustments(Array.isArray(adjustmentsPayload?.entries) ? adjustmentsPayload.entries : []);
    } catch (error) {
      console.error('Failed to load finance data', error);
      toast.error(error?.message || 'טעינת נתוני הפיננסים נכשלה.');
    }
  }, [employee?.id, monthEnd, monthStart, orgId, session]);

  const reloadAll = useCallback(async () => {
    setSummaryReloadKey((value) => value + 1);
    await loadData();
  }, [loadData]);

  const handleSummaryLoaded = useCallback((payload) => {
    setLeavePolicy(payload?.leave_pay_policy || null);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSaveAdjustment() {
    if (!employee?.id || !orgId) return;
    setSaving(true);
    try {
      const rawAmount = toAgorot(form.amount);
      const normalizedAmount = form.correctionType === 'deduction'
        ? -Math.abs(rawAmount)
        : rawAmount;
      await authenticatedFetch('payroll-adjustments', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          employee_id: employee.id,
          correction_type: form.correctionType,
          amount: normalizedAmount,
          effective_date: form.effectiveDate,
          notes: form.notes || null,
        },
      });
      setForm({
        correctionType: 'bonus',
        amount: '',
        effectiveDate: monthStart,
        notes: '',
      });
      await reloadAll();
      toast.success('התיקון הפיננסי נשמר.');
    } catch (error) {
      console.error('Failed to save finance correction', error);
      toast.error(error?.message || 'שמירת התיקון נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAdjustment(id) {
    setSaving(true);
    try {
      await authenticatedFetch('payroll-adjustments', {
        session,
        method: 'DELETE',
        body: {
          org_id: orgId,
          id,
        },
      });
      setAdjustments((current) => current.filter((entry) => entry.id !== id));
      await reloadAll();
      toast.success('התיקון הוסר.');
    } catch (error) {
      console.error('Failed to delete finance correction', error);
      toast.error(error?.message || 'מחיקת התיקון נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 [font-family:inherit]">
    <LeavePayBox
      employee={employee}
      orgId={orgId}
      session={session}
      policy={leavePolicy}
      onSaved={reloadAll}
      onEmployeeChanged={onEmployeeChanged}
    />
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] [font-family:inherit]">
      <div className="space-y-2">
        {onEditEmployee ? (
          <Button size="sm" variant="outline" onClick={onEditEmployee}>עריכת כרטיס העובד</Button>
        ) : null}
        <EmployeePaySummary
          orgId={orgId}
          session={session}
          employeeId={employee?.id}
          monthDate={monthDate}
          onMonthChange={setMonthDate}
          reloadKey={summaryReloadKey}
          onLoaded={handleSummaryLoaded}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm [font-family:inherit]">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-900">תיקונים פיננסיים</h3>
          <p className="text-xs text-slate-500">בונוסים, ניכויים ותיקונים שלא מגיעים מזרימת עבודה אחרת.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-slate-600">סוג תיקון</Label>
            <Select value={form.correctionType} onValueChange={(value) => setForm((current) => ({ ...current, correctionType: value }))} disabled={saving}>
              <SelectTrigger className="[font-family:inherit]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="[font-family:inherit]">
                <SelectItem value="bonus" className="[font-family:inherit]">בונוס</SelectItem>
                <SelectItem value="deduction" className="[font-family:inherit]">ניכוי</SelectItem>
                <SelectItem value="adjustment" className="[font-family:inherit]">התאמה</SelectItem>
                <SelectItem value="correction" className="[font-family:inherit]">תיקון</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="finance-amount" className="text-xs text-slate-600">סכום</Label>
            <Input id="finance-amount" type="number" step="0.01" className="[font-family:inherit]" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} disabled={saving} />
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="finance-date" className="text-xs text-slate-600">תאריך אפקטיבי</Label>
            <Input id="finance-date" type="date" className="[font-family:inherit]" value={form.effectiveDate} onChange={(event) => setForm((current) => ({ ...current, effectiveDate: event.target.value }))} disabled={saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="finance-notes" className="text-xs text-slate-600">הערות</Label>
            <Input id="finance-notes" className="[font-family:inherit]" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Button className="[font-family:inherit]" onClick={handleSaveAdjustment} disabled={saving || form.amount === ''}>
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            הוסף תיקון
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {adjustments.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{entry.correction_type} • {formatCurrency(entry.amount)}</div>
                  <div className="mt-1 text-xs text-slate-500">{entry.effective_date} • {entry.notes || 'ללא הערות'}</div>
                </div>
                <Button size="sm" variant="outline" className="[font-family:inherit]" onClick={() => setPendingRemoval(entry)} disabled={saving}>
                  הסר
                </Button>
              </div>
            </div>
          ))}
          {adjustments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
              אין תיקונים פיננסיים בחודש הזה.
            </div>
          ) : null}
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}
        onConfirm={() => {
          const target = pendingRemoval;
          setPendingRemoval(null);
          if (target?.id) void handleDeleteAdjustment(target.id);
        }}
        confirmLabel="הסרה"
        title="להסיר את התיקון?"
        description={pendingRemoval
          ? `${formatCurrency(pendingRemoval.amount)} בתאריך ${pendingRemoval.effective_date} יימחק, והשכר של החודש יחושב מחדש בלעדיו.`
          : ''}
      />
    </div>
    </div>
  );
}
