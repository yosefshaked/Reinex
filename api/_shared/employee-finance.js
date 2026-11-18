// @ts-check
/* eslint-env node */
import { isAdminOrOffice, normalizeString, withOrgScope } from './org-bff.js';
import { coerceAgorot } from './currency.js';
import { shouldParticipantTriggerInstructorCompensation } from './calendar-workflow-decisions.js';
import {
  addMonths,
  dateKeyFromParts,
  diffDays,
  enumerateDateKeys,
  firstDayOfMonth,
  isDateKey,
  lastDayOfMonth,
  localDateKey,
  localDateRangeUtc,
  monthKeyOfDateKey,
  normalizeDateKey,
  parseDateKey,
  todayKey,
  weekdayOfDateKey,
} from './local-time.js';
import {
  LESSON_PAY_BASES,
  PAY_BASIS,
  hasRateKind,
  loadRateHistoryRows,
  resolveLessonRateOnDate,
  resolveRateOnDate,
} from './rate-history.js';
import { isDatedSettingKey, loadDatedSettingRows, resolveSettingOnDate } from './dated-settings.js';
import { LEAVE_ENTITLEMENT_POLICY_KEY, normalizeLeaveEntitlementPolicy, workWeekDays } from './leave-entitlement.js';

export const DEFAULT_LEAVE_POLICY = Object.freeze({
  holiday_rules: [],
});

export const DEFAULT_LEAVE_PAY_POLICY = Object.freeze({
  default_method: 'legal',
  lookback_months: 3,
  fixed_rate_default: 0,
});

export const DEFAULT_BILLING_CONSUMPTION_POLICY = Object.freeze({
  attended: true,
  no_show: false,
  cancelled_student: false,
  cancelled_clinic: false,
});

export const DEFAULT_INSTRUCTOR_EARNINGS_POLICY = Object.freeze({
  attended: true,
  no_show: true,
  cancelled_student: false,
  cancelled_clinic: false,
});

export const HMO_NON_ATTENDANCE_BILLING_POLICIES = new Set([
  'hmo_coverage',
  'student_private_rate',
]);

export const DEFAULT_HMO_NON_ATTENDANCE_BILLING_POLICY = 'student_private_rate';

export const ATTENDANCE_STATUSES = new Set(['present', 'partial', 'absent', 'remote']);
export const LEAVE_TYPES = new Set(['employee_paid', 'system_paid', 'unpaid', 'half_day']);
export const LEAVE_ENTRY_STATUSES = new Set(['approved', 'cancelled']);
export const LEAVE_DURATION_MODES = new Set(['full_day', 'half_day']);
export const HALF_DAY_PARTS = new Set(['first_half', 'second_half']);
export const SERVICE_PAYMENT_MODELS = new Set(['fixed_rate', 'per_student']);
export const FINANCE_CORRECTION_TYPES = new Set(['bonus', 'deduction', 'adjustment', 'correction']);
export const BILLING_SOURCE_TYPES = new Set(['lesson', 'transfer', 'adjustment']);
export const LEAVE_PAY_METHODS = new Set(['legal', 'avg_hourly_x_avg_day_hours', 'fixed_rate']);

const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Every local date key from start to end (each a date key or an instant, read in the org's zone). */
function enumerateLocalDateRange(startDate, endDate) {
  return enumerateDateKeys(localDateKey(startDate), localDateKey(endDate));
}

export function isYmdDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeString(value));
}

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeBooleanPolicy(raw, defaults) {
  const parsed = parseJsonValue(raw, defaults);
  const source = isPlainObject(parsed) ? parsed : defaults;
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, Boolean(source[key])])
  );
}

function normalizeHmoNonAttendanceBillingPolicy(raw) {
  const parsed = parseJsonValue(raw, DEFAULT_HMO_NON_ATTENDANCE_BILLING_POLICY);
  const normalized = normalizeString(parsed).toLowerCase();
  return HMO_NON_ATTENDANCE_BILLING_POLICIES.has(normalized)
    ? normalized
    : DEFAULT_HMO_NON_ATTENDANCE_BILLING_POLICY;
}

function normalizeLeavePolicy(raw) {
  const parsed = parseJsonValue(raw, DEFAULT_LEAVE_POLICY);
  const source = isPlainObject(parsed) ? parsed : DEFAULT_LEAVE_POLICY;
  return {
    holiday_rules: Array.isArray(source.holiday_rules) ? source.holiday_rules : [],
  };
}

function normalizeLeavePayPolicy(raw) {
  const parsed = parseJsonValue(raw, DEFAULT_LEAVE_PAY_POLICY);
  const source = isPlainObject(parsed) ? parsed : DEFAULT_LEAVE_PAY_POLICY;
  const method = normalizeString(source.default_method).toLowerCase();
  return {
    default_method: LEAVE_PAY_METHODS.has(method) ? method : DEFAULT_LEAVE_PAY_POLICY.default_method,
    lookback_months: Number.isFinite(Number(source.lookback_months)) && Number(source.lookback_months) > 0
      ? Math.round(Number(source.lookback_months))
      : DEFAULT_LEAVE_PAY_POLICY.lookback_months,
    fixed_rate_default: Number.isFinite(Number(source.fixed_rate_default)) && Number(source.fixed_rate_default) >= 0
      ? Number(source.fixed_rate_default)
      : DEFAULT_LEAVE_PAY_POLICY.fixed_rate_default,
  };
}

export const LEAVE_PAY_LOOKBACK_MONTHS_MIN = 1;
export const LEAVE_PAY_LOOKBACK_MONTHS_MAX = 12;

/**
 * Checks a leave_pay_policy written through the settings API. Unlike the lenient read-side
 * normalizer, a bad value is refused instead of silently replaced: an unknown method, a number of
 * months that is not a whole number from 1 to 12 or a negative fixed default. Fields left out take the
 * defaults; unknown fields (such as the retired legal_allow_12m_if_better) are dropped.
 * Returns { value } (normalized) or { error }.
 */
export function validateLeavePayPolicyInput(raw) {
  const parsed = parseJsonValue(raw, null);
  if (!isPlainObject(parsed)) {
    return { error: 'invalid_leave_pay_policy' };
  }
  if (parsed.default_method !== undefined) {
    const method = normalizeString(parsed.default_method).toLowerCase();
    if (!LEAVE_PAY_METHODS.has(method)) {
      return { error: 'invalid_leave_pay_method' };
    }
  }
  if (parsed.lookback_months !== undefined) {
    const months = Number(parsed.lookback_months);
    if (
      parsed.lookback_months === null
      || parsed.lookback_months === ''
      || !Number.isInteger(months)
      || months < LEAVE_PAY_LOOKBACK_MONTHS_MIN
      || months > LEAVE_PAY_LOOKBACK_MONTHS_MAX
    ) {
      return { error: 'invalid_leave_pay_lookback_months' };
    }
  }
  if (parsed.fixed_rate_default !== undefined) {
    const fixed = Number(parsed.fixed_rate_default);
    if (parsed.fixed_rate_default === null || !Number.isFinite(fixed) || fixed < 0) {
      return { error: 'invalid_leave_pay_fixed_rate_default' };
    }
  }
  return { value: normalizeLeavePayPolicy({ ...DEFAULT_LEAVE_PAY_POLICY, ...parsed }) };
}

const INSTRUCTOR_EARNINGS_STATUSES = Object.keys(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);

/**
 * Checks an instructor_earnings_policy written through the settings API: an object whose four
 * statuses are booleans. A missing status takes the default; anything else is refused.
 * Returns { value } (normalized) or { error }.
 */
export function validateInstructorEarningsPolicyInput(raw) {
  const parsed = parseJsonValue(raw, null);
  if (!isPlainObject(parsed)) {
    return { error: 'invalid_instructor_earnings_policy' };
  }
  for (const status of INSTRUCTOR_EARNINGS_STATUSES) {
    if (parsed[status] !== undefined && typeof parsed[status] !== 'boolean') {
      return { error: 'invalid_instructor_earnings_policy' };
    }
  }
  return { value: normalizeBooleanPolicy({ ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY, ...parsed }, DEFAULT_INSTRUCTOR_EARNINGS_POLICY) };
}

/**
 * Plain (undated) settings of one organisation as { key: value }. A dated setting is refused: it
 * has no value in "Settings" and is read as of a date through dated-settings.js.
 */
export async function loadSettingsMap(tenantClient, orgId, keys = []) {
  const normalizedKeys = Array.from(new Set((keys || []).map((key) => normalizeString(key)).filter(Boolean)));
  const datedKeys = normalizedKeys.filter(isDatedSettingKey);
  if (datedKeys.length > 0) {
    throw new Error(`loadSettingsMap cannot read dated settings (${datedKeys.join(', ')}); use loadFinancePolicies or dated-settings.js`);
  }
  if (normalizedKeys.length === 0) {
    return {};
  }
  const normalizedOrgId = normalizeString(orgId);
  if (!normalizedOrgId) {
    return {};
  }

  const { data, error } = await withOrgScope(tenantClient, 'Settings', normalizedOrgId)
    .select('key, settings_value')
    .in('key', normalizedKeys);

  if (error) {
    if (error.code === '42P01') {
      return {};
    }
    throw error;
  }

  const map = {};
  for (const row of data || []) {
    map[row.key] = row.settings_value ?? null;
  }
  return map;
}

/**
 * The organisation's finance policies as they stand on a date.
 *
 * The plain settings (leave balance rules, student billing) have one value. The dated ones
 * (`instructorEarningsPolicy`, `leavePayPolicy`) are the versions in force on the date
 * (dated-settings.js). Every policies object also has `asOfDate` and `onDate(dateKey)`, which
 * returns the same policies as they stand on another date without reading the database again, so
 * pay code resolves each lesson and each leave day by its own local date (`financePoliciesOnDate`).
 *
 * `asOf` is required: a caller that means "now" passes today's org-local date (`todayKey()`).
 *
 * @param {any} tenantClient
 * @param {string} orgId
 * @param {{ asOf: string }} options
 */
export async function loadFinancePolicies(tenantClient, orgId, { asOf } = /** @type {any} */ ({})) {
  const asOfDate = normalizeString(asOf);
  if (!isYmdDate(asOfDate)) {
    throw new Error('loadFinancePolicies needs an as-of date key (YYYY-MM-DD)');
  }
  const [settingsMap, datedRows] = await Promise.all([
    loadSettingsMap(tenantClient, orgId, [
      'leave_policy',
      'billing_consumption_policy',
      'hmo_non_attendance_billing_policy',
    ]),
    loadDatedSettingRows(tenantClient, orgId),
  ]);
  return buildFinancePolicies({ settingsMap, datedRows, asOf: asOfDate });
}

/**
 * The policies object of loadFinancePolicies from rows already read (pure; tests build it directly).
 *
 * @param {{ settingsMap?: Record<string, any>, datedRows?: any[], asOf: string }} params
 */
export function buildFinancePolicies({ settingsMap = {}, datedRows = [], asOf }) {
  const undated = {
    leavePolicy: normalizeLeavePolicy(settingsMap.leave_policy),
    billingConsumptionPolicy: normalizeBooleanPolicy(settingsMap.billing_consumption_policy, DEFAULT_BILLING_CONSUMPTION_POLICY),
    hmoNonAttendanceBillingPolicy: normalizeHmoNonAttendanceBillingPolicy(settingsMap.hmo_non_attendance_billing_policy),
  };
  const byDate = new Map();
  const onDate = (dateKey) => {
    const date = localDateKey(dateKey) || asOf;
    if (!byDate.has(date)) {
      const entitlementVersion = resolveSettingOnDate(datedRows, LEAVE_ENTITLEMENT_POLICY_KEY, date);
      byDate.set(date, Object.freeze({
        leaveEntitlementPolicy: normalizeLeaveEntitlementPolicy(entitlementVersion?.settings_value),
        leaveEntitlementPolicyEffectiveDate: entitlementVersion?.effective_date || null,
        ...undated,
        leavePayPolicy: normalizeLeavePayPolicy(resolveSettingOnDate(datedRows, 'leave_pay_policy', date)?.settings_value),
        instructorEarningsPolicy: normalizeBooleanPolicy(
          resolveSettingOnDate(datedRows, 'instructor_earnings_policy', date)?.settings_value,
          DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
        ),
        asOfDate: date,
        onDate,
      }));
    }
    return byDate.get(date);
  };
  return onDate(asOf);
}

/**
 * The policies as they stand on `dateKey`. Accepts a policies object from loadFinancePolicies, or a
 * plain object with the same fields (then it is the policy on every date).
 */
export function financePoliciesOnDate(policies, dateKey) {
  return policies && typeof policies.onDate === 'function' && dateKey ? policies.onDate(dateKey) : policies;
}

/**
 * The org id a tenant read is scoped to. Every helper here reads through withOrgScope, so a missing
 * org id is a bug in the caller, never "all organisations".
 */
function requireOrgId(orgId, helperName) {
  const normalized = normalizeString(orgId);
  if (!normalized) {
    throw new Error(`${helperName} needs the organisation id`);
  }
  return normalized;
}

/**
 * The employee a request is about, in the organisation the user is signed in to. An employee of
 * another organisation is "not found", even when the id exists there: the same person can be an
 * employee of several organisations, each with its own row.
 */
export async function resolveEmployeeRecord(tenantClient, orgId, { employeeId, userId, canManageAll = false }) {
  const scopedOrgId = requireOrgId(orgId, 'resolveEmployeeRecord');
  let query = withOrgScope(tenantClient, 'Employees', scopedOrgId)
    .select('id, user_id, first_name, last_name, employee_type, start_date, annual_leave_days, leave_pay_method, employment_scope, working_days')
    .limit(1);

  if (employeeId) {
    query = query.eq('id', employeeId);
  } else if (!canManageAll) {
    query = query.eq('user_id', userId);
  } else {
    return { error: 'missing_employee_id' };
  }

  const { data, error } = await query;
  if (error) {
    return { error };
  }

  const employee = Array.isArray(data) ? data[0] : null;
  if (!employee) {
    return { error: 'employee_not_found' };
  }
  if (!canManageAll && employee.user_id !== userId) {
    return { error: 'forbidden' };
  }
  return { employee };
}

export async function loadInstructorProfilesMap(tenantClient, orgId, employeeIds = []) {
  const scopedOrgId = requireOrgId(orgId, 'loadInstructorProfilesMap');
  const ids = Array.from(new Set((employeeIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await withOrgScope(tenantClient, 'instructor_profiles', scopedOrgId)
    .select('employee_id, break_time_minutes, metadata')
    .in('employee_id', ids);

  if (error && error.code !== '42P01') {
    throw error;
  }

  return new Map((data || []).map((row) => [row.employee_id, row]));
}

export function normalizeWorkingDays(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6)
      .sort((left, right) => left - right);
  }
  if (isPlainObject(value) && Array.isArray(value.days)) {
    return normalizeWorkingDays(value.days);
  }
  return [];
}

export function resolveEmployeeWorkingDays(employee) {
  const fromEmployee = normalizeWorkingDays(employee?.working_days);
  if (fromEmployee.length > 0) {
    return fromEmployee;
  }

  return [...DEFAULT_WORKING_DAYS];
}

export function countWorkingDaysInRange(workingDays, startDate, endDate) {
  const daySet = new Set(normalizeWorkingDays(workingDays).length > 0 ? normalizeWorkingDays(workingDays) : DEFAULT_WORKING_DAYS);
  return enumerateLocalDateRange(startDate, endDate).reduce((count, dateKey) => {
    const dayOfWeek = weekdayOfDateKey(dateKey);
    return daySet.has(dayOfWeek) ? count + 1 : count;
  }, 0);
}

export function canManageEmployeeOps(role) {
  return isAdminOrOffice(role);
}

// Same calendar day `months` earlier; a day the earlier month lacks rolls over (31.05 - 3 -> 03.03).
function startOfLookbackRange(targetDate, months) {
  const target = parseDateKey(localDateKey(targetDate));
  if (!target) return '';
  return dateKeyFromParts(target.year, target.month - months, target.day);
}


export function normalizeServicePaymentModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return SERVICE_PAYMENT_MODELS.has(normalized) ? normalized : 'fixed_rate';
}

export async function loadGraceCancellationParticipantIds(tenantClient, orgId, participantIds = []) {
  const scopedOrgId = requireOrgId(orgId, 'loadGraceCancellationParticipantIds');
  const ids = Array.from(new Set((participantIds || []).map((participantId) => normalizeString(participantId)).filter(Boolean)));
  if (ids.length === 0) {
    return new Set();
  }

  const { data: graceRows, error: graceRowsError } = await withOrgScope(tenantClient, 'grace_cancellation_requests', scopedOrgId)
    .select('lesson_participant_id')
    .in('lesson_participant_id', ids);

  if (graceRowsError && graceRowsError.code !== '42P01') {
    throw graceRowsError;
  }

  return new Set((graceRows || [])
    .map((row) => normalizeString(row?.lesson_participant_id))
    .filter(Boolean));
}

export function resolveCompensationEligibleParticipants(participants = [], policies = null, graceParticipantIds = new Set()) {
  return (participants || []).filter((participant) => (
    !graceParticipantIds.has(normalizeString(participant?.id))
    && shouldParticipantTriggerInstructorCompensation(participant, policies)
  ));
}

export function resolveLessonInstructorPayout({
  instance,
  rateUsed,
  servicePaymentModel = 'fixed_rate',
  compensationParticipants = [],
  payBasis = PAY_BASIS.LESSON_HOURLY,
} = {}) {
  const normalizedRate = coerceAgorot(rateUsed);
  const normalizedPaymentModel = normalizeServicePaymentModel(servicePaymentModel);
  const normalizedPayBasis = payBasis === PAY_BASIS.LESSON_FLAT ? PAY_BASIS.LESSON_FLAT : PAY_BASIS.LESSON_HOURLY;
  const participantCount = Array.isArray(compensationParticipants) ? compensationParticipants.length : 0;
  const participantMultiplier = normalizedPaymentModel === 'per_student'
    ? participantCount
    : (participantCount > 0 ? 1 : 0);
  // lesson_flat pays the same per lesson whatever its length; lesson_hourly pays rate × lesson hours.
  const lessonUnits = normalizedPayBasis === PAY_BASIS.LESSON_FLAT
    ? 1
    : Number(instance?.duration_minutes || 0) / 60;
  const payoutAmount = Math.round(normalizedRate * lessonUnits * participantMultiplier);

  return {
    rateUsed: normalizedRate,
    participantMultiplier,
    payoutAmount,
    servicePaymentModel: normalizedPaymentModel,
    payBasis: normalizedPayBasis,
  };
}

/**
 * Compute instructor payout for a single lesson in agorot.
 * @param {object} instance - lesson instance with duration_minutes
 * @param {number} rateUsed - hourly rate in agorot
 * @returns {number} payout in agorot
 */
export function computeLessonInstructorPayoutAmount(instance, rateUsed, options = {}) {
  return resolveLessonInstructorPayout({
    instance,
    rateUsed,
    servicePaymentModel: options?.servicePaymentModel,
    compensationParticipants: options?.compensationParticipants,
    payBasis: options?.payBasis,
  }).payoutAmount;
}

function groupRecordsByDate(records = []) {
  const grouped = new Map();
  for (const record of records) {
    const dateKey = localDateKey(record?.date || record?.effective_date || record?.attendance_date || record?.lesson_date);
    if (!dateKey) continue;
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, { amount: 0, hours: 0 });
    }
    const bucket = grouped.get(dateKey);
    bucket.amount += coerceAgorot(record?.amount);
    bucket.hours += (Number(record?.hours) || 0);
  }
  return grouped;
}

function computeAverageDayValue(records, targetDate, months) {
  const targetKey = localDateKey(targetDate);
  if (!targetKey) {
    return 0;
  }
  const rangeStart = startOfLookbackRange(targetKey, months);
  const grouped = groupRecordsByDate(records.filter((record) => {
    const dateKey = localDateKey(record?.date || record?.effective_date || record?.attendance_date || record?.lesson_date);
    return Boolean(dateKey) && dateKey < targetKey && dateKey >= rangeStart;
  }));

  const workedDays = Array.from(grouped.values()).filter((bucket) => bucket.amount > 0 || bucket.hours > 0);
  if (workedDays.length === 0) {
    return 0;
  }

  const totalAmount = workedDays.reduce((sum, bucket) => sum + bucket.amount, 0);
  return totalAmount / workedDays.length;
}

export function resolveLeavePayMethod(employee, leavePayPolicy) {
  const employeeMethod = normalizeString(employee?.leave_pay_method).toLowerCase();
  if (LEAVE_PAY_METHODS.has(employeeMethod)) {
    return employeeMethod;
  }
  return leavePayPolicy.default_method || DEFAULT_LEAVE_PAY_POLICY.default_method;
}

const PAID_LEAVE_TYPES = new Set(['employee_paid', 'system_paid', 'half_day']);

function leaveTypeOf(leaveDay) {
  return leaveDay?.leave_type || leaveDay?.entry?.leave_type;
}

/**
 * The local dates an employee worked: a day with a counted lesson or with office minutes on the
 * attendance record, or a day of paid leave. Each date counts once, whatever happened on it. The
 * leave entitlement (leave-entitlement.js) and the choice of the "legal" leave-pay window count
 * these days; there is no other count of days worked.
 */
export function collectWorkedDates({ lessons = [], attendanceRecords = [], leaveDays = [] } = {}) {
  const dates = new Set();
  for (const lesson of lessons || []) {
    if (lesson?.counted && lesson.lesson_date) dates.add(lesson.lesson_date);
  }
  // A day of paid leave (employee_paid, system_paid, or the older half_day) counts as a work day;
  // unpaid leave does not. Any part of a day is a day, so a half-day leave with no work on it counts
  // as a whole day. A date counts once, even when it also has work.
  for (const leaveDay of leaveDays || []) {
    const dateKey = localDateKey(leaveDay?.leave_date);
    if (dateKey && PAID_LEAVE_TYPES.has(leaveTypeOf(leaveDay))) dates.add(dateKey);
  }
  for (const record of attendanceRecords || []) {
    const dateKey = localDateKey(record?.attendance_date);
    if (dateKey && Number(record?.other_minutes) > 0) dates.add(dateKey);
  }
  return Array.from(dates).sort();
}

/**
 * Office hours priced at the hourly rate in force on each date. `amount` is not rounded: a period's
 * total is rounded once (coerceAgorot), as the monthly summary shows it.
 */
export function priceAttendanceRecords(attendanceRecords = [], rateRows = [], employeeId = null) {
  return (attendanceRecords || []).map((row) => {
    const dateKey = localDateKey(row?.attendance_date);
    const rate = resolveRateOnDate(rateRows, {
      employeeId,
      payBasis: PAY_BASIS.ATTENDANCE_HOURLY,
      date: dateKey,
    })?.rate ?? 0;
    const minutes = Math.max(0, Number(row?.other_minutes) || 0);
    return {
      attendance_date: dateKey,
      other_minutes: minutes,
      rate_used: rate > 0 ? rate : null,
      amount: rate > 0 ? (minutes / 60) * rate : 0,
    };
  });
}

// The "legal" leave-day value (method 'legal', shown as "ממוצע מומלץ"), after the Annual Leave Law,
// section 10: the gross wages of the 3 months before the leave ÷ 90 is the value of one calendar
// day; if those months were not full, the 3 consecutive months of the last 12 with the most days
// worked are used.
export const LEGAL_LEAVE_WINDOW_MONTHS = 3;
export const LEGAL_LEAVE_WINDOW_DAYS = 90;
export const LEGAL_LEAVE_SEARCH_MONTHS = 12;
/**
 * The wage base of a window includes the paid leave inside it, and that leave is itself valued by
 * a window further back. The chain is followed by recursion with this depth bound: the leave day
 * being paid is depth 0, a leave day inside its window is depth 1 (valued by the same function),
 * one inside that day's window is depth 2, and a leave day deeper than that adds nothing to its
 * window's base. Every step goes back at least one whole month, so the recursion always ends, and
 * the result depends only on the data, never on the period being shown, as long as the caller
 * loads history back to legalLeaveHistoryStart(). The bound (rather than walking every month since
 * the employee started) keeps the history read to at most 36 months; a leave day three windows
 * deep changes the value only marginally. Each leave day is counted once, in its own month.
 */
export const LEGAL_LEAVE_MAX_DEPTH = 2;

/**
 * The candidate windows for a leave day: every 3 consecutive whole calendar months (org-local) that
 * end before the leave day's month and start within the 12 months before it, most recent first.
 */
export function legalLeaveWindows(targetDate) {
  const leaveMonth = firstDayOfMonth(localDateKey(targetDate));
  if (!leaveMonth) return [];
  const windows = [];
  for (let endOffset = 1; endOffset + LEGAL_LEAVE_WINDOW_MONTHS - 1 <= LEGAL_LEAVE_SEARCH_MONTHS; endOffset += 1) {
    const start = addMonths(leaveMonth, -(endOffset + LEGAL_LEAVE_WINDOW_MONTHS - 1));
    const end = lastDayOfMonth(addMonths(leaveMonth, -endOffset));
    windows.push({ start, end, start_month: monthKeyOfDateKey(start), end_month: monthKeyOfDateKey(end) });
  }
  return windows;
}

/**
 * The window to use: the most recent one, unless another has strictly more days worked; the one
 * with the most days wins, and a tie goes to the more recent window. Expects windows most recent first.
 */
export function chooseLegalLeaveWindow(windows = [], workedDates = []) {
  let chosen = null;
  for (const window of windows || []) {
    const workedDays = (workedDates || []).filter((dateKey) => dateKey >= window.start && dateKey <= window.end).length;
    if (!chosen || workedDays > chosen.worked_days) {
      chosen = { ...window, worked_days: workedDays };
    }
  }
  return chosen;
}

/**
 * What the window's wages are divided by: 90. Assumption (owner-approved): an employee whose
 * start_date falls inside the window is divided by the calendar days employed in it (start_date to
 * the window's end), capped at 90, so a short first quarter is not diluted by days before they
 * started. An employee with no start_date is divided by 90. 0 when they started after the window.
 */
export function legalLeaveDivisor(employee, window) {
  const startDate = normalizeDateKey(employee?.start_date);
  if (!window || !isDateKey(startDate) || startDate <= window.start) return LEGAL_LEAVE_WINDOW_DAYS;
  if (startDate > window.end) return 0;
  return Math.min(LEGAL_LEAVE_WINDOW_DAYS, diffDays(startDate, window.end) + 1);
}

/**
 * The value of one NET leave day (our leave days are working days, the law's are calendar days):
 * (wage base ÷ divisor) is a calendar day, and a week of W working days holds 7 calendar days, so
 * one working day is (wage base ÷ divisor) × 7 ÷ W, W = 6 for a six-day week, else 5. Rounded once,
 * to the agora.
 */
export function legalLeaveDayValue({ wageBase, divisor, weekDays }) {
  const base = coerceAgorot(wageBase);
  const week = weekDays === 6 ? 6 : 5;
  if (base <= 0 || !(divisor > 0)) return 0;
  return Math.round((base * 7) / (divisor * week));
}

/**
 * The first day the history must start at so that every window the valuer may evaluate, down to
 * LEGAL_LEAVE_MAX_DEPTH, is complete: 12 months before the earliest leave month reached.
 * `leaveDates` are the period's leave days; `historyLeaveDays` the approved leave days before them
 * (read back at least 12 × (LEGAL_LEAVE_MAX_DEPTH + 1) months). '' when there is no leave.
 */
export function legalLeaveHistoryStart(leaveDates = [], historyLeaveDays = [], maxDepth = LEGAL_LEAVE_MAX_DEPTH) {
  const monthsOf = (dates) => new Set(dates.map((date) => firstDayOfMonth(localDateKey(date))).filter(Boolean));
  let level = monthsOf(leaveDates || []);
  if (level.size === 0) return '';
  const paidHistory = (historyLeaveDays || [])
    .filter((day) => PAID_LEAVE_TYPES.has(leaveTypeOf(day)) && Number(day?.pay_fraction) > 0)
    .map((day) => localDateKey(day.leave_date))
    .filter(Boolean);
  let earliest = [...level].sort()[0];
  for (let depth = 1; depth <= maxDepth && level.size > 0; depth += 1) {
    const ranges = [...level].map((month) => ({ from: addMonths(month, -LEGAL_LEAVE_SEARCH_MONTHS), before: month }));
    level = monthsOf(paidHistory.filter((dateKey) => ranges.some((range) => dateKey >= range.from && dateKey < range.before)));
    for (const month of level) if (month < earliest) earliest = month;
  }
  return addMonths(earliest, -LEGAL_LEAVE_SEARCH_MONTHS);
}

/**
 * Values leave days from the facts. One valuer serves every leave day of a period, so the windows
 * and the leave inside them are computed once.
 *
 * - `lessonHistory`: the counted lessons (loadCountedLessons) with lesson_date and payout_amount.
 * - `attendanceRecords`: office hours (other_minutes), priced at the dated hourly rate.
 * - `leaveDays`: the approved leave days of the history, for the days worked and for the paid leave
 *   inside a window.
 * - `leavePayPolicyOn(date)`: the leave-pay policy in force on a date; without it `leavePayPolicy`.
 *
 * detailOf(date) returns { value, method, basis }: value is one full leave day in agorot; basis
 * (for "legal") gives the window, its wage base, the divisor and the work-week days.
 */
export function createLeaveDayValuer({
  employee,
  lessonHistory = [],
  attendanceRecords = [],
  leaveDays = [],
  leavePayPolicy = DEFAULT_LEAVE_PAY_POLICY,
  leavePayPolicyOn = null,
  rateRows = [],
} = {}) {
  const employeeId = employee?.id || null;
  const policyOn = (dateKey) => (typeof leavePayPolicyOn === 'function' ? leavePayPolicyOn(dateKey) : null)
    || leavePayPolicy
    || DEFAULT_LEAVE_PAY_POLICY;
  const lessons = (lessonHistory || [])
    .filter((row) => row && row.counted !== false)
    .map((row) => ({ ...row, counted: true, lesson_date: localDateKey(row.lesson_date || row.datetime_start) }))
    .filter((row) => row.lesson_date);
  const pricedAttendance = priceAttendanceRecords(attendanceRecords, rateRows, employeeId);
  const paidLeave = (leaveDays || [])
    .filter((day) => PAID_LEAVE_TYPES.has(leaveTypeOf(day)) && Number(day?.pay_fraction) > 0)
    .map((day) => ({ date: localDateKey(day.leave_date), fraction: Number(day.pay_fraction) }))
    .filter((day) => day.date);
  const workedDates = collectWorkedDates({ lessons, attendanceRecords, leaveDays });
  let averageRecords = null;
  const memo = new Map();
  const monthMemo = new Map();

  // The pay of one calendar month as the monthly summary computes it: lesson pay, office hours
  // (rounded once for the month) and paid leave (each day rounded). Leave is valued at `leaveDepth`.
  function monthWageBase(monthKey, leaveDepth) {
    const key = `${monthKey}|${leaveDepth}`;
    if (monthMemo.has(key)) return monthMemo.get(key);
    const inMonth = (dateKey) => monthKeyOfDateKey(dateKey) === monthKey;
    const lessonAmount = lessons
      .filter((row) => inMonth(row.lesson_date))
      .reduce((sum, row) => sum + coerceAgorot(row.payout_amount), 0);
    const attendanceAmount = coerceAgorot(pricedAttendance
      .filter((row) => inMonth(row.attendance_date))
      .reduce((sum, row) => sum + row.amount, 0));
    const leaveAmount = leaveDepth > LEGAL_LEAVE_MAX_DEPTH
      ? 0
      : paidLeave
        .filter((day) => inMonth(day.date))
        .reduce((sum, day) => sum + coerceAgorot(detailOf(day.date, leaveDepth).value * day.fraction), 0);
    const total = coerceAgorot(lessonAmount + attendanceAmount + leaveAmount);
    monthMemo.set(key, total);
    return total;
  }

  function legalDetail(targetKey, depth) {
    const chosen = chooseLegalLeaveWindow(legalLeaveWindows(targetKey), workedDates);
    if (!chosen) return { value: 0, method: 'legal', basis: null };
    const wageBase = Array.from({ length: LEGAL_LEAVE_WINDOW_MONTHS }, (_, index) => (
      monthKeyOfDateKey(addMonths(chosen.start, index))
    )).reduce((sum, monthKey) => sum + monthWageBase(monthKey, depth + 1), 0);
    const divisor = legalLeaveDivisor(employee, chosen);
    const weekDays = workWeekDays(employee?.working_days);
    return {
      value: legalLeaveDayValue({ wageBase, divisor, weekDays }),
      method: 'legal',
      basis: {
        start_month: chosen.start_month,
        end_month: chosen.end_month,
        worked_days: chosen.worked_days,
        wage_base: coerceAgorot(wageBase),
        divisor,
        week_days: weekDays,
      },
    };
  }

  function computeDetail(targetKey, depth) {
    const policy = policyOn(targetKey);
    const method = resolveLeavePayMethod(employee, policy);

    if (method === 'fixed_rate') {
      // The fixed leave-day value is a dated rate (pay_basis leave_day); without one, the farm default applies.
      const leaveDayRate = resolveRateOnDate(rateRows, { employeeId, payBasis: PAY_BASIS.LEAVE_DAY, date: targetKey });
      return { value: leaveDayRate ? leaveDayRate.rate : coerceAgorot(policy.fixed_rate_default), method, basis: null };
    }

    // A salaried employee's leave day is worth a day of salary. This follows the rate, not the label
    // on the employee, so someone who is salaried and also teaches is still valued as salaried here.
    // combinePayComponents adds no leave on top of a salary: the salary keeps running during leave.
    if (hasRateKind(rateRows, { employeeId, payBasis: PAY_BASIS.MONTHLY_SALARY, onOrBefore: targetKey })) {
      const workingDays = countWorkingDaysInRange(resolveEmployeeWorkingDays(employee), firstDayOfMonth(targetKey), lastDayOfMonth(targetKey));
      const monthlySalary = resolveRateOnDate(rateRows, { employeeId, payBasis: PAY_BASIS.MONTHLY_SALARY, date: targetKey })?.rate ?? 0;
      // Both values are in agorot — round to nearest agora for per-day rate
      const value = monthlySalary > 0 && workingDays > 0 ? Math.round(monthlySalary / workingDays) : 0;
      return { value, method: 'monthly_salary', basis: null };
    }

    if (method === 'legal') {
      return legalDetail(targetKey, depth);
    }

    // "ממוצע היסטורי": the average pay of a worked day over the policy's lookback months.
    if (!averageRecords) {
      averageRecords = [
        ...(lessonHistory || []).map((row) => ({
          date: row.lesson_date || row.created_at || row.datetime_start,
          amount: row.payout_amount,
          hours: row.duration_minutes ? Number(row.duration_minutes) / 60 : 0,
        })),
        // Attendance records hold only work that is not a lesson, so nothing is counted twice.
        ...pricedAttendance.map((row) => ({
          date: row.attendance_date,
          amount: Math.round(row.amount),
          hours: row.other_minutes ? row.other_minutes / 60 : 0,
        })),
      ];
    }
    return {
      value: Math.round(computeAverageDayValue(averageRecords, targetKey, policy.lookback_months || 3)),
      method,
      basis: null,
    };
  }

  function detailOf(targetDate, depth = 0) {
    const targetKey = localDateKey(targetDate);
    if (!targetKey) return { value: 0, method: null, basis: null };
    const key = `${targetKey}|${depth}`;
    if (!memo.has(key)) memo.set(key, computeDetail(targetKey, depth));
    return memo.get(key);
  }

  return { detailOf, valueOf: (targetDate) => detailOf(targetDate).value };
}

/** The value of one full leave day on `targetDate`, with how it was found (see createLeaveDayValuer). */
export function resolveLeaveDayDetail({ targetDate, ...facts }) {
  return createLeaveDayValuer(facts).detailOf(targetDate);
}

/** The value of one full leave day on `targetDate`, in agorot (see createLeaveDayValuer). */
export function resolveLeaveDayValue(params) {
  return resolveLeaveDayDetail(params).value;
}

/**
 * What an employee is owed for a period: every part they actually have rates for, added together.
 *
 * Each part comes from its own rates (RateHistory), so an instructor who also does office hours is
 * paid for both; there is no "pay model" choosing one. Paid leave is added only when there is no
 * monthly salary: a salary is pro-rated over working days, which already covers the leave days
 * inside the month.
 */
export function combinePayComponents({
  lessonAmount = 0,
  attendanceAmount = 0,
  monthlySalaryAmount = 0,
  paidLeaveTotal = 0,
  correctionTotal = 0,
  paysMonthlySalary = false,
}) {
  const base = coerceAgorot(lessonAmount) + coerceAgorot(attendanceAmount) + coerceAgorot(monthlySalaryAmount);
  const leave = paysMonthlySalary ? 0 : coerceAgorot(paidLeaveTotal);
  return {
    baseAmount: coerceAgorot(base),
    paidLeaveAmount: leave,
    totalAmount: coerceAgorot(base + leave + coerceAgorot(correctionTotal)),
  };
}

export function buildLeaveDayRows({
  employeeId,
  leaveEntryId,
  leaveType,
  startDate,
  endDate,
  durationMode,
  halfDayPart,
}) {
  if (!LEAVE_TYPES.has(leaveType)) {
    return [];
  }

  const isHalfDay = leaveType === 'half_day' || durationMode === 'half_day';
  const dates = enumerateLocalDateRange(startDate, endDate);
  if (isHalfDay) {
    const onlyDate = dates[0];
    if (!onlyDate) return [];
    return [{
      leave_entry_id: leaveEntryId,
      employee_id: employeeId,
      leave_date: onlyDate,
      day_portion: HALF_DAY_PARTS.has(halfDayPart) ? halfDayPart : 'first_half',
      leave_type: leaveType,
      balance_days_delta: -0.5,
      pay_fraction: 0.5,
      metadata: { duration_mode: 'half_day' },
    }];
  }

  return dates.map((dateKey) => ({
    leave_entry_id: leaveEntryId,
    employee_id: employeeId,
    leave_date: dateKey,
    day_portion: 'full_day',
    leave_type: leaveType,
    balance_days_delta: leaveType === 'employee_paid' ? -1 : 0,
    pay_fraction: leaveType === 'unpaid' ? 0 : 1,
    metadata: { duration_mode: 'full_day' },
  }));
}

export async function fetchApprovedLeaveDays(tenantClient, orgId, { employeeId, startDate, endDate, excludeEntryId = '' }) {
  const scopedOrgId = requireOrgId(orgId, 'fetchApprovedLeaveDays');
  const startKey = localDateKey(startDate);
  const endKey = localDateKey(endDate);
  if (!employeeId || !startKey || !endKey) {
    return [];
  }

  const { data: leaveDays, error: leaveDayError } = await withOrgScope(tenantClient, 'employee_leave_days', scopedOrgId)
    .select('id, leave_entry_id, employee_id, leave_date, day_portion, leave_type, balance_days_delta, pay_fraction, metadata')
    .eq('employee_id', employeeId)
    .gte('leave_date', startKey)
    .lte('leave_date', endKey)
    .order('leave_date', { ascending: true });

  if (leaveDayError) {
    if (leaveDayError.code === '42P01') {
      return [];
    }
    throw leaveDayError;
  }

  if (!Array.isArray(leaveDays) || leaveDays.length === 0) {
    return [];
  }

  const entryIds = Array.from(new Set(leaveDays.map((row) => row.leave_entry_id).filter(Boolean)));
  const { data: entries, error: entriesError } = await withOrgScope(tenantClient, 'employee_leave_entries', scopedOrgId)
    .select('id, employee_id, leave_type, status, duration_mode, half_day_part, start_date, end_date, reason, notes, source_type, approved_by, created_by, updated_by, created_at, updated_at, metadata')
    .in('id', entryIds);

  if (entriesError) {
    if (entriesError.code === '42P01') {
      return [];
    }
    throw entriesError;
  }

  const entryMap = new Map((entries || []).map((entry) => [entry.id, entry]));
  return leaveDays
    .map((day) => ({ ...day, entry: entryMap.get(day.leave_entry_id) || null }))
    .filter((day) => day.entry?.status === 'approved' && day.leave_entry_id !== excludeEntryId);
}

export async function fetchAttendanceRecords(tenantClient, orgId, { employeeId, startDate, endDate }) {
  const scopedOrgId = requireOrgId(orgId, 'fetchAttendanceRecords');
  const startKey = localDateKey(startDate);
  const endKey = localDateKey(endDate);
  if (!employeeId || !startKey || !endKey) {
    return [];
  }

  const { data, error } = await withOrgScope(tenantClient, 'employee_attendance_records', scopedOrgId)
    .select('id, employee_id, attendance_date, status, other_minutes, notes, source_type, created_by, updated_by, created_at, updated_at, metadata')
    .eq('employee_id', employeeId)
    .gte('attendance_date', startKey)
    .lte('attendance_date', endKey)
    .order('attendance_date', { ascending: true });

  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  return data || [];
}

export async function fetchLessonConflicts(tenantClient, orgId, { employeeId, startDate, endDate, excludeInstanceId = '' }) {
  const scopedOrgId = requireOrgId(orgId, 'fetchLessonConflicts');
  const startKey = localDateKey(startDate);
  const endKey = localDateKey(endDate);
  if (!employeeId || !startKey || !endKey) {
    return [];
  }

  const rangeBounds = localDateRangeUtc(startKey, endKey);
  if (!rangeBounds?.startIso || !rangeBounds?.endExclusiveIso) {
    return [];
  }

  const { data, error } = await withOrgScope(tenantClient, 'lesson_instances', scopedOrgId)
    .select('id, datetime_start, duration_minutes, status, service_id')
    .eq('instructor_employee_id', employeeId)
    .gte('datetime_start', rangeBounds.startIso)
    .lt('datetime_start', rangeBounds.endExclusiveIso)
    .order('datetime_start', { ascending: true });

  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  return (data || []).filter((instance) => (
    instance.id !== excludeInstanceId
    && instance.status !== 'cancelled'
    && instance.status !== 'cancelled_student'
    && instance.status !== 'cancelled_clinic'
  ));
}

/**
 * A half-day leave row: the day is split between leave and work, so it does not conflict with hours or
 * lessons. Reads the day's own portion, the entry's duration mode, and the legacy "half_day" type.
 */
export function isHalfDayLeaveRow(row) {
  if (!row) return false;
  const portion = row.day_portion;
  if (portion && portion !== 'full_day') return true;
  return row.entry?.duration_mode === 'half_day'
    || row.leave_type === 'half_day'
    || row.entry?.leave_type === 'half_day';
}

async function findFullDayLeaveRow(tenantClient, orgId, { employeeId, date, excludeEntryId }) {
  const rows = await fetchApprovedLeaveDays(tenantClient, orgId, {
    employeeId,
    startDate: date,
    endDate: date,
    excludeEntryId,
  });
  return rows.find((row) => !isHalfDayLeaveRow(row)) || null;
}

/** Hours cannot be recorded on a full leave day; a half-day leave allows them. */
export async function assertNoLeaveForAttendance(tenantClient, orgId, { employeeId, date, excludeEntryId = '' }) {
  const leave = await findFullDayLeaveRow(tenantClient, orgId, { employeeId, date, excludeEntryId });
  if (!leave) {
    return null;
  }

  return {
    code: 'leave_conflict',
    leave,
    message: 'attendance_conflicts_with_leave',
  };
}

/** A lesson cannot be scheduled on a full leave day; a half-day leave allows it. */
export async function assertNoLeaveForLesson(tenantClient, orgId, { employeeId, date, excludeEntryId = '' }) {
  const leave = await findFullDayLeaveRow(tenantClient, orgId, { employeeId, date, excludeEntryId });
  if (!leave) {
    return null;
  }

  return {
    code: 'leave_conflict',
    leave,
    message: 'lesson_conflicts_with_leave',
  };
}

/**
 * A full-day leave cannot cover a day with hours or lessons. A half-day leave (`halfDay: true`) can
 * share the day with work, so it never conflicts.
 */
export async function assertNoOperationalConflictsForLeave(tenantClient, orgId, { employeeId, startDate, endDate, excludeEntryId = '', halfDay = false }) {
  if (halfDay) {
    return null;
  }

  const [attendanceRecords, lessonConflicts] = await Promise.all([
    fetchAttendanceRecords(tenantClient, orgId, { employeeId, startDate, endDate }),
    fetchLessonConflicts(tenantClient, orgId, { employeeId, startDate, endDate }),
  ]);

  if (attendanceRecords.length > 0) {
    return {
      code: 'attendance_conflict',
      message: 'leave_conflicts_with_attendance',
      attendance_records: attendanceRecords,
      lesson_instances: [],
    };
  }

  const filteredLessons = lessonConflicts.filter((row) => row.id !== excludeEntryId);
  if (filteredLessons.length > 0) {
    return {
      code: 'lesson_conflict',
      message: 'leave_conflicts_with_lessons',
      attendance_records: [],
      lesson_instances: filteredLessons,
    };
  }

  return null;
}

export async function upsertLeaveBalanceUsage(tenantClient, leaveDays, {
  orgId,
  leaveEntryId,
  employeeId,
  leaveType,
  notes,
  createdBy,
}) {
  const usageRows = (leaveDays || []).filter((row) => Number(row.balance_days_delta || 0) !== 0);
  if (usageRows.length === 0) {
    return [];
  }

  const payload = usageRows.map((row) => ({
    employee_id: employeeId,
    leave_entry_id: leaveEntryId,
    leave_day_id: row.id,
    event_type: 'usage',
    leave_type: leaveType,
    quantity_days: row.balance_days_delta,
    effective_date: row.leave_date,
    notes: notes || null,
    created_by: createdBy || null,
    metadata: { pay_fraction: row.pay_fraction, day_portion: row.day_portion },
  }));

  const { data, error } = await withOrgScope(tenantClient, 'employee_leave_balance_events', orgId)
    .insert(payload)
    .select('id, employee_id, leave_entry_id, leave_day_id, event_type, leave_type, quantity_days, effective_date, notes, created_by, created_at, metadata');

  if (error) {
    throw error;
  }

  return data || [];
}

export async function deleteLeaveArtifacts(tenantClient, orgId, leaveEntryId) {
  if (!leaveEntryId) return;
  await withOrgScope(tenantClient, 'employee_leave_balance_events', orgId)
    .delete()
    .eq('leave_entry_id', leaveEntryId);

  await withOrgScope(tenantClient, 'employee_leave_days', orgId)
    .delete()
    .eq('leave_entry_id', leaveEntryId);
}

/**
 * The leave balance of one calendar year. The year's entitlement (`quota`) comes from
 * computeLeaveEntitlement (leave-entitlement.js) and is passed in; this adds the manual balance
 * movements and subtracts usage. An entitlement the system cannot compute (it asks for a manual
 * number) counts as 0. Nothing is carried over automatically and nothing caps a carry-over: a
 * carry-over is a manual movement entered by the office. (Old `leave_policy` rows may still hold
 * `carryover_enabled` / `carryover_cap_days`; they are ignored.)
 */
export function computeLeaveSummary({ entitlement = null, balanceEvents = [], year: requestedYear }) {
  const year = Number.isInteger(requestedYear) ? requestedYear : Number(todayKey().slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const quota = Number.isFinite(Number(entitlement?.days)) ? Number(entitlement.days) : 0;

  let carryIn = 0;
  let allocations = 0;
  let adjustments = 0;
  let used = 0;

  for (const entry of balanceEvents || []) {
    const effectiveDate = localDateKey(entry?.effective_date);
    if (!effectiveDate || effectiveDate < yearStart || effectiveDate > yearEnd) {
      continue;
    }
    const quantity = Number(entry?.quantity_days || 0);
    const eventType = normalizeString(entry?.event_type).toLowerCase();
    if (eventType === 'carryover') {
      carryIn += quantity;
    } else if (eventType === 'allocation') {
      allocations += quantity;
    } else if (eventType === 'usage') {
      used += Math.abs(quantity);
    } else {
      adjustments += quantity;
    }
  }

  const remaining = quota + carryIn + allocations + adjustments - used;

  return {
    year,
    quota: Number(quota.toFixed(2)),
    carryIn: Number(carryIn.toFixed(2)),
    allocations: Number(allocations.toFixed(2)),
    adjustments: Number(adjustments.toFixed(2)),
    used: Number(used.toFixed(2)),
    remaining: Number(remaining.toFixed(2)),
    // Everything the year gives: the entitlement plus the manual movements ("מגיעים N ימים").
    available: Number((remaining + used).toFixed(2)),
  };
}

export async function listFinanceCorrections(tenantClient, orgId, { employeeId = '', startDate = '', endDate = '' } = {}) {
  const scopedOrgId = requireOrgId(orgId, 'listFinanceCorrections');
  let query = withOrgScope(tenantClient, 'finance_corrections', scopedOrgId)
    .select('id, employee_id, correction_type, amount, effective_date, notes, created_by, updated_by, created_at, updated_at, metadata')
    .order('effective_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }
  if (startDate) {
    query = query.gte('effective_date', startDate);
  }
  if (endDate) {
    query = query.lte('effective_date', endDate);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }
  return data || [];
}

/**
 * Validates that the instructor has a lesson rate (RateHistory, hourly or flat) for the lesson's
 * service in effect on the lesson's date.
 * Returns null when valid.
 * Returns the 422 body when it fails: { message, code: 'instructor_rate_not_configured',
 * instructor_employee_id, service_id, rate_date, next_rate_date }, so callers send it as is.
 *
 * Call it where a person chooses an instructor, service and date: adding a lesson, creating or
 * changing a recurring template, moving a lesson to another instructor, service or day. Never call it
 * when marking attendance or completing a lesson (that must always work), and never for lessons the
 * system makes (template generation, imports): the monthly review flags those as "missing rate".
 */
export async function validateInstructorRateForLesson(
  tenantClient,
  { orgId = null, lessonInstanceId, instructorEmployeeId, serviceId, lessonDate = null } = {},
) {
  // Everything is read in the organisation the request is signed in to; the org is never taken
  // from the lesson or the employee row, so an id of another organisation finds nothing.
  const resolvedOrgId = requireOrgId(orgId, 'validateInstructorRateForLesson');
  let resolvedInstructorId = instructorEmployeeId || null;
  let resolvedServiceId = serviceId || null;
  let resolvedLessonDate = lessonDate || null;

  if ((!resolvedInstructorId || !resolvedServiceId || !resolvedLessonDate) && lessonInstanceId) {
    const { data: instance, error: instanceError } = await withOrgScope(tenantClient, 'lesson_instances', resolvedOrgId)
      .select('instructor_employee_id, service_id, datetime_start')
      .eq('id', lessonInstanceId)
      .maybeSingle();

    if (instanceError) throw instanceError;
    resolvedInstructorId = resolvedInstructorId || instance?.instructor_employee_id || null;
    resolvedServiceId = resolvedServiceId || instance?.service_id || null;
    resolvedLessonDate = resolvedLessonDate || instance?.datetime_start || null;
  }

  // If either is missing there is nothing to validate — downstream will handle it
  if (!resolvedInstructorId || !resolvedServiceId) {
    return null;
  }

  const rateDate = localDateKey(resolvedLessonDate || new Date());
  const rateRows = await loadRateHistoryRows(tenantClient, resolvedOrgId, {
    employeeIds: [resolvedInstructorId],
    payBases: [...LESSON_PAY_BASES],
  });

  // A rate of 0 is explicitly valid (volunteer / zero-rate service). Only a missing rate on that date is an error.
  if (!resolveLessonRateOnDate(rateRows, { employeeId: resolvedInstructorId, serviceId: resolvedServiceId, date: rateDate })) {
    // The rate that does exist for this service, if any, starts after the lesson: say when, so the
    // office knows the fix is a rate dated earlier rather than "no rate at all".
    const nextRateDate = rateRows
      .filter((row) => LESSON_PAY_BASES.has(row.pay_basis)
        && row.employee_id === resolvedInstructorId
        && row.service_id === resolvedServiceId
        && row.effective_date > rateDate)
      .map((row) => row.effective_date)
      .sort()[0] || null;

    const [{ data: employee }, { data: service }] = await Promise.all([
      withOrgScope(tenantClient, 'Employees', resolvedOrgId).select('first_name, last_name').eq('id', resolvedInstructorId).maybeSingle(),
      withOrgScope(tenantClient, 'Services', resolvedOrgId).select('name').eq('id', resolvedServiceId).maybeSingle(),
    ]);

    return {
      code: 'instructor_rate_not_configured',
      instructor_employee_id: resolvedInstructorId,
      service_id: resolvedServiceId,
      rate_date: rateDate || null,
      next_rate_date: nextRateDate,
      message: describeMissingLessonRate({
        instructorName: [employee?.first_name, employee?.last_name].filter(Boolean).join(' '),
        serviceName: service?.name || '',
        lessonDate: rateDate,
        nextRateDate,
      }),
    };
  }

  return null;
}

/**
 * The rate check as an endpoint uses it: null when the lesson pays, otherwise what to answer.
 * - a missing rate: { status: 422, body } with the body of validateInstructorRateForLesson;
 * - a failed lookup: { status: 500, body: { message: 'failed_to_validate_instructor_rate' }, error },
 *   which the endpoint sends through its own tracked error responder with `error`.
 *
 * @param {any} tenantClient
 * @param {Parameters<typeof validateInstructorRateForLesson>[1]} params
 * @param {{ log?: { error?: Function } } | null} [context]
 * @returns {Promise<null | { status: 422, body: any } | { status: 500, body: { message: string }, error: any }>}
 */
export async function checkInstructorRateForLesson(tenantClient, params, context = null) {
  try {
    const body = await validateInstructorRateForLesson(tenantClient, params);
    return body ? { status: 422, body } : null;
  } catch (error) {
    context?.log?.error?.('failed to check instructor rate for lesson', {
      message: /** @type {any} */ (error)?.message,
      instructor_employee_id: params?.instructorEmployeeId || null,
      service_id: params?.serviceId || null,
    });
    return { status: 500, body: { message: 'failed_to_validate_instructor_rate' }, error };
  }
}

/**
 * Whether moving a lesson changes the day it is paid on. Pay is counted on the lesson's date in the
 * org's time zone (localDateKey, as pay-calculation does), not on its UTC date: a lesson at
 * 01:00 Israel time moved to 10:00 the day before keeps its UTC date but changes its pay date.
 *
 * @param {unknown} previousDatetimeStart
 * @param {unknown} nextDatetimeStart
 */
export function hasLessonPayDateChanged(previousDatetimeStart, nextDatetimeStart) {
  if (!nextDatetimeStart) return false;
  return localDateKey(nextDatetimeStart) !== localDateKey(previousDatetimeStart);
}

/**
 * The date a recurring template's rate is checked on: the first lesson it will make, which is its
 * start date, or today when it started in the past (lessons already in the calendar are not made again).
 *
 * @param {string | null | undefined} validFrom 'YYYY-MM-DD'
 * @param {string | null | undefined} today 'YYYY-MM-DD' in the scheduling timezone
 */
export function resolveTemplateRateCheckDate(validFrom, today) {
  return validFrom && today && validFrom > today ? validFrom : (today || validFrom || null);
}

/**
 * Whether a template edit is a person's choice of who teaches what from when, and so needs a rate:
 * a new instructor, service or start date, or switching the template back on. Adding or removing
 * riders, or changing only the time, is not.
 *
 * @param {{ instructor_employee_id?: any, service_id?: any, valid_from?: any, is_active?: any }} existingTemplate
 * @param {{ instructor_employee_id?: any, service_id?: any, valid_from?: any, is_active?: any }} updates
 */
export function templateUpdateNeedsRateCheck(existingTemplate, updates) {
  const existing = existingTemplate || {};
  const next = updates || {};
  const nextInstructorId = next.instructor_employee_id ?? existing.instructor_employee_id;
  const nextServiceId = next.service_id ?? existing.service_id;
  const nextValidFrom = next.valid_from ?? existing.valid_from;
  return nextInstructorId !== existing.instructor_employee_id
    || nextServiceId !== existing.service_id
    || nextValidFrom !== existing.valid_from
    || (next.is_active === true && !existing.is_active);
}

/**
 * The rate check for a recurring template (see resolveTemplateRateCheckDate for the date), shaped
 * like checkInstructorRateForLesson.
 *
 * @param {any} tenantClient
 * @param {string} orgId
 * @param {{ instructorEmployeeId: any, serviceId: any, validFrom: any, today?: string | null }} params `today` defaults to
 *   today in the scheduling timezone.
 * @param {{ log?: { error?: Function } } | null} [context]
 */
export function checkTemplateInstructorRate(tenantClient, orgId, { instructorEmployeeId, serviceId, validFrom, today }, context = null) {
  return checkInstructorRateForLesson(tenantClient, {
    orgId,
    instructorEmployeeId,
    serviceId,
    lessonDate: resolveTemplateRateCheckDate(validFrom, today === undefined ? todayKey() : today),
  }, context);
}

function formatHebrewDate(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(dateKey || '');
}

/**
 * Why a lesson cannot be paid, and what the office does about it — not just "no rate".
 *
 * When the instructor already has a rate for the service but it starts after the lesson, the fix is
 * a rate dated on or before the lesson, so say exactly that, with the dates.
 */
export function describeMissingLessonRate({ instructorName = '', serviceName = '', lessonDate, nextRateDate = null }) {
  const name = instructorName || 'המדריך/ה';
  const service = serviceName ? `"${serviceName}"` : 'השירות הזה';
  const path = `עובדים ← ${name} ← פיננסים`;
  const lesson = formatHebrewDate(lessonDate);
  if (nextRateDate) {
    return `${name} מקבל/ת תשלום על ${service} רק מ-${formatHebrewDate(nextRateDate)}, `
      + `והמפגש הזה ב-${lesson}, לפני כן. `
      + `כדי לשלם עליו, הוסיפו תעריף שחל מ-${lesson} או קודם: ${path} ← עדכון תעריף.`;
  }
  return `ל${name} אין תעריף על ${service}. `
    + `כדי לשלם על המפגש, הגדירו תעריף שחל מ-${lesson} או קודם: ${path} ← הוספת תעריף.`;
}
