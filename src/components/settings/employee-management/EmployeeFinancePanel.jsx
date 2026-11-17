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
import ConfirmDialog from '@/components/ui/ConfirmDialog.jsx';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toAgorot, formatCurrency } from '@/lib/currency.js';
import EmployeePaySummary from '@/features/finance/components/EmployeePaySummary.jsx';
import { calendarDateFromDateKey, dateKeyFromCalendarDate, firstDayOfMonth, todayKey } from '@/lib/local-time.js';

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * The employee's month of pay and the office's corrections. Leave (days a year and how a leave day
 * is paid) is set in the "נוכחות" tab's "חופשה" row, not here.
 */
export default function EmployeeFinancePanel({ employee, orgId, session, onEditEmployee }) {
  const [monthDate, setMonthDate] = useState(() => calendarDateFromDateKey(firstDayOfMonth(todayKey())));
  const [adjustments, setAdjustments] = useState([]);
  // Bumped after a correction here so the pay summary reads again.
  const [summaryReloadKey, setSummaryReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    correctionType: 'bonus',
    amount: '',
    effectiveDate: firstDayOfMonth(todayKey()),
    notes: '',
  });
  const [pendingRemoval, setPendingRemoval] = useState(null);

  const monthStart = useMemo(() => dateKeyFromCalendarDate(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => dateKeyFromCalendarDate(endOfMonth(monthDate)), [monthDate]);

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
