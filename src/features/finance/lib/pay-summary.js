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

/** 1 → "1 לא סומן", 2 → "2 לא סומנו": lessons nobody marked, paid as attended. */
export function formatUnmarkedCount(count) {
  const number = Math.max(0, Number(count) || 0);
  return number === 1 ? '1 לא סומן' : `${number} לא סומנו`;
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

/** 1 → "1 רוכב", 14 → "14 רוכבים". */
function formatRiderCount(count) {
  const number = Math.max(0, Number(count) || 0);
  return number === 1 ? '1 רוכב' : `${number} רוכבים`;
}

const PER_RIDER_MODEL = 'per_student';
const PAY_BASIS_FLAT = 'lesson_flat';
const PAY_BASIS_HOURLY = 'lesson_hourly';

/**
 * The calculation of one group of lessons that share a service, pay basis, payment model and rate,
 * mirroring resolveLessonInstructorPayout: the rate is paid per lesson (flat) or per lesson hour
 * (hourly), and a per-rider service multiplies that by the paid riders of each lesson. So the
 * quantity is lessons (flat), hours (hourly), riders (flat per rider) or rider-hours (hourly per
 * rider). The "× rate" part is shown only when quantity × rate equals the sum the server paid for
 * the group; otherwise the label is the quantity alone, so a line never shows a sum that does not add up.
 */
function describeLessonGroupCalculation(group) {
  const { payBasis, perRider, rate, lessons, amount } = group;
  const knownRate = Number.isFinite(rate) && rate !== null;
  if (payBasis === PAY_BASIS_HOURLY) {
    const minutes = lessons.reduce((sum, line) => sum + line.minutes * (perRider ? line.riders : 1), 0);
    const quantityLabel = `${formatMinutes(minutes)} ${perRider ? 'שעות רוכב' : 'שעות'}`;
    const adds = knownRate && Math.round((rate * minutes) / 60) === amount;
    return adds ? `${quantityLabel} × ${formatCurrency(rate)} לשעה` : quantityLabel;
  }
  if (perRider && payBasis === PAY_BASIS_FLAT) {
    const riders = lessons.reduce((sum, line) => sum + line.riders, 0);
    const quantityLabel = formatRiderCount(riders);
    return knownRate && riders * rate === amount ? `${quantityLabel} × ${formatCurrency(rate)}` : quantityLabel;
  }
  const quantityLabel = formatLessonCount(lessons.length);
  const adds = payBasis === PAY_BASIS_FLAT && knownRate && lessons.length * rate === amount;
  return adds ? `${lessons.length} ${lessons.length === 1 ? 'מפגש' : 'מפגשים'} × ${formatCurrency(rate)}` : quantityLabel;
}

/**
 * The paid lessons grouped by service, pay basis, payment model and rate, one group per
 * combination: a service whose rate changed mid-month has two groups, the older rate first. Groups
 * keep the order in which their service first appears. A lesson with no rate pays nothing and is
 * listed under "חסר תעריף" instead. Every group's amount is the sum of the server's payouts.
 */
export function groupLessonsByService(lessons = []) {
  const groups = new Map();
  const serviceOrder = new Map();
  for (const lesson of lessons || []) {
    if (lesson?.missing_rate) continue;
    const serviceKey = lesson?.service_id || 'none';
    if (!serviceOrder.has(serviceKey)) serviceOrder.set(serviceKey, serviceOrder.size);
    const payBasis = lesson?.pay_basis || '';
    const perRider = lesson?.service_payment_model === PER_RIDER_MODEL;
    const rate = lesson?.rate_used === null || lesson?.rate_used === undefined ? null : Number(lesson.rate_used);
    const key = [serviceKey, payBasis, perRider ? 'rider' : 'lesson', rate ?? 'none'].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        serviceId: lesson?.service_id || '',
        name: lesson?.service_name || 'שירות ללא שם',
        payBasis,
        perRider,
        rate,
        order: serviceOrder.get(serviceKey),
        since: lesson?.rate_effective_date || lesson?.lesson_date || '',
        count: 0,
        amount: 0,
        lessons: [],
      });
    }
    const group = groups.get(key);
    const line = { ...buildLessonLine(lesson), riders: Number(lesson?.paid_participant_count) || 0 };
    const since = lesson?.rate_effective_date || lesson?.lesson_date || '';
    if (since && (!group.since || since < group.since)) group.since = since;
    group.count += 1;
    group.amount += line.amount;
    group.lessons.push(line);
  }
  return Array.from(groups.values())
    .sort((left, right) => left.order - right.order || String(left.since).localeCompare(String(right.since)))
    .map((group) => {
      const unmarkedCount = group.lessons.filter((line) => line.unmarked).length;
      return {
        ...group,
        countLabel: describeLessonGroupCalculation(group),
        unmarkedCount,
        unmarkedLabel: unmarkedCount > 0 ? formatUnmarkedCount(unmarkedCount) : '',
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
export function buildLeaveLines(leave = [], { withAmount = true } = {}) {
  return (leave || [])
    .filter((row) => Number(row?.pay_fraction) > 0)
    .map((row) => ({
      key: row.leave_date,
      dateLabel: formatDayMonth(row.leave_date),
      portionLabel: Number(row.pay_fraction) < 1 ? 'חצי יום' : 'יום מלא',
      amount: withAmount ? toAmount(row.amount) : null,
    }));
}

/** "2026-07", "2026-09" → "07–09.2026"; across a year end "11.2025–01.2026". */
export function formatMonthRange(startMonth, endMonth) {
  const start = /^(\d{4})-(\d{2})$/.exec(String(startMonth || ''));
  const end = /^(\d{4})-(\d{2})$/.exec(String(endMonth || ''));
  if (!start || !end) return '';
  if (start[1] === end[1]) return `${start[2]}–${end[2]}.${end[1]}`;
  return `${start[2]}.${start[1]}–${end[2]}.${end[1]}`;
}

/**
 * How a "ממוצע מומלץ" leave day was valued, one line per distinct calculation (usually one):
 * "לפי 07–09.2026: ₪27,000.00 ÷ 90 × 7/5 = ₪420.00 ליום". The server chose the months and computed
 * the value (api/_shared/employee-finance.js); this only words it.
 */
export function buildLeaveBasisLines(leave = []) {
  const lines = new Map();
  for (const row of leave || []) {
    const basis = row?.basis;
    if (!basis || !(Number(row?.pay_fraction) > 0)) continue;
    const key = `${basis.start_month}|${basis.end_month}|${basis.wage_base}|${basis.divisor}|${basis.week_days}|${row.day_value}`;
    if (lines.has(key)) continue;
    const monthsLabel = formatMonthRange(basis.start_month, basis.end_month);
    // The months and the formula are shown left to right inside the Hebrew line (see EmployeePaySummary).
    const formula = `${formatCurrency(toAmount(basis.wage_base))} ÷ ${basis.divisor} × 7/${basis.week_days} = ${formatCurrency(toAmount(row.day_value))}`;
    lines.set(key, { key, monthsLabel, formula, text: `לפי ${monthsLabel}: ${formula} ליום` });
  }
  return Array.from(lines.values());
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
 * the missing-rate exception when it is not zero. Unmarked lessons are not a separate section: the
 * lessons row, its service lines and the lesson lines carry them. With details, each row carries
 * what it opens to.
 */
export function buildSummaryRows(pay) {
  if (!pay) return { total: 0, rows: [], exceptions: [] };
  const details = pay.details || null;
  const lessons = details?.lessons || [];
  const missingRateCount = Number(pay.missing_rate_lesson_count) || 0;
  const paidLessonCount = Math.max(0, (Number(pay.lesson_count) || 0) - missingRateCount);
  const rows = [];
  // A lesson nobody marked is paid as attended, so it stays in "מפגשים" (once) with a marker; the
  // row and its service lines carry the count. Without details the server's count is used.
  const unmarkedCount = details
    ? lessons.filter((lesson) => lesson?.unmarked && !lesson?.missing_rate).length
    : Number(pay.unmarked_lesson_count) || 0;

  if (paidLessonCount > 0 || toAmount(pay.lesson_amount) !== 0) {
    rows.push({
      key: 'lessons',
      label: `מפגשים · ${paidLessonCount}`,
      amount: toAmount(pay.lesson_amount),
      unmarkedCount,
      unmarkedLabel: unmarkedCount > 0 ? formatUnmarkedCount(unmarkedCount) : '',
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
  // Paid leave is its own line, apart from the lessons and the hours: "חופשה: 1.5 ימים × ₪300.00" and
  // its total. A monthly salary already covers its leave days, so they are listed with no amount.
  const breakdown = pay.leave_breakdown || {};
  const detailDays = (details?.leave || []).reduce((sum, row) => sum + (Number(row?.pay_fraction) || 0), 0);
  const leaveDays = Number(breakdown.paid_days) > 0 ? Number(breakdown.paid_days) : detailDays;
  const leaveAmount = toAmount(pay.paid_leave_amount);
  if (leaveDays > 0 || leaveAmount !== 0) {
    const includedInSalary = leaveAmount === 0 && toAmount(pay.monthly_salary_amount) !== 0;
    const dayValue = Number(breakdown.day_value) > 0 ? toAmount(breakdown.day_value) : 0;
    const times = !includedInSalary && dayValue > 0 ? ` × ${formatCurrency(dayValue)}` : '';
    rows.push({
      key: 'leave',
      label: leaveDays > 0 ? `חופשה: ${formatDays(leaveDays)}${times}` : 'חופשה',
      amount: includedInSalary ? null : leaveAmount,
      note: includedInSalary ? 'כלול במשכורת' : '',
      leaveLines: details ? buildLeaveLines(details.leave, { withAmount: !includedInSalary }) : null,
      basisLines: details && !includedInSalary ? buildLeaveBasisLines(details.leave) : [],
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

  // Lessons with no rate are not in "מפגשים" and are not paid, so they get their own section.
  const exceptions = [];
  if (missingRateCount > 0) {
    exceptions.push({
      key: 'missing_rate',
      label: `חסר תעריף · ${formatLessonCount(missingRateCount)}`,
      amount: null,
      amountLabel: '₪0',
      tone: 'danger',
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
    if (unmarked > 0) tags.push({ key: 'unmarked', label: `לא סומן: ${unmarked}`, tone: 'warning' });
    if (missingRate > 0) tags.push({ key: 'missing_rate', label: `חסר תעריף: ${missingRate}`, tone: 'danger' });
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
