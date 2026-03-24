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

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(date);
}

const EMPTY_FORM = {
  id: '',
  leaveType: 'employee_paid',
  durationMode: 'full_day',
  halfDayPart: 'first_half',
  startDate: toLocalDateString(new Date()),
  endDate: toLocalDateString(new Date()),
  reason: '',
  notes: '',
};

export default function EmployeeLeavePanel({ employee, orgId, session }) {
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const monthStart = useMemo(() => toLocalDateString(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => toLocalDateString(endOfMonth(monthDate)), [monthDate]);

  const loadData = useCallback(async () => {
    if (!employee?.id || !orgId) return;
    setLoading(true);
    try {
      const payload = await authenticatedFetch('employee-leave', {
        session,
        params: {
          org_id: orgId,
          employee_id: employee.id,
          start_date: monthStart,
          end_date: monthEnd,
        },
      });
      setSummary(payload?.summary || null);
      setEntries(Array.isArray(payload?.leave_entries) ? payload.leave_entries : []);
    } catch (error) {
      console.error('Failed to load leave data', error);
      toast.error(error?.message || 'טעינת נתוני החופשה נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [employee?.id, monthEnd, monthStart, orgId, session]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function resetForm() {
    setForm({
      ...EMPTY_FORM,
      startDate: monthStart,
      endDate: monthStart,
    });
  }

  function startEditing(entry) {
    setForm({
      id: entry.id,
      leaveType: entry.leave_type,
      durationMode: entry.duration_mode,
      halfDayPart: entry.half_day_part || 'first_half',
      startDate: entry.start_date,
      endDate: entry.end_date,
      reason: entry.reason || '',
      notes: entry.notes || '',
    });
  }

  async function handleSave() {
    if (!employee?.id || !orgId) return;
    setSaving(true);
    try {
      await authenticatedFetch('employee-leave', {
        session,
        method: form.id ? 'PUT' : 'POST',
        body: {
          id: form.id || undefined,
          org_id: orgId,
          employee_id: employee.id,
          leave_type: form.leaveType,
          duration_mode: form.durationMode,
          half_day_part: form.durationMode === 'half_day' ? form.halfDayPart : null,
          start_date: form.startDate,
          end_date: form.durationMode === 'half_day' ? form.startDate : form.endDate,
          reason: form.reason || null,
          notes: form.notes || null,
        },
      });
      await loadData();
      resetForm();
      toast.success('החופשה נשמרה.');
    } catch (error) {
      console.error('Failed to save leave entry', error);
      const conflictMessage = error?.data?.message === 'leave_conflicts_with_lessons'
        ? 'יש שיעורים קיימים בטווח הזה. יש להזיז או לבטל אותם לפני יצירת חופשה.'
        : error?.data?.message === 'leave_conflicts_with_attendance'
          ? 'יש רישומי נוכחות בטווח הזה. יש לערוך או למחוק אותם לפני יצירת חופשה.'
          : null;
      toast.error(conflictMessage || error?.message || 'שמירת החופשה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelEntry() {
    if (!form.id || !orgId) return;
    setSaving(true);
    try {
      await authenticatedFetch('employee-leave', {
        session,
        method: 'DELETE',
        body: {
          org_id: orgId,
          id: form.id,
        },
      });
      await loadData();
      resetForm();
      toast.success('החופשה בוטלה.');
    } catch (error) {
      console.error('Failed to cancel leave entry', error);
      toast.error(error?.message || 'ביטול החופשה נכשל.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">יתרה והיסטוריה</h3>
            <p className="text-xs text-slate-500">יצירת חופשה חוסמת ימים עם שיעורים או נוכחות קיימת.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, -1))}>הקודם</Button>
            <div className="min-w-[120px] text-center text-sm font-semibold text-slate-700">{formatMonth(monthDate)}</div>
            <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, 1))}>הבא</Button>
          </div>
        </div>

        {summary ? (
          <div className="mb-4 grid gap-2 md:grid-cols-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
              <div className="text-[11px] text-emerald-700">יתרה</div>
              <div className="mt-1 text-xl font-extrabold text-emerald-950">{summary.remaining}</div>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-3 py-3">
              <div className="text-[11px] text-blue-700">מכסה</div>
              <div className="mt-1 text-xl font-extrabold text-blue-950">{summary.quota}</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
              <div className="text-[11px] text-amber-700">נוצל</div>
              <div className="mt-1 text-xl font-extrabold text-amber-950">{summary.used}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] text-slate-600">התאמות</div>
              <div className="mt-1 text-xl font-extrabold text-slate-900">{summary.adjustments}</div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            טוען היסטוריית חופשות...
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => startEditing(entry)}
                className={`w-full rounded-2xl border px-3 py-3 text-start transition ${
                  form.id === entry.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{formatDate(entry.start_date)}{entry.end_date !== entry.start_date ? ` עד ${formatDate(entry.end_date)}` : ''}</div>
                    <div className="mt-1 text-xs text-slate-500">{entry.reason || 'ללא סיבה'} • {entry.notes || 'ללא הערות'}</div>
                  </div>
                  <Badge variant="outline">{entry.leave_type}</Badge>
                </div>
              </button>
            ))}
            {entries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                לא נמצאו חופשות בחודש הזה.
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-900">{form.id ? 'עריכת חופשה' : 'חופשה חדשה'}</h3>
          <p className="text-xs text-slate-500">שמירה תרחיב את החופשה לימי מערכת ותעדכן יתרת חופשה אוטומטית.</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-slate-600">סוג חופשה</Label>
            <Select value={form.leaveType} onValueChange={(value) => setForm((current) => ({ ...current, leaveType: value, durationMode: value === 'half_day' ? 'half_day' : current.durationMode }))} disabled={saving}>
              <SelectTrigger>
                <SelectValue placeholder="בחר סוג חופשה" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee_paid">חופשה על חשבון העובד</SelectItem>
                <SelectItem value="system_paid">חופשה על חשבון המערכת</SelectItem>
                <SelectItem value="unpaid">חופשה ללא תשלום</SelectItem>
                <SelectItem value="half_day">חצי יום</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="leave-start" className="text-xs text-slate-600">תאריך התחלה</Label>
              <Input id="leave-start" type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-end" className="text-xs text-slate-600">תאריך סיום</Label>
              <Input id="leave-end" type="date" value={form.durationMode === 'half_day' ? form.startDate : form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} disabled={saving || form.durationMode === 'half_day'} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-slate-600">משך</Label>
              <Select value={form.durationMode} onValueChange={(value) => setForm((current) => ({ ...current, durationMode: value, endDate: value === 'half_day' ? current.startDate : current.endDate }))} disabled={saving || form.leaveType === 'half_day'}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_day">יום מלא / טווח</SelectItem>
                  <SelectItem value="half_day">חצי יום</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.durationMode === 'half_day' ? (
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">חצי יום</Label>
                <Select value={form.halfDayPart} onValueChange={(value) => setForm((current) => ({ ...current, halfDayPart: value }))} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first_half">חצי ראשון</SelectItem>
                    <SelectItem value="second_half">חצי שני</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="leave-reason" className="text-xs text-slate-600">סיבה</Label>
            <Input id="leave-reason" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} disabled={saving} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="leave-notes" className="text-xs text-slate-600">הערות</Label>
            <Input id="leave-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {form.id ? 'עדכן חופשה' : 'צור חופשה'}
            </Button>
            {form.id ? (
              <Button variant="outline" onClick={handleCancelEntry} disabled={saving}>
                בטל חופשה
              </Button>
            ) : null}
            <Button variant="ghost" onClick={resetForm} disabled={saving}>נקה טופס</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
