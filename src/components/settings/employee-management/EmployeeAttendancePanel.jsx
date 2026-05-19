import React, { useEffect, useMemo, useState } from 'react';
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
  return new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' }).format(date);
}

const STATUS_OPTIONS = [
  { value: 'present', label: 'נוכח/ת' },
  { value: 'partial', label: 'חלקי' },
  { value: 'remote', label: 'עבודה מרחוק' },
  { value: 'absent', label: 'נעדר/ת' },
];

export default function EmployeeAttendancePanel({ employee, orgId, session }) {
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateString(new Date()));
  const [records, setRecords] = useState([]);
  const [leaveDays, setLeaveDays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ status: 'present', workedMinutes: '', notes: '' });

  const monthStart = useMemo(() => toLocalDateString(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => toLocalDateString(endOfMonth(monthDate)), [monthDate]);

  useEffect(() => {
    if (!employee?.id || !orgId) return;

    let active = true;
    setLoading(true);
    authenticatedFetch('employee-attendance', {
      session,
      params: {
        org_id: orgId,
        employee_id: employee.id,
        start_date: monthStart,
        end_date: monthEnd,
      },
    })
      .then((payload) => {
        if (!active) return;
        setRecords(Array.isArray(payload?.records) ? payload.records : []);
        setLeaveDays(Array.isArray(payload?.leave_days) ? payload.leave_days : []);
      })
      .catch((error) => {
        console.error('Failed to load attendance', error);
        toast.error(error?.message || 'טעינת הנוכחות נכשלה.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [employee?.id, monthEnd, monthStart, orgId, session]);

  const recordsByDate = useMemo(() => new Map(records.map((record) => [record.attendance_date, record])), [records]);
  const leaveByDate = useMemo(() => new Map(leaveDays.map((row) => [row.leave_date, row])), [leaveDays]);

  useEffect(() => {
    const record = recordsByDate.get(selectedDate);
    if (record) {
      setForm({
        status: record.status || 'present',
        workedMinutes: record.worked_minutes ?? '',
        notes: record.notes || '',
      });
      return;
    }
    setForm({ status: 'present', workedMinutes: '', notes: '' });
  }, [recordsByDate, selectedDate]);

  const days = useMemo(() => {
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);
    const items = [];
    for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
      const dateKey = toLocalDateString(current);
      items.push({
        date: dateKey,
        record: recordsByDate.get(dateKey) || null,
        leave: leaveByDate.get(dateKey) || null,
      });
    }
    return items;
  }, [leaveByDate, monthDate, recordsByDate]);

  const selectedRecord = recordsByDate.get(selectedDate) || null;
  const selectedLeave = leaveByDate.get(selectedDate) || null;

  async function handleSave() {
    if (!employee?.id || !orgId) return;
    if (selectedLeave) {
      toast.error('היום מסומן כחופשה. יש להסיר או לערוך את החופשה לפני הזנת נוכחות.');
      return;
    }

    setSaving(true);
    try {
      await authenticatedFetch('employee-attendance', {
        session,
        method: selectedRecord ? 'PUT' : 'POST',
        body: {
          id: selectedRecord?.id || undefined,
          org_id: orgId,
          employee_id: employee.id,
          attendance_date: selectedDate,
          status: form.status,
          worked_minutes: form.workedMinutes === '' ? null : Number(form.workedMinutes),
          notes: form.notes || null,
        },
      });

      const payload = await authenticatedFetch('employee-attendance', {
        session,
        params: {
          org_id: orgId,
          employee_id: employee.id,
          start_date: monthStart,
          end_date: monthEnd,
        },
      });
      setRecords(Array.isArray(payload?.records) ? payload.records : []);
      setLeaveDays(Array.isArray(payload?.leave_days) ? payload.leave_days : []);
      toast.success('הנוכחות נשמרה.');
    } catch (error) {
      console.error('Failed to save attendance', error);
      toast.error(error?.message || 'שמירת הנוכחות נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedRecord?.id || !employee?.id || !orgId) return;
    setSaving(true);
    try {
      await authenticatedFetch('employee-attendance', {
        session,
        method: 'DELETE',
        body: {
          org_id: orgId,
          id: selectedRecord.id,
        },
      });

      setRecords((current) => current.filter((record) => record.id !== selectedRecord.id));
      toast.success('רישום הנוכחות הוסר.');
    } catch (error) {
      console.error('Failed to delete attendance', error);
      toast.error(error?.message || 'מחיקת רישום הנוכחות נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">נוכחות חודשית</h3>
            <p className="text-xs text-slate-500">רישום ידני לעובדי משרד לפי יום. ימי חופשה חוסמים הזנה.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, -1))}>הקודם</Button>
            <div className="min-w-[120px] text-center text-sm font-semibold text-slate-700">{formatMonth(monthDate)}</div>
            <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, 1))}>הבא</Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            טוען נתוני נוכחות...
          </div>
        ) : (
          <div className="space-y-2">
            {days.map((day) => (
              <button
                key={day.date}
                type="button"
                onClick={() => setSelectedDate(day.date)}
                className={`w-full rounded-2xl border px-3 py-3 text-start transition ${
                  selectedDate === day.date
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{formatDate(day.date)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {day.leave
                        ? `חופשה: ${day.leave.entry?.reason || day.leave.leave_type}`
                        : day.record
                          ? `${STATUS_OPTIONS.find((item) => item.value === day.record.status)?.label || day.record.status} • ${day.record.worked_minutes ?? 0} דק׳`
                          : 'ללא רישום'}
                    </div>
                  </div>
                  {day.leave ? (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">חופשה</Badge>
                  ) : day.record ? (
                    <Badge variant="outline">{STATUS_OPTIONS.find((item) => item.value === day.record.status)?.label || day.record.status}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-slate-400">ריק</Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-900">עריכת יום</h3>
          <p className="text-xs text-slate-500">{formatDate(selectedDate)}</p>
        </div>

        {selectedLeave ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            היום מסומן כחופשה מאושרת. יש לערוך או להסיר את החופשה לפני הזנת נוכחות.
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-slate-600">סטטוס</Label>
            <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))} disabled={saving || Boolean(selectedLeave)}>
              <SelectTrigger>
                <SelectValue placeholder="בחר סטטוס" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="worked-minutes" className="text-xs text-slate-600">דקות עבודה</Label>
            <Input id="worked-minutes" type="number" min="0" step="15" value={form.workedMinutes} onChange={(event) => setForm((current) => ({ ...current, workedMinutes: event.target.value }))} disabled={saving || Boolean(selectedLeave)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="attendance-notes" className="text-xs text-slate-600">הערות</Label>
            <Input id="attendance-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving || Boolean(selectedLeave)} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || Boolean(selectedLeave)}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {selectedRecord ? 'עדכן נוכחות' : 'שמור נוכחות'}
            </Button>
            {selectedRecord ? (
              <Button variant="outline" onClick={handleDelete} disabled={saving}>
                הסר רישום
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
