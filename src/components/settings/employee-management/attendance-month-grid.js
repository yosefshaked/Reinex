// Presentation only: lessons come from the calendar, other work from manual records.
import { toAgorot, toShekel } from '../../../lib/currency.js';
import { formatDateKey } from '../../../lib/date-key-format.js';

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
  { value: 'half_day', label: 'חצי יום' },
];

// The server keeps a part for a half day (first_half / second_half; older rows use either). The
// screen offers one "חצי יום", always saved as the first half.
const HALF_DAY_PART_SAVED = 'first_half';

// A half-day leave (a day portion other than a full day, or the older half_day type): the day is
// shared with work, so hours and lessons may be recorded on it.
export function isHalfDayLeave(leave) {
  if (!leave) return false;
  return (Boolean(leave.day_portion) && leave.day_portion !== 'full_day')
    || leave.entry?.duration_mode === 'half_day'
    || leave.entry?.leave_type === 'half_day'
    || leave.leave_type === 'half_day';
}

export function leaveTypeLabel(value) {
  if (value === 'half_day') return 'חצי יום';
  return LEAVE_TYPE_OPTIONS.find((option) => option.value === value)?.label || 'חופשה';
}

// One leave day of the attendance read (employee_leave_days row with its entry).
export function describeLeaveDay(leave) {
  if (!leave) return null;
  const type = leave.entry?.leave_type || leave.leave_type;
  const parts = ['חופשה', isHalfDayLeave(leave) && type !== 'half_day' ? 'חצי יום' : null, leaveTypeLabel(type)];
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
    portion: half ? 'half_day' : 'full_day',
    endDate: entry?.end_date || entry?.start_date || '',
    reason: entry?.reason || '',
    notes: entry?.notes || '',
  };
}

// Body for POST/PUT /api/employee-leave. A new leave starts on the day picked in the grid; an edited
// one keeps its own start. Half a day is always a single date.
export function buildLeaveRequestBody(form, { orgId, employeeId, startDate }) {
  const half = form.portion !== 'full_day';
  const endDate = half || !form.endDate || form.endDate < startDate ? startDate : form.endDate;
  return {
    id: form.id || undefined,
    org_id: orgId,
    employee_id: employeeId,
    leave_type: form.leaveType,
    duration_mode: half ? 'half_day' : 'full_day',
    half_day_part: half ? HALF_DAY_PART_SAVED : null,
    start_date: startDate,
    end_date: endDate,
    reason: form.reason?.trim() || null,
    notes: form.notes?.trim() || null,
  };
}

const LEAVE_SAVE_ERRORS = {
  leave_conflicts_with_lessons: 'יש שיעורים בימים האלה. אפשר לרשום חצי יום חופשה, או להזיז או לבטל את השיעורים לפני רישום חופשה של יום מלא.',
  leave_conflicts_with_attendance: 'יש רישום שעות בימים האלה. אפשר לרשום חצי יום חופשה, או להסיר את השעות לפני רישום חופשה של יום מלא.',
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

// "שינוי יתרה": two actions, each with a required reason. The older event types (allocation,
// correction, reversal) are no longer offered but stay readable in the history.
export const BALANCE_ACTIONS = [
  { value: 'carryover', label: 'העברה מהשנה הקודמת', hint: 'מספר חיובי' },
  { value: 'adjustment', label: 'הוספה או הורדה', hint: 'מוסיף, או מוריד במספר שלילי' },
];

export const BALANCE_REASON_OPTIONS = [
  { value: 'previous_system', label: 'מעבר מהמערכת הקודמת' },
  { value: 'agreed_with_employee', label: 'סוכם עם העובד/ת' },
  { value: 'mistake_correction', label: 'תיקון טעות' },
  { value: 'other', label: 'אחר' },
];

const BALANCE_EVENT_LABELS = {
  carryover: 'העברה מהשנה הקודמת',
  adjustment: 'הוספה או הורדה',
  allocation: 'הקצאה',
  correction: 'תיקון',
  reversal: 'היפוך',
};

export function balanceEventLabel(value) {
  return BALANCE_EVENT_LABELS[value] || value || 'שינוי';
}

export function emptyBalanceForm() {
  return { eventType: 'carryover', quantityDays: '', year: '', reason: '', notes: '' };
}

// The years a balance change can be made for: last year, this year and next year.
export function balanceYearOptions(today) {
  const current = Number(String(today || '').slice(0, 4));
  return [current - 1, current, current + 1];
}

// The date a balance change takes effect for the chosen year (the balance is grouped by the year of
// this date): a carry-over is from 1 January; an add-or-remove is today in the current year, and
// 1 January in any other year.
export function balanceEventDate(eventType, year, today) {
  const yearStart = `${year}-01-01`;
  if (eventType === 'adjustment' && String(today || '').startsWith(`${year}-`)) return today;
  return yearStart;
}

// Why the number of days is wrong, shown under the field; '' while it is empty or fine.
export function balanceQuantityError(form) {
  if (form?.quantityDays === '' || form?.quantityDays == null) return '';
  const quantity = Number(form.quantityDays);
  if (!Number.isFinite(quantity)) return 'יש להזין מספר ימים.';
  if (form.eventType === 'carryover' && quantity <= 0) {
    return 'העברה מהשנה הקודמת היא רק מספר חיובי. להורדת ימים בחרו "הוספה או הורדה".';
  }
  if (form.eventType === 'adjustment' && quantity === 0) {
    return 'הוספה או הורדה לא יכולה להיות 0. הזינו מספר חיובי להוספה או שלילי להורדה.';
  }
  return '';
}

// What is missing before a balance change can be saved; '' when it can.
export function balanceFormError(form) {
  if (form?.quantityDays === '' || !Number.isFinite(Number(form?.quantityDays))) return 'יש להזין מספר ימים.';
  const quantityError = balanceQuantityError(form);
  if (quantityError) return quantityError;
  if (!BALANCE_REASON_OPTIONS.some((option) => option.value === form.reason)) return 'יש לבחור סיבה.';
  if (form.reason === 'other' && !String(form.notes || '').trim()) return 'כשהסיבה היא "אחר" יש לכתוב אותה.';
  return '';
}

export function buildBalanceEventBody(form, { orgId, employeeId, effectiveDate }) {
  return {
    entity_type: 'balance_event',
    org_id: orgId,
    employee_id: employeeId,
    event_type: form.eventType,
    quantity_days: Number(form.quantityDays),
    effective_date: effectiveDate,
    reason: form.reason,
    notes: String(form.notes || '').trim() || null,
  };
}

// One manual change in the history: date, action, amount, reason (with its text), and a small record
// line: when it was made and by whom.
export function describeBalanceEvent(entry, formatDate = (value) => value) {
  const quantity = Number(entry?.quantity_days);
  const reasonLabel = BALANCE_REASON_OPTIONS.find((option) => option.value === entry?.metadata?.reason)?.label || '';
  let reason = [reasonLabel, entry?.notes].filter(Boolean).join(' - ');
  if (reasonLabel === 'אחר') reason = `אחר: ${entry?.notes || ''}`;
  if (!reasonLabel) reason = entry?.notes || '';
  const created = entry?.created_at ? formatDate(String(entry.created_at).slice(0, 10)) : '';
  const who = [created ? `נרשם ב-${created}` : 'נרשם', entry?.created_by_name ? `ע"י ${entry.created_by_name}` : ''].filter(Boolean).join(' ');
  return {
    title: `${formatDate(entry?.effective_date)} · ${balanceEventLabel(entry?.event_type)} · ${quantity > 0 ? '+' : ''}${quantity}`,
    reason,
    who,
  };
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
  const toNext = Number(entitlement?.days_to_next_leave_day);
  const nextPart = !manualNeeded && Number.isInteger(toNext) && toNext > 0
    ? ` · ${toNext === 1 ? 'עוד יום עבודה אחד' : `עוד ${toNext} ימי עבודה`} ליום החופשה הבא`
    : '';
  return {
    line: `${line}${nextPart}`,
    details: [
      `לפי הזכאות: ${days(summary.quota)}`,
      `צבירה משנה קודמת: ${days(summary.carryIn)}`,
      `הקצאות: ${days(summary.allocations)}`,
      `התאמות: ${days(summary.adjustments)}`,
      `נוצלו: ${days(summary.used)}`,
    ],
  };
}

// The employee's "חופשה" row in the "נוכחות" tab: one "שינוי" opens two steps. Step 1 is how many
// leave days a year (Employees.annual_leave_days, null = the organisation default), step 2 what a
// leave day is paid (Employees.leave_pay_method, null = the organisation default; the fixed value per
// day is a dated leave_day rate set in the same step).
export const ENTITLEMENT_CHOICES = [
  { value: 'default', label: 'לפי ברירת המחדל של הארגון' },
  { value: 'manual', label: 'מספר ימים קבוע לשנה' },
];

export const EMPLOYEE_LEAVE_PAY_CHOICES = [
  { value: '', label: 'לפי ברירת המחדל של הארגון' },
  { value: 'legal', label: 'ממוצע מומלץ' },
  { value: 'avg_hourly_x_avg_day_hours', label: 'ממוצע היסטורי' },
  { value: 'fixed_rate', label: 'ערך קבוע ליום' },
];

/**
 * The fixed value per leave day chosen in the same dialog as the pay method. "ערך קבוע ליום" needs a
 * positive value. Returns { required, error, rate, effectiveDate, needsSave }: `rate` in agorot, and
 * `needsSave` when the dated leave_day rate has to be written (no current value, or a different one).
 * `currentRate` is the leave_day rate row in force today, or null.
 */
export function planLeaveDayValue({ payMethod, dayValue, dayValueDate }, currentRate = null) {
  if (payMethod !== 'fixed_rate') return { required: false, error: '', rate: null, effectiveDate: null, needsSave: false };
  const text = String(dayValue ?? '').trim();
  const amount = Number(text);
  const rate = toAgorot(amount);
  if (text === '' || !Number.isFinite(amount) || rate <= 0) {
    return { required: true, error: 'יש להזין ערך ליום חופשה גדול מאפס.', rate: null, effectiveDate: null, needsSave: false };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayValueDate || ''))) {
    return { required: true, error: 'יש לבחור מאיזה תאריך הערך בתוקף.', rate: null, effectiveDate: null, needsSave: false };
  }
  return {
    required: true,
    error: '',
    rate,
    effectiveDate: dayValueDate,
    needsSave: !currentRate || Number(currentRate.rate) !== rate,
  };
}

/**
 * The employee's fixed leave-day values from the RateHistory rows (dated `leave_day` rows without a
 * service), newest first, for the history under the leave row. `current` is the row in force on `today`,
 * `next` the earliest one that has not started yet (or null), `note` the short "ישתנה ב-<date>: ₪X".
 */
export function leaveDayRateTimeline(rates, today) {
  const rows = (Array.isArray(rates) ? rates : [])
    .filter((row) => row?.pay_basis === 'leave_day' && !row.service_id && row.effective_date)
    .sort((left, right) => String(right.effective_date).localeCompare(String(left.effective_date)));
  const current = rows.find((row) => row.effective_date <= today) || null;
  const next = rows.filter((row) => row.effective_date > today).pop() || null;
  const entries = rows.map((row) => ({
    id: row.id || row.effective_date,
    date: row.effective_date,
    rate: row.rate,
    isFuture: row.effective_date > today,
    isCurrent: row === current,
  }));
  const note = next ? `ישתנה ב-${formatDateKey(next.effective_date)}: ${formatShekelAmount(next.rate)}` : '';
  return { entries, current, next, note };
}

function formatShekelAmount(agorot) {
  const value = toShekel(agorot);
  return `₪${value.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Body of PUT /api/instructors for the days choice alone; refuses a bad manual number (null). */
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

/**
 * The PUT /api/instructors body for the two steps, with only the fields that change:
 * { body, changed }, or null when the manual number is not valid. `current` is what is stored
 * ({ annual_leave_days, leave_pay_method }).
 */
export function buildEmployeeLeaveBody({ daysChoice, manualDays, payMethod }, { orgId, employeeId }, current = {}) {
  const daysBody = buildEntitlementChoiceBody({ choice: daysChoice, manualDays }, { orgId, employeeId });
  if (!daysBody) return null;
  const body = { org_id: orgId, instructor_id: employeeId };
  const storedDays = current?.annual_leave_days == null ? null : Number(current.annual_leave_days);
  if (daysBody.annual_leave_days !== storedDays) body.annual_leave_days = daysBody.annual_leave_days;
  const nextMethod = payMethod || null;
  if (nextMethod !== (current?.leave_pay_method || null)) body.leave_pay_method = nextMethod;
  return { body, changed: Object.keys(body).length > 2 };
}

function payPolicyMonths(orgPolicy) {
  const months = Number(orgPolicy?.lookback_months);
  return Number.isFinite(months) && months > 0 ? Math.round(months) : 3;
}

// The organisation's default method as the screen names it.
function orgPayMethod(orgPolicy) {
  return String(orgPolicy?.default_method || 'legal');
}

function payMethodLabel(method) {
  return EMPLOYEE_LEAVE_PAY_CHOICES.find((option) => option.value === method)?.label || 'ממוצע מומלץ';
}

/** What a leave day is worth under a step-2 choice, in words, with the organisation's months. */
export function describeEmployeeLeavePayChoice(method, orgPolicy) {
  const months = payPolicyMonths(orgPolicy);
  const period = months === 1 ? 'בחודש האחרון' : `ב-${months} החודשים האחרונים`;
  if (method === 'legal') return 'השכר של 3 החודשים האחרונים (או 3 החודשים המלאים ביותר בשנה האחרונה), לפי ימים קלנדריים.';
  if (method === 'avg_hourly_x_avg_day_hours') return `השכר היומי הממוצע בימים שעבד/ה ${period} בלבד.`;
  if (method === 'fixed_rate') return 'סכום קבוע ליום חופשה, מהתאריך שנקבע לו.';
  return `כמו שאר העובדים בארגון. כרגע: "${payMethodLabel(orgPayMethod(orgPolicy))}".`;
}

/** The read-first line of the row: "ימים: 9 בשנה · תשלום: ממוצע היסטורי". */
export function employeeLeaveSummaryText(current = {}, orgPolicy = null) {
  const storedDays = current?.annual_leave_days;
  const daysText = storedDays == null ? 'לפי ברירת המחדל' : `${days(storedDays)} בשנה`;
  const method = current?.leave_pay_method || '';
  const payText = method
    ? payMethodLabel(method)
    : `לפי ברירת המחדל (${payMethodLabel(orgPayMethod(orgPolicy))})`;
  return `ימים: ${daysText} · תשלום: ${payText}`;
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
        sentences.push(`${yearWord} נרשמו${soFar} ${counted} ימי עבודה. מ-200 ימי עבודה מגיעה השנה המלאה, ולכן מגיעים ${days(entitlement.days)} ימי חופשה.`);
      } else {
        sentences.push(`${yearWord} נרשמו${soFar} ${counted} ימי עבודה. שנה מלאה היא 200 ימי עבודה, ולכן מגיעים${entitlement.in_progress ? ' כרגע' : ''} ${days(entitlement.days)} ימי חופשה.`);
      }
    } else {
      sentences.push(`${who} התחיל/ה לעבוד ב-${displayDate(entitlement.start_date)}, באמצע השנה. במצב כזה מגיעה השנה המלאה מ-240 ימי עבודה.`);
      sentences.push(`נרשמו${soFar} ${counted} ימי עבודה, ולכן מגיעים${entitlement.in_progress && !entitlement.reached_full ? ' כרגע' : ''} ${days(entitlement.days)} ימי חופשה.`);
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
    sentences.push(`איך חישבנו במקרים שאינם חד-משמעיים: יום עם שיעור או עם שעות עבודה כלשהן נחשב יום עבודה שלם, וגם יום חופשה בתשלום (גם חצי יום) נחשב יום עבודה; ימי החופשה מחושבים עד שתי ספרות אחרי הנקודה; ${table}.`);
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
