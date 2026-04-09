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
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toAgorot, formatCurrency } from '@/lib/currency.js';

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function toLocalDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatMonth(date) {
  return new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(date);
}



function getPayrollModelLabel(value) {
  if (value === 'lesson_based') return 'מבוסס שיעורים';
  if (value === 'monthly_salary') return 'שכר חודשי';
  return 'שעתי';
}

export default function EmployeeFinancePanel({ employee, orgId, session, onEditEmployee }) {
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [preview, setPreview] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    correctionType: 'bonus',
    amount: '',
    effectiveDate: toLocalDateString(new Date()),
    notes: '',
  });

  const monthStart = useMemo(() => toLocalDateString(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => toLocalDateString(endOfMonth(monthDate)), [monthDate]);

  const loadData = useCallback(async () => {
    if (!employee?.id || !orgId) return;
    setLoading(true);
    try {
      const [payrollPayload, adjustmentsPayload] = await Promise.all([
        authenticatedFetch('payroll', {
          session,
          params: {
            org_id: orgId,
            employee_id: employee.id,
            start_date: monthStart,
            end_date: monthEnd,
          },
        }),
        authenticatedFetch('payroll-adjustments', {
          session,
          params: {
            org_id: orgId,
            employee_id: employee.id,
            start_date: monthStart,
            end_date: monthEnd,
          },
        }),
      ]);

      setPreview(Array.isArray(payrollPayload?.employees) ? payrollPayload.employees[0] || null : null);
      setAdjustments(Array.isArray(adjustmentsPayload?.entries) ? adjustmentsPayload.entries : []);
    } catch (error) {
      console.error('Failed to load finance data', error);
      toast.error(error?.message || 'טעינת נתוני הפיננסים נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [employee?.id, monthEnd, monthStart, orgId, session]);

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
      await loadData();
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
      await loadData();
      toast.success('התיקון הוסר.');
    } catch (error) {
      console.error('Failed to delete finance correction', error);
      toast.error(error?.message || 'מחיקת התיקון נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] [font-family:inherit]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm [font-family:inherit]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">תצוגת שכר חיה</h3>
            <p className="text-xs text-slate-500">מבוסס על נוכחות, שיעורים, חופשות ותיקונים פיננסיים.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, -1))}>הקודם</Button>
            <div className="min-w-[120px] text-center text-sm font-semibold text-slate-700">{formatMonth(monthDate)}</div>
            <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, 1))}>הבא</Button>
          </div>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-[11px] text-slate-500">מודל שכר</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{getPayrollModelLabel(employee?.payroll_model || (employee?.employee_type === 'instructor' ? 'lesson_based' : 'hourly'))}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-[11px] text-slate-500">תעריף / שכר</div>
            <div className="mt-1 text-lg font-bold text-slate-900">
              {employee?.payroll_model === 'monthly_salary'
                ? formatCurrency(employee?.monthly_salary_amount)
                : formatCurrency(employee?.current_rate)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-[11px] text-slate-500">שיטת חופשה</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{employee?.leave_pay_method || 'ברירת מחדל'}</div>
          </div>
        </div>

        {onEditEmployee ? (
          <div className="mb-4">
            <Button size="sm" variant="outline" onClick={onEditEmployee}>ערוך הגדרות שכר בכרטיס העובד</Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            טוען תצוגת שכר...
          </div>
        ) : preview ? (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-3 py-3">
                <div className="text-[11px] text-blue-700">בסיס</div>
                <div className="mt-1 text-xl font-bold text-blue-950">{formatCurrency(preview.base_amount)}</div>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                <div className="text-[11px] text-emerald-700">חופשה בתשלום</div>
                <div className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(preview.paid_leave_amount)}</div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="text-[11px] text-amber-700">תיקונים</div>
                <div className="mt-1 text-xl font-bold text-amber-950">{formatCurrency(preview.correction_amount)}</div>
              </div>
              <div className="rounded-2xl border border-slate-900 bg-slate-900 px-3 py-3 text-white">
                <div className="text-[11px] text-slate-300">סה״כ</div>
                <div className="mt-1 text-xl font-bold">{formatCurrency(preview.total_amount)}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              {preview.payroll_model === 'lesson_based' ? `שיעורים: ${formatCurrency(preview.lesson_amount)}` : null}
              {preview.payroll_model === 'hourly' ? `נוכחות: ${formatCurrency(preview.attendance_amount)}` : null}
              {preview.payroll_model === 'monthly_salary' ? `שכר חודשי יחסי: ${formatCurrency(preview.monthly_salary_amount)}` : null}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            אין נתוני שכר להצגה בתקופה הזו.
          </div>
        )}
      </section>

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
                <Button size="sm" variant="outline" className="[font-family:inherit]" onClick={() => handleDeleteAdjustment(entry.id)} disabled={saving}>
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
    </div>
  );
}
