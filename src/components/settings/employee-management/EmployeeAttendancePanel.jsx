import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  LEAVE_PORTION_OPTIONS,
  LEAVE_TYPE_OPTIONS,
  attendanceTotals,
  buildLeaveRequestBody,
  buildMonthWeeks,
  describeLeaveDay,
  emptyLeaveForm,
  formatMinutes,
  leaveFormFromEntry,
  leaveSaveErrorMessage,
} from './attendance-month-grid.js';
import LeaveBalanceLine from './LeaveBalanceLine.jsx';
import { Loader2, TriangleAlert } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog.jsx';
import { formatDateKey } from '@/lib/date-key-format.js';
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { calendarDateFromDateKey, dateKeyFromCalendarDate, firstDayOfMonth, todayKey } from '@/lib/local-time.js';

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
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

const DAY_MODES = [
  { value: 'work', label: 'שעות עבודה' },
  { value: 'leave', label: 'חופשה' },
];

export default function EmployeeAttendancePanel({ employee, orgId, session }) {
  const editorRef = useRef(null);
  const [monthDate, setMonthDate] = useState(() => calendarDateFromDateKey(firstDayOfMonth(todayKey())));
  const [selectedDate, setSelectedDate] = useState(() => todayKey());
  const [records, setRecords] = useState([]);
  const [lessonDays, setLessonDays] = useState([]);
  const [leaveDays, setLeaveDays] = useState([]);
  const [leaveSummary, setLeaveSummary] = useState(null);
  const [leaveEntitlement, setLeaveEntitlement] = useState(null);
  const [balanceEvents, setBalanceEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ status: 'present', workedMinutes: '', notes: '' });
  const [dayMode, setDayMode] = useState('work');
  const [leaveForm, setLeaveForm] = useState(() => emptyLeaveForm(todayKey()));
  const [editingLeave, setEditingLeave] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [confirmRemoveLeaveOpen, setConfirmRemoveLeaveOpen] = useState(false);
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

  const monthStart = useMemo(() => dateKeyFromCalendarDate(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => dateKeyFromCalendarDate(endOfMonth(monthDate)), [monthDate]);

  // The balance belongs to a calendar year, not a month: it is read once per employee and year (its
  // entitlement may count a whole year of lessons), and again after a change on this tab.
  const balanceYear = monthStart.slice(0, 4);

  const fetchMonth = useCallback(async () => {
    const params = { org_id: orgId, employee_id: employee.id, start_date: monthStart, end_date: monthEnd };
    const attendance = await authenticatedFetch('employee-attendance', { session, params });
    return { attendance };
  }, [employee?.id, monthEnd, monthStart, orgId, session]);

  const applyMonth = useCallback(({ attendance }) => {
    setRecords(Array.isArray(attendance?.records) ? attendance.records : []);
    setLessonDays(Array.isArray(attendance?.lesson_days) ? attendance.lesson_days : []);
    setLeaveDays(Array.isArray(attendance?.leave_days) ? attendance.leave_days : []);
  }, []);

  const loadBalance = useCallback(async () => {
    // The balance is secondary: the grid still works when it cannot be read.
    const leave = await authenticatedFetch('employee-leave', {
      session,
      params: { org_id: orgId, employee_id: employee.id, year: balanceYear },
    }).catch((error) => {
      console.error('Failed to load leave balance', error);
      return null;
    });
    setLeaveSummary(leave?.summary || null);
    setLeaveEntitlement(leave?.entitlement || null);
    setBalanceEvents(Array.isArray(leave?.balance_events) ? leave.balance_events : []);
  }, [balanceYear, employee?.id, orgId, session]);

  useEffect(() => {
    if (!employee?.id || !orgId) return;
    void loadBalance();
    // A changed start date or work week (edited elsewhere) changes the entitlement.
  }, [employee?.id, employee?.start_date, employee?.working_days, loadBalance, orgId]);

  const reloadMonth = useCallback(async () => {
    const [month] = await Promise.all([fetchMonth(), loadBalance()]);
    applyMonth(month);
  }, [applyMonth, fetchMonth, loadBalance]);

  useEffect(() => {
    if (!employee?.id || !orgId) return undefined;

    let active = true;
    setLoading(true);
    fetchMonth()
      .then((data) => { if (active) applyMonth(data); })
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
  }, [applyMonth, employee?.id, fetchMonth, orgId]);

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

  // A new day starts on hours; leave already on the day opens as leave.
  useEffect(() => {
    setEditingLeave(false);
    setLeaveForm(emptyLeaveForm(selectedDate));
    setDayMode(leaveByDate.has(selectedDate) ? 'leave' : 'work');
  }, [leaveByDate, selectedDate]);

  const days = useMemo(() => {
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);
    const items = [];
    for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
      const dateKey = dateKeyFromCalendarDate(current);
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
  const selectedLeave = leaveByDate.get(selectedDate) || null;
  const selectedLeaveEntry = selectedLeave?.entry || null;
  const leaveStartDate = editingLeave && selectedLeaveEntry?.start_date ? selectedLeaveEntry.start_date : selectedDate;
  const leaveIsHalf = leaveForm.portion !== 'full_day';
  // Leave cannot sit on a day that already has hours; say so before the save is refused. Lessons
  // on the leave days are checked by the server, which also covers the rest of a range.
  const leaveBlockedReason = !editingLeave && selectedRecord
    ? 'יש ביום הזה שעות עבודה רשומות. יש להסיר אותן לפני רישום חופשה.'
    : null;

  async function handleSave() {
    if (!employee?.id || !orgId) return;
    if (selectedLeave) {
      toast.error('היום מסומן כחופשה. יש להסיר או לערוך את החופשה לפני הזנת שעות.');
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
      await reloadMonth();
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

  async function handleSaveLeave() {
    if (!employee?.id || !orgId) return;
    setSaving(true);
    try {
      await authenticatedFetch('employee-leave', {
        session,
        method: leaveForm.id ? 'PUT' : 'POST',
        body: buildLeaveRequestBody(leaveForm, { orgId, employeeId: employee.id, startDate: leaveStartDate }),
      });
      await reloadMonth();
      setEditingLeave(false);
      toast.success('החופשה נשמרה.');
    } catch (error) {
      console.error('Failed to save leave entry', error);
      toast.error(leaveSaveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveLeave() {
    setConfirmRemoveLeaveOpen(false);
    if (!selectedLeaveEntry?.id || !orgId) return;
    setSaving(true);
    try {
      await authenticatedFetch('employee-leave', {
        session,
        method: 'DELETE',
        body: { org_id: orgId, id: selectedLeaveEntry.id },
      });
      await reloadMonth();
      toast.success('החופשה הוסרה.');
    } catch (error) {
      console.error('Failed to remove leave entry', error);
      toast.error(error?.message || 'הסרת החופשה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  const leaveRange = selectedLeaveEntry && selectedLeaveEntry.end_date && selectedLeaveEntry.end_date !== selectedLeaveEntry.start_date
    ? `${formatDateKey(selectedLeaveEntry.start_date)}–${formatDateKey(selectedLeaveEntry.end_date)}`
    : null;

  function renderLeaveForm() {
    return (
      <div className="space-y-3" data-leave-form>
        {editingLeave && selectedLeaveEntry?.start_date !== selectedDate ? (
          <p className="text-xs text-slate-500">החופשה מתחילה ב-{formatDateKey(leaveStartDate)}.</p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="leave-type" className="text-xs text-slate-600">על חשבון</Label>
            <Select value={leaveForm.leaveType} onValueChange={(value) => setLeaveForm((current) => ({ ...current, leaveType: value }))} disabled={saving}>
              <SelectTrigger id="leave-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAVE_TYPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-portion" className="text-xs text-slate-600">משך</Label>
            <Select value={leaveForm.portion} onValueChange={(value) => setLeaveForm((current) => ({ ...current, portion: value }))} disabled={saving}>
              <SelectTrigger id="leave-portion"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAVE_PORTION_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-end-date" className="text-xs text-slate-600">עד תאריך</Label>
            <Input
              id="leave-end-date"
              type="date"
              min={leaveStartDate}
              value={leaveIsHalf ? leaveStartDate : (leaveForm.endDate || leaveStartDate)}
              onChange={(event) => setLeaveForm((current) => ({ ...current, endDate: event.target.value }))}
              disabled={saving || leaveIsHalf}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="leave-reason" className="text-xs text-slate-600">סיבה</Label>
          <Input id="leave-reason" value={leaveForm.reason} onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))} disabled={saving} />
        </div>
        {leaveBlockedReason ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{leaveBlockedReason}</span>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={handleSaveLeave} disabled={saving || Boolean(leaveBlockedReason)}>
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            שמירת חופשה
          </Button>
          {editingLeave ? (
            <Button variant="ghost" onClick={() => setEditingLeave(false)} disabled={saving}>ביטול</Button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderWorkForm() {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label className="text-xs text-slate-600">סטטוס</Label>
          <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))} disabled={saving}>
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
          <Input id="worked-minutes" type="number" min="0" step="15" value={form.workedMinutes} onChange={(event) => setForm((current) => ({ ...current, workedMinutes: event.target.value }))} disabled={saving} />
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
          <Input id="attendance-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving}>
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
    );
  }

  function renderDayEditor() {
    if (selectedLeave && !editingLeave) {
      return (
        <div className="space-y-3" data-day-leave>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p className="font-semibold">{describeLeaveDay(selectedLeave)}</p>
            {leaveRange || selectedLeaveEntry?.reason ? (
              <p className="mt-1 text-xs">
                {[leaveRange ? `חלק מחופשה ${leaveRange}` : null, selectedLeaveEntry?.reason].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setLeaveForm(leaveFormFromEntry(selectedLeaveEntry));
                setEditingLeave(true);
              }}
              disabled={saving || !selectedLeaveEntry}
            >
              עריכת החופשה
            </Button>
            <Button variant="outline" onClick={() => setConfirmRemoveLeaveOpen(true)} disabled={saving || !selectedLeaveEntry}>
              הסרת החופשה
            </Button>
          </div>
        </div>
      );
    }
    if (editingLeave) return renderLeaveForm();
    return (
      <div className="space-y-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label="מה לרשום ביום">
          {DAY_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={dayMode === mode.value}
              onClick={() => setDayMode(mode.value)}
              disabled={saving}
              className={cn('rounded-lg px-3 py-1 text-xs font-semibold transition',
                dayMode === mode.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {dayMode === 'leave' ? renderLeaveForm() : renderWorkForm()}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 max-w-full gap-3">
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">נוכחות וחופשות</h3>
            <p className="text-xs text-slate-500">
              לחיצה על יום פותחת אותו: שעות עבודה שאינן מפגש, או חופשה. דקות המפגשים מגיעות מהיומן.
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
            <p className="mb-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-slate-600">
              <span className="font-semibold text-slate-900">סה"כ בחודש: <bdi dir="ltr">{formatMinutes(monthTotals.totalMinutes)}</bdi> שעות</span>
              <span>מפגשים <bdi dir="ltr">{formatMinutes(monthTotals.lessonMinutes)}</bdi> · עבודה אחרת <bdi dir="ltr">{formatMinutes(monthTotals.otherMinutes)}</bdi></span>
            </p>
            <LeaveBalanceLine
              summary={leaveSummary}
              entitlement={leaveEntitlement}
              balanceEvents={balanceEvents}
              employee={employee}
              orgId={orgId}
              session={session}
              onChanged={loadBalance}
            />
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
                        const leaveLabel = describeLeaveDay(day.leave);
                        const leaveReason = day.leave?.entry?.reason || null;
                        const status = day.record ? STATUS_OPTIONS.find((item) => item.value === day.record.status)?.label || day.record.status : null;
                        return (
                          <td key={day.date} className="h-24 border border-slate-100 p-0 align-top">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  data-date={day.date}
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
                                  {leaveReason ? <p>{leaveReason}</p> : null}
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

      <section ref={editorRef} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-day-editor>
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-900">עריכת יום</h3>
          <p className="text-xs text-slate-500">{formatDate(selectedDate)}</p>
        </div>
        {renderDayEditor()}
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
      <ConfirmDialog
        open={confirmRemoveLeaveOpen}
        onOpenChange={setConfirmRemoveLeaveOpen}
        onConfirm={handleRemoveLeave}
        confirmLabel="הסרה"
        title="להסיר את החופשה?"
        description={leaveRange
          ? `החופשה של כל הימים ${leaveRange} תוסר, והיתרה תתעדכן.`
          : 'החופשה של היום הזה תוסר, והיתרה תתעדכן.'}
      />
    </div>
  );
}
