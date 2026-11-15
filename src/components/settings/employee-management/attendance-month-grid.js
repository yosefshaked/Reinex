// Presentation only: lessons come from the calendar, other work from manual records.
function minutes(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function formatMinutes(value) {
  const total = minutes(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function attendanceTotals(days) {
  return days.reduce((totals, day) => {
    const lesson = minutes(day?.lessons?.lesson_minutes);
    const other = minutes(day?.record?.other_minutes);
    return {
      lessonMinutes: totals.lessonMinutes + lesson,
      otherMinutes: totals.otherMinutes + other,
      totalMinutes: totals.totalMinutes + lesson + other,
    };
  }, { lessonMinutes: 0, otherMinutes: 0, totalMinutes: 0 });
}

// Leave is recorded from the same day editor. Who carries the day decides pay and balance:
// employee_paid comes off the balance, system_paid is paid without touching it, unpaid is neither.
// half_day is an older type that equals employee_paid for half a day; it is only shown, never offered.
export const LEAVE_TYPE_OPTIONS = [
  { value: 'employee_paid', label: 'על חשבון העובד' },
  { value: 'system_paid', label: 'על חשבון המערכת' },
  { value: 'unpaid', label: 'ללא תשלום' },
];

export const LEAVE_PORTION_OPTIONS = [
  { value: 'full_day', label: 'יום מלא' },
  { value: 'first_half', label: 'חצי יום ראשון' },
  { value: 'second_half', label: 'חצי יום שני' },
];

export function leaveTypeLabel(value) {
  if (value === 'half_day') return 'חצי יום';
  return LEAVE_TYPE_OPTIONS.find((option) => option.value === value)?.label || 'חופשה';
}

// One leave day of the attendance read (employee_leave_days row with its entry).
export function describeLeaveDay(leave) {
  if (!leave) return null;
  const half = leave.day_portion === 'first_half' || leave.day_portion === 'second_half';
  const type = leave.entry?.leave_type || leave.leave_type;
  const parts = ['חופשה', half && type !== 'half_day' ? 'חצי יום' : null, leaveTypeLabel(type)];
  return parts.filter(Boolean).join(' · ');
}

export function emptyLeaveForm(dateKey) {
  return { id: '', leaveType: 'employee_paid', portion: 'full_day', endDate: dateKey, reason: '', notes: '' };
}

// The form for an existing leave entry, opened from any of its days. The older half_day type is
// read as half a day on the employee's balance, which is what it always meant.
export function leaveFormFromEntry(entry) {
  const half = entry?.duration_mode === 'half_day' || entry?.leave_type === 'half_day';
  const type = LEAVE_TYPE_OPTIONS.some((option) => option.value === entry?.leave_type) ? entry.leave_type : 'employee_paid';
  return {
    id: entry?.id || '',
    leaveType: type,
    portion: half ? (entry?.half_day_part === 'second_half' ? 'second_half' : 'first_half') : 'full_day',
    endDate: entry?.end_date || entry?.start_date || '',
    reason: entry?.reason || '',
    notes: entry?.notes || '',
  };
}

// Body for POST/PUT /api/employee-leave. A new leave starts on the day picked in the grid; an edited
// one keeps its own start. Half a day is always a single date.
export function buildLeaveRequestBody(form, { orgId, employeeId, startDate }) {
  const half = form.portion === 'first_half' || form.portion === 'second_half';
  const endDate = half || !form.endDate || form.endDate < startDate ? startDate : form.endDate;
  return {
    id: form.id || undefined,
    org_id: orgId,
    employee_id: employeeId,
    leave_type: form.leaveType,
    duration_mode: half ? 'half_day' : 'full_day',
    half_day_part: half ? form.portion : null,
    start_date: startDate,
    end_date: endDate,
    reason: form.reason?.trim() || null,
    notes: form.notes?.trim() || null,
  };
}

const LEAVE_SAVE_ERRORS = {
  leave_conflicts_with_lessons: 'יש שיעורים בימים האלה. יש להזיז או לבטל אותם לפני רישום חופשה.',
  leave_conflicts_with_attendance: 'יש רישום שעות בימים האלה. יש להסיר אותו לפני רישום חופשה.',
  leave_conflicts_with_existing_leave: 'כבר רשומה חופשה בחלק מהימים האלה.',
};

export function leaveSaveErrorMessage(error) {
  return LEAVE_SAVE_ERRORS[error?.data?.message] || error?.message || 'שמירת החופשה נכשלה.';
}

function days(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)).toLocaleString('he-IL') : '0';
}

// The leave balance from GET /api/employee-leave (computeLeaveSummary), as one line plus details.
export function leaveBalanceText(summary) {
  if (!summary) return null;
  return {
    line: `יתרת חופשה ${summary.year}: ${days(summary.remaining)} ימים · נוצלו ${days(summary.used)}`,
    details: [
      `מכסה שנתית: ${days(summary.quota)}`,
      `צבירה משנה קודמת: ${days(summary.carryIn)}`,
      `הקצאות: ${days(summary.allocations)}`,
      `התאמות: ${days(summary.adjustments)}`,
      `נוצלו: ${days(summary.used)}`,
    ],
  };
}

// Input is the panel's ordered, complete month; nulls represent adjacent months.
export function buildMonthWeeks(days) {
  if (!days.length) return [];
  const offset = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const cells = [...Array(offset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}
