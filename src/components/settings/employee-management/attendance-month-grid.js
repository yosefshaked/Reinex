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

// Why the system asks for a manual number instead of computing one (entitlement.reason).
const ENTITLEMENT_MANUAL_REASONS = {
  before_75_days: 'עדיין לא עברו 75 ימי העסקה. אפשר לקבוע ימי חופשה ידנית.',
  no_start_date: 'לא הוזן תאריך תחילת עבודה. אפשר להזין אותו בעריכת העובד/ת, או לקבוע ימי חופשה ידנית.',
};

export function entitlementManualReason(entitlement) {
  if (entitlement?.status !== 'manual_needed') return '';
  return ENTITLEMENT_MANUAL_REASONS[entitlement.reason] || 'אי אפשר לחשב את ימי החופשה לבד. אפשר לקבוע אותם ידנית.';
}

// The leave balance from GET /api/employee-leave (computeLeaveSummary + computeLeaveEntitlement), as
// one line plus the figures shown on hover. `currentYear` decides between "השנה" and the year.
export function leaveBalanceText(summary, entitlement = null, currentYear = null) {
  if (!summary) return null;
  const when = currentYear != null && Number(currentYear) === Number(summary.year) ? 'השנה' : `ב-${summary.year}`;
  const manualNeeded = entitlement?.status === 'manual_needed';
  const line = manualNeeded
    ? `ימי החופשה ${when} עדיין לא נקבעו · נוצלו ${days(summary.used)} · נשארו ${days(summary.remaining)}`
    : `מגיעים ${days(summary.available ?? (Number(summary.remaining) + Number(summary.used)))} ימי חופשה ${when} · נוצלו ${days(summary.used)} · נשארו ${days(summary.remaining)}`;
  return {
    line,
    details: [
      `לפי הזכאות: ${days(summary.quota)}`,
      `צבירה משנה קודמת: ${days(summary.carryIn)}`,
      `הקצאות: ${days(summary.allocations)}`,
      `התאמות: ${days(summary.adjustments)}`,
      `נוצלו: ${days(summary.used)}`,
    ],
  };
}

// The entitlement source as the "שינוי" choice shows it.
export const ENTITLEMENT_CHOICES = [
  { value: 'default', label: 'לפי ברירת המחדל של הארגון' },
  { value: 'manual', label: 'מספר ימים קבוע לשנה' },
];

/** Body of PUT /api/instructors for the per-employee choice; refuses a bad manual number (null). */
export function buildEntitlementChoiceBody({ choice, manualDays }, { orgId, employeeId }) {
  if (choice === 'default') {
    return { org_id: orgId, instructor_id: employeeId, annual_leave_days: null };
  }
  const value = Number(String(manualDays ?? '').trim());
  if (String(manualDays ?? '').trim() === '' || !Number.isFinite(value) || value < 0 || value > 365 || !Number.isInteger(value * 2)) {
    return null;
  }
  return { org_id: orgId, instructor_id: employeeId, annual_leave_days: value };
}

const ORDINALS = ['הראשונה', 'השנייה', 'השלישית', 'הרביעית', 'החמישית', 'השישית', 'השביעית', 'השמינית', 'התשיעית', 'העשירית'];

function seniorityWords(year) {
  return ORDINALS[year - 1] || `ה-${year}`;
}

function displayDate(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : '';
}

/**
 * "הסבר מלא": the entitlement in plain sentences built from the real figures (no formulas).
 * `name` is the employee's display name.
 */
export function leaveEntitlementExplanation(entitlement, { name = 'העובד/ת' } = {}) {
  if (!entitlement) return [];
  const sentences = [];
  const who = name || 'העובד/ת';
  const startedThisYear = entitlement.start_date && entitlement.start_date > `${entitlement.year}-01-01`;

  if (entitlement.status === 'not_employed') {
    sentences.push(`${who} התחיל/ה לעבוד רק ב-${displayDate(entitlement.start_date)}, ולכן אין ימי חופשה לשנה הזו.`);
  } else if (entitlement.status === 'manual_needed') {
    sentences.push(entitlementManualReason(entitlement));
  } else if (entitlement.source === 'manual') {
    sentences.push(`נקבע ידנית לעובד/ת: ${days(entitlement.full_year_days)} ימי חופשה בשנה.`);
  } else if (entitlement.source === 'fixed') {
    sentences.push(`לפי ההגדרה של הארגון: ${days(entitlement.full_year_days)} ימים בשנת הוותק ה-${entitlement.seniority_year}.`);
  } else {
    sentences.push(`${who} בשנת העבודה ${seniorityWords(entitlement.seniority_year)}. בשנה מלאה מגיעים ${days(entitlement.full_year_days)} ימי חופשה.`);
    const counted = Number(entitlement.days_worked || 0) + Number(entitlement.paid_sick_days || 0);
    const soFar = entitlement.in_progress ? ' עד עכשיו' : '';
    const yearWord = entitlement.in_progress ? 'השנה' : 'בשנה הזו';
    if (entitlement.employed_whole_year) {
      if (entitlement.reached_full) {
        sentences.push(`${yearWord} נרשמו${soFar} ${counted} ימי עבודה. מ-200 ימי עבודה מגיעה השנה המלאה, ולכן מגיעים ${days(entitlement.days)} ימים.`);
      } else {
        sentences.push(`${yearWord} נרשמו${soFar} ${counted} ימי עבודה. שנה מלאה היא 200 ימי עבודה, ולכן מגיעים${entitlement.in_progress ? ' כרגע' : ''} ${days(entitlement.days)} ימים.`);
      }
    } else {
      sentences.push(`${who} התחיל/ה לעבוד ב-${displayDate(entitlement.start_date)}, באמצע השנה. במצב כזה מגיעה השנה המלאה מ-240 ימי עבודה.`);
      sentences.push(`נרשמו${soFar} ${counted} ימי עבודה, ולכן מגיעים${entitlement.in_progress && !entitlement.reached_full ? ' כרגע' : ''} ${days(entitlement.days)} ימים.`);
    }
    if (entitlement.in_progress && !entitlement.reached_full) {
      sentences.push('המספר יגדל ככל שיירשמו עוד ימי עבודה.');
    }
  }

  if (entitlement.prorated && entitlement.status === 'ok' && entitlement.source !== 'legal' && startedThisYear) {
    sentences.push(`${who} התחיל/ה לעבוד ב-${displayDate(entitlement.start_date)}, ולכן מגיע חלק יחסי מהשנה: ${days(entitlement.days)} ימים.`);
  }

  sentences.push('אפשר להוסיף או להוריד ימים לעובד/ת בכל רגע דרך "שינוי יתרה" כאן למעלה.');

  if (entitlement.source === 'legal' && entitlement.status === 'ok') {
    const table = entitlement.work_week_days === 6
      ? 'לפי טבלת שבוע עבודה של 6 ימים, כי הוגדרו לעובד/ת 6 ימי עבודה'
      : 'לפי טבלת שבוע עבודה של 5 ימים, כי לא הוגדרו לעובד/ת 6 ימי עבודה';
    sentences.push(`איך חישבנו במקומות שהחוק לא חד: יום עם שיעור או עם שעות עבודה כלשהן נחשב יום עבודה שלם; חלקי ימים מעוגלים כלפי מטה; ${table}.`);
  }
  return sentences;
}

// Input is the panel's ordered, complete month; nulls represent adjacent months.
export function buildMonthWeeks(days) {
  if (!days.length) return [];
  const offset = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const cells = [...Array(offset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}
