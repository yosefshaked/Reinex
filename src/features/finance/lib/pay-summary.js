/**
 * The monthly pay summary as rows to show. Pure: it only arranges what `GET /api/payroll` returned
 * (computed by api/_shared/pay-calculation.js). It never computes pay; every amount on a row is an
 * amount the server returned, or a sum of such amounts for a group of lessons or office days.
 */
import { formatCurrency } from '../../../lib/currency.js';
import { dateKeyFromCalendarDate } from '../../../lib/local-time.js';

const PARTICIPANT_STATE_LABELS = {
  attended: 'הגיע',
  unmarked: 'לא סומן',
  no_show: 'לא הגיע',
  cancelled_student: 'ביטול לקוח',
  cancelled_clinic: 'ביטול ארגון',
  scheduled: 'מתוכנן',
};

const CORRECTION_KIND_LABELS = {
  bonus: 'בונוס',
  deduction: 'ניכוי',
  adjustment: 'התאמה',
  correction: 'תיקון',
};

const toAmount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

/** 90 → "1:30". */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "2026-10-05" → "05.10". */
export function formatDayMonth(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateKey || ''));
  return match ? `${match[3]}.${match[2]}` : '';
}

/** 1 → "1 מפגש", 3 → "3 מפגשים". */
export function formatLessonCount(count) {
  const number = Math.max(0, Number(count) || 0);
  return number === 1 ? '1 מפגש' : `${number} מפגשים`;
}

/** Leave days in words: 0.5 → "חצי יום", 1 → "יום אחד", 2.5 → "2.5 ימים". */
export function formatDays(days) {
  const number = Math.round((Number(days) || 0) * 10) / 10;
  if (number === 0.5) return 'חצי יום';
  if (number === 1) return 'יום אחד';
  return `${number} ימים`;
}

/** An amount with its sign shown, for corrections: "+₪50.00" / "-₪50.00". */
export function formatSignedCurrency(amount) {
  const value = toAmount(amount);
  if (value === 0) return formatCurrency(0);
  return `${value > 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`;
}

export function describeCorrectionKind(type) {
  return CORRECTION_KIND_LABELS[type] || 'תיקון';
}

/**
 * What happened in a lesson, in words: "הגיע" for a lesson where everyone attended, "לא סומן" where
 * nobody was marked, otherwise each state with its count ("1 הגיע, 1 לא הגיע").
 */
export function describeLessonState(states) {
  const entries = Object.entries(states || {}).filter(([, count]) => Number(count) > 0);
  if (entries.length === 0) return '';
  if (entries.length === 1 && Number(entries[0][1]) === 1) {
    return PARTICIPANT_STATE_LABELS[entries[0][0]] || entries[0][0];
  }
  if (entries.length === 1) {
    const [state, count] = entries[0];
    return `${count} ${PARTICIPANT_STATE_LABELS[state] || state}`;
  }
  return entries
    .map(([state, count]) => `${count} ${PARTICIPANT_STATE_LABELS[state] || state}`)
    .join(', ');
}

/** One lesson as a detail line. */
export function buildLessonLine(lesson) {
  return {
    id: lesson?.lesson_instance_id || '',
    date: lesson?.lesson_date || '',
    dateLabel: formatDayMonth(lesson?.lesson_date),
    time: lesson?.start_time || '',
    minutes: Number(lesson?.duration_minutes) || 0,
    stateLabel: describeLessonState(lesson?.participant_states),
    amount: toAmount(lesson?.payout_amount),
    unmarked: Boolean(lesson?.unmarked),
    unmarkedAmount: toAmount(lesson?.unmarked_amount),
    missingRate: Boolean(lesson?.missing_rate),
    serviceId: lesson?.service_id || '',
    serviceName: lesson?.service_name || '',
    employeeId: lesson?.employee_id || '',
  };
}

/**
 * The paid lessons grouped by service, in the order they first appear. A lesson with no rate pays
 * nothing and is listed under "חסר תעריף" instead. "count × amount" is shown only when every lesson
 * of the service paid the same, so it is exact; otherwise (different rates, lengths or rider
 * counts) the group shows its count and total only.
 */
export function groupLessonsByService(lessons = []) {
  const groups = new Map();
  for (const lesson of lessons || []) {
    if (lesson?.missing_rate) continue;
    const key = lesson?.service_id || 'none';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        serviceId: lesson?.service_id || '',
        name: lesson?.service_name || 'שירות ללא שם',
        count: 0,
        amount: 0,
        lessons: [],
      });
    }
    const group = groups.get(key);
    const line = buildLessonLine(lesson);
    group.count += 1;
    group.amount += line.amount;
    group.lessons.push(line);
  }
  return Array.from(groups.values()).map((group) => {
    const unitAmounts = new Set(group.lessons.map((line) => line.amount));
    const unitAmount = unitAmounts.size === 1 ? group.lessons[0].amount : null;
    return {
      ...group,
      unitAmount,
      countLabel: unitAmount !== null
        ? `${group.count} × ${formatCurrency(unitAmount)}`
        : formatLessonCount(group.count),
    };
  });
}

/**
 * Office days grouped by the hourly rate that paid them, one group per run of days at the same
 * rate (a new rate starts a new period). Days with no hourly rate pay nothing and say so.
 */
export function groupAttendanceByRate(rows = []) {
  const sorted = [...(rows || [])]
    .filter((row) => Number(row?.other_minutes) > 0)
    .sort((left, right) => String(left?.attendance_date).localeCompare(String(right?.attendance_date)));
  const periods = [];
  for (const row of sorted) {
    const rate = row?.rate_used ?? null;
    const last = periods[periods.length - 1];
    if (!last || last.rate !== rate) {
      periods.push({ rate, from: row.attendance_date, to: row.attendance_date, minutes: 0, amount: 0, days: 0 });
    }
    const period = periods[periods.length - 1];
    period.to = row.attendance_date;
    period.minutes += Number(row.other_minutes) || 0;
    period.amount += toAmount(row.amount);
    period.days += 1;
  }
  return periods.map((period, index) => ({
    ...period,
    key: `${period.from}-${index}`,
    label: period.rate
      ? `${formatMinutes(period.minutes)} × ${formatCurrency(period.rate)} לשעה`
      : `${formatMinutes(period.minutes)} · אין תעריף שעתי`,
    rangeLabel: period.from === period.to
      ? formatDayMonth(period.from)
      : `${formatDayMonth(period.from)}–${formatDayMonth(period.to)}`,
  }));
}

/** The paid leave days, each with its value. */
export function buildLeaveLines(leave = []) {
  return (leave || [])
    .filter((row) => Number(row?.pay_fraction) > 0)
    .map((row) => ({
      key: row.leave_date,
      dateLabel: formatDayMonth(row.leave_date),
      portionLabel: Number(row.pay_fraction) < 1 ? 'חצי יום' : 'יום מלא',
      amount: toAmount(row.amount),
    }));
}

/** Each hand-entered correction: date, kind, note and its signed amount. */
export function buildCorrectionLines(corrections = []) {
  return [...(corrections || [])]
    .sort((left, right) => String(left?.effective_date).localeCompare(String(right?.effective_date)))
    .map((row) => ({
      key: row.id || `${row.effective_date}-${row.amount}`,
      dateLabel: formatDayMonth(row.effective_date),
      kindLabel: describeCorrectionKind(row.correction_type),
      note: row.notes || '',
      amount: toAmount(row.amount),
      amountLabel: formatSignedCurrency(row.amount),
    }));
}

/**
 * The overview of one employee's month: the total, one row per pay part that has something, and
 * the two exception rows when they are not zero. With details, each row carries what it opens to.
 */
export function buildSummaryRows(pay) {
  if (!pay) return { total: 0, rows: [], exceptions: [] };
  const details = pay.details || null;
  const lessons = details?.lessons || [];
  const missingRateCount = Number(pay.missing_rate_lesson_count) || 0;
  const paidLessonCount = Math.max(0, (Number(pay.lesson_count) || 0) - missingRateCount);
  const rows = [];

  if (paidLessonCount > 0 || toAmount(pay.lesson_amount) !== 0) {
    rows.push({
      key: 'lessons',
      label: `מפגשים · ${paidLessonCount}`,
      amount: toAmount(pay.lesson_amount),
      groups: details ? groupLessonsByService(lessons) : null,
    });
  }
  if (Number(pay.attendance_minutes) > 0 || toAmount(pay.attendance_amount) !== 0) {
    rows.push({
      key: 'attendance',
      label: `שעות עבודה · ${formatMinutes(pay.attendance_minutes)}`,
      amount: toAmount(pay.attendance_amount),
      periods: details ? groupAttendanceByRate(details.attendance) : null,
    });
  }
  if (toAmount(pay.monthly_salary_amount) !== 0) {
    rows.push({ key: 'salary', label: 'שכר חודשי', amount: toAmount(pay.monthly_salary_amount) });
  }
  if (toAmount(pay.paid_leave_amount) !== 0) {
    const leaveLines = details ? buildLeaveLines(details.leave) : null;
    const paidDays = (details?.leave || []).reduce((sum, row) => sum + (Number(row?.pay_fraction) || 0), 0);
    rows.push({
      key: 'leave',
      label: details ? `חופשה בתשלום · ${formatDays(paidDays)}` : 'חופשה בתשלום',
      amount: toAmount(pay.paid_leave_amount),
      leaveLines,
    });
  }
  const corrections = pay.corrections || [];
  if (corrections.length > 0 || toAmount(pay.correction_amount) !== 0) {
    rows.push({
      key: 'corrections',
      label: `תיקונים · ${corrections.length}`,
      amount: toAmount(pay.correction_amount),
      correctionLines: buildCorrectionLines(corrections),
    });
  }

  const exceptions = [];
  const unmarkedCount = Number(pay.unmarked_lesson_count) || 0;
  if (unmarkedCount > 0) {
    exceptions.push({
      key: 'unmarked',
      label: `לא סומן אם הגיעו · ${formatLessonCount(unmarkedCount)}`,
      amount: toAmount(pay.unmarked_lesson_amount),
      note: 'נכלל בסכום',
      lessons: details ? lessons.filter((lesson) => lesson?.unmarked).map(buildLessonLine) : null,
    });
  }
  if (missingRateCount > 0) {
    exceptions.push({
      key: 'missing_rate',
      label: `חסר תעריף · ${formatLessonCount(missingRateCount)}`,
      amount: null,
      note: 'לא נכלל בסכום',
      lessons: details ? lessons.filter((lesson) => lesson?.missing_rate).map(buildLessonLine) : null,
    });
  }

  return { total: toAmount(pay.total_amount), rows, exceptions };
}

/** The all-employees table: one row per employee, with exception tags only when present. */
export function buildPayrollTableRows(employees = []) {
  return (employees || []).map((employee) => {
    const tags = [];
    const unmarked = Number(employee?.unmarked_lesson_count) || 0;
    const missingRate = Number(employee?.missing_rate_lesson_count) || 0;
    if (unmarked > 0) tags.push({ key: 'unmarked', label: `לא סומן: ${unmarked}` });
    if (missingRate > 0) tags.push({ key: 'missing_rate', label: `חסר תעריף: ${missingRate}` });
    return {
      id: employee?.employee_id || '',
      name: employee?.employee_name || '',
      total: toAmount(employee?.total_amount),
      tags,
    };
  });
}

/** The router path of the calendar on the lesson's day, with the lesson opened when it is found there. */
export function buildLessonCalendarPath(line) {
  const params = new URLSearchParams();
  if (line?.date) params.set('date', line.date);
  if (line?.id) params.set('lesson', line.id);
  return `/calendar?${params.toString()}`;
}

/** The first and last day of the month a date is in, as "YYYY-MM-DD". */
export function monthBounds(monthDate) {
  return {
    start: dateKeyFromCalendarDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)),
    end: dateKeyFromCalendarDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)),
  };
}

/** "נובמבר 2026". */
export function formatMonthLabel(date) {
  return new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(date);
}
