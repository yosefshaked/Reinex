import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { createPortal } from 'react-dom';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { attendanceTotals, buildMonthWeeks, formatMinutes } from './attendance-month-grid.js';
import { Loader2, TriangleAlert } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog.jsx';
import { formatDateKey } from '@/lib/date-key-format.js';
import { toast } from '@/lib/toast.jsx';
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
  const editorRef = useRef(null);
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateString(new Date()));
  const [records, setRecords] = useState([]);
  const [lessonDays, setLessonDays] = useState([]);
  const [leaveDays, setLeaveDays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ status: 'present', workedMinutes: '', notes: '' });
  const [hourlyRates, setHourlyRates] = useState([]);

  // Office hours are paid from the hourly rate in effect that day. Loaded once so the day editor can
  // say when hours being entered will not be paid.
  useEffect(() => {
    if (!employee?.id || !orgId) return undefined;
    let active = true;
    authenticatedFetch('employee-rates', { session, params: { org_id: orgId, employee_id: employee.id } })
      .then((payload) => {
        if (!active) return;
        const rows = Array.isArray(payload?.rates) ? payload.rates : [];
        setHourlyRates(rows.filter((row) => row.pay_basis === 'attendance_hourly' && !row.service_id));
      })
      .catch(() => { if (active) setHourlyRates([]); });
    return () => { active = false; };
  }, [employee?.id, orgId, session]);

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
        setLessonDays(Array.isArray(payload?.lesson_days) ? payload.lesson_days : []);
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
  const lessonsByDate = useMemo(() => new Map(lessonDays.map((row) => [row.date, row])), [lessonDays]);
  const leaveByDate = useMemo(() => new Map(leaveDays.map((row) => [row.leave_date, row])), [leaveDays]);

  useEffect(() => {
    const record = recordsByDate.get(selectedDate);
    if (record) {
      setForm({
        status: record.status || 'present',
        workedMinutes: record.other_minutes ?? '',
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
        lessons: lessonsByDate.get(dateKey) || null,
        leave: leaveByDate.get(dateKey) || null,
      });
    }
    return items;
  }, [leaveByDate, lessonsByDate, monthDate, recordsByDate]);

  const weeks = useMemo(() => buildMonthWeeks(days), [days]);
  const monthTotals = useMemo(() => attendanceTotals(days), [days]);
  const selectedRecord = recordsByDate.get(selectedDate) || null;
  const selectedLessonMinutes = Math.max(0, Number(lessonsByDate.get(selectedDate)?.lesson_minutes) || 0);
  const firstHourlyRateDate = hourlyRates.map((row) => row.effective_date).sort()[0] || null;
  const hourlyRateOnSelectedDay = hourlyRates.some((row) => row.effective_date <= selectedDate);
  const enteringOtherMinutes = Number(form.workedMinutes) > 0;
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
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
          other_minutes: form.workedMinutes === '' ? null : Number(form.workedMinutes),
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
      setLessonDays(Array.isArray(payload?.lesson_days) ? payload.lesson_days : []);
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
    setConfirmRemoveOpen(false);
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
    <div className="grid min-w-0 max-w-full gap-3">
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">נוכחות חודשית</h3>
            <p className="text-xs text-slate-500">
              שעות שאינן מפגש, לפי יום. דקות המפגשים מגיעות מהיומן ומשולמות דרך המפגש. ימי חופשה חוסמים הזנה.
            </p>
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
          <TooltipProvider delayDuration={200}>
            <p className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-slate-600">
              <span className="font-semibold text-slate-900">סה"כ בחודש: <bdi dir="ltr">{formatMinutes(monthTotals.totalMinutes)}</bdi> שעות</span>
              <span>מפגשים <bdi dir="ltr">{formatMinutes(monthTotals.lessonMinutes)}</bdi> · עבודה אחרת <bdi dir="ltr">{formatMinutes(monthTotals.otherMinutes)}</bdi></span>
            </p>
            <div className="max-w-full overflow-x-auto rounded-xl border border-slate-200" dir="rtl" role="region" aria-label="טבלת נוכחות חודשית" tabIndex={0}>
              <table className="w-full min-w-[640px] table-fixed border-collapse text-start">
                <caption className="sr-only">{formatMonth(monthDate)} — בחירת יום לעריכה</caption>
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    {['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'סה"כ שבועי'].map((label) => (
                      <th key={label} scope="col" className="border-b p-2 text-start font-semibold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, index) => (
                    <tr key={index}>
                      {week.map((day, weekday) => {
                        if (!day) return <td key={weekday} className="border border-slate-100 bg-slate-50/40" />;
                        const totals = attendanceTotals([day]);
                        const empty = !day.record && !day.lessons && !day.leave;
                        const quietWeekend = empty && weekday >= 5;
                        const emptyLabel = quietWeekend ? 'סוף שבוע' : 'אין רישום';
                        const leaveLabel = day.leave ? `חופשה: ${day.leave.entry?.reason || day.leave.leave_type}` : null;
                        const status = day.record ? STATUS_OPTIONS.find((item) => item.value === day.record.status)?.label || day.record.status : null;
                        return (
                          <td key={day.date} className="h-24 border border-slate-100 p-0 align-top">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`${formatDate(day.date)} — ${leaveLabel || (empty ? emptyLabel : formatMinutes(totals.totalMinutes) + ' שעות')} — עריכת יום`}
                                  aria-pressed={selectedDate === day.date}
                                  onClick={() => {
                                    setSelectedDate(day.date);
                                    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }}
                                  className={cn('flex h-full min-h-24 w-full flex-col items-start gap-1 p-2 text-start transition hover:bg-blue-50 focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600',
                                    quietWeekend ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700',
                                    day.leave && 'bg-amber-50 text-amber-900',
                                    selectedDate === day.date && 'bg-blue-50 ring-2 ring-inset ring-blue-500')}
                                >
                                  <span className="text-xs">{Number(day.date.slice(-2))}</span>
                                  {empty ? <span className="mt-2 text-xs">{emptyLabel}</span> : (
                                    <>
                                      {totals.totalMinutes > 0 ? (
                                        <>
                                          <bdi dir="ltr" className="text-xl font-bold tabular-nums">{formatMinutes(totals.totalMinutes)}</bdi>
                                          <span className="text-[11px] leading-4">
                                            {totals.lessonMinutes > 0 ? <>מפגשים <bdi dir="ltr">{formatMinutes(totals.lessonMinutes)}</bdi></> : null}
                                            {totals.lessonMinutes > 0 && totals.otherMinutes > 0 ? ' · ' : null}
                                            {totals.otherMinutes > 0 ? <>עבודה אחרת <bdi dir="ltr">{formatMinutes(totals.otherMinutes)}</bdi></> : null}
                                          </span>
                                        </>
                                      ) : null}
                                      {leaveLabel ? <span className="line-clamp-2 text-xs font-semibold">{leaveLabel}</span> : null}
                                    </>
                                  )}
                                </button>
                              </TooltipTrigger>
                              {createPortal(
                                <TooltipContent dir="rtl" className="max-w-[min(320px,calc(100vw-24px))] space-y-1 whitespace-pre-wrap break-words">
                                  <p className="font-semibold">{formatDate(day.date)}</p>
                                  {leaveLabel ? <p>{leaveLabel}</p> : null}
                                  {status ? <p>{status}</p> : null}
                                  <p>סה"כ <bdi dir="ltr">{formatMinutes(totals.totalMinutes)}</bdi> שעות</p>
                                  <p>מפגשים <bdi dir="ltr">{formatMinutes(totals.lessonMinutes)}</bdi> · עבודה אחרת <bdi dir="ltr">{formatMinutes(totals.otherMinutes)}</bdi></p>
                                  {day.lessons ? <p>מספר מפגשים: {day.lessons.lesson_count || 0} · ללא סימון נוכחות: {day.lessons.unmarked_lesson_count || 0}</p> : null}
                                  {day.record?.notes ? <p>{day.record.notes}</p> : null}
                                  {empty ? <p>{emptyLabel}</p> : null}
                                  <p>לחצו לעריכת היום</p>
                                </TooltipContent>, document.body)}
                            </Tooltip>
                          </td>
                        );
                      })}
                      <td className="border border-slate-100 bg-slate-50 p-2 align-middle text-lg font-semibold tabular-nums text-slate-700">
                        <bdi dir="ltr">{formatMinutes(attendanceTotals(week).totalMinutes)}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TooltipProvider>
        )}
      </section>

      <section ref={editorRef} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label htmlFor="worked-minutes" className="text-xs text-slate-600">דקות עבודה שאינה מפגש</Label>
              {selectedLessonMinutes > 0 ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                  מפגשים באותו יום: {selectedLessonMinutes} דק׳
                </span>
              ) : null}
            </div>
            <Input id="worked-minutes" type="number" min="0" step="15" value={form.workedMinutes} onChange={(event) => setForm((current) => ({ ...current, workedMinutes: event.target.value }))} disabled={saving || Boolean(selectedLeave)} />
            {enteringOtherMinutes && !hourlyRateOnSelectedDay ? (
              <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {firstHourlyRateDate
                    ? `התעריף השעתי מתחיל רק ב-${formatDateKey(firstHourlyRateDate)}. השעות יירשמו, אבל לא ישולמו — כדי לשלם עליהן, הוסיפו תעריף שעתי שחל מהיום הזה או קודם (לשונית פיננסים).`
                    : 'לעובד/ת אין תעריף שעתי. השעות יירשמו, אבל לא ישולמו — כדי לשלם עליהן, הוסיפו תעריף שעתי בלשונית פיננסים.'}
                </span>
              </p>
            ) : null}
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
              <Button variant="outline" onClick={() => setConfirmRemoveOpen(true)} disabled={saving}>
                הסר רישום
              </Button>
            ) : null}
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={confirmRemoveOpen}
        onOpenChange={setConfirmRemoveOpen}
        onConfirm={handleDelete}
        confirmLabel="הסרה"
        title="להסיר את רישום הנוכחות?"
        description={selectedLessonMinutes > 0
          ? `שעות העבודה שאינן מפגש יימחקו. ${selectedLessonMinutes} דקות המפגשים של אותו יום יישארו, הן מגיעות מהיומן.`
          : 'הרישום של אותו יום יימחק. אפשר להזין אותו מחדש, אבל מה שנרשם עד עכשיו יאבד.'}
      />
    </div>
  );
}
