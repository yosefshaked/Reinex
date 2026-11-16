// @ts-check
/* eslint-env node */
import { isAdminOrOffice, normalizeString, withOrgScope } from './org-bff.js';
import { coerceAgorot } from './currency.js';
import { shouldParticipantTriggerInstructorCompensation } from './calendar-workflow-decisions.js';
import {
  dateKeyFromParts,
  enumerateDateKeys,
  firstDayOfMonth,
  lastDayOfMonth,
  localDateKey,
  localDateRangeUtc,
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

export const DEFAULT_LEAVE_POLICY = Object.freeze({
  carryover_enabled: false,
  carryover_cap_days: null,
  holiday_rules: [],
});

export const DEFAULT_LEAVE_PAY_POLICY = Object.freeze({
  default_method: 'legal',
  lookback_months: 3,
  legal_allow_12m_if_better: true,
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
    carryover_enabled: Boolean(source.carryover_enabled),
    carryover_cap_days: source.carryover_cap_days == null ? null : Number(source.carryover_cap_days),
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
    legal_allow_12m_if_better: Boolean(source.legal_allow_12m_if_better),
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
 * months that is not a whole number from 1 to 12, a non-boolean 12-month switch or a negative fixed
 * default. Fields left out take the defaults. Returns { value } (normalized) or { error }.
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
  if (parsed.legal_allow_12m_if_better !== undefined && typeof parsed.legal_allow_12m_if_better !== 'boolean') {
    return { error: 'invalid_leave_pay_12m_flag' };
  }
  if (parsed.fixed_rate_default !== undefined) {
    const fixed = Number(parsed.fixed_rate_default);
    if (parsed.fixed_rate_default === null || !Number.isFinite(fixed) || fixed < 0) {
      return { error: 'invalid_leave_pay_fixed_rate_default' };
    }
  }
  return { value: normalizeLeavePayPolicy({ ...DEFAULT_LEAVE_PAY_POLICY, ...parsed }) };
}

export async function loadSettingsMap(tenantClient, orgId, keys = []) {
  const normalizedKeys = Array.from(new Set((keys || []).map((key) => normalizeString(key)).filter(Boolean)));
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

export async function loadFinancePolicies(tenantClient, orgId) {
  const settingsMap = await loadSettingsMap(tenantClient, orgId, [
    'leave_policy',
    'leave_pay_policy',
    'billing_consumption_policy',
    'hmo_non_attendance_billing_policy',
    'instructor_earnings_policy',
  ]);

  return {
    leavePolicy: normalizeLeavePolicy(settingsMap.leave_policy),
    leavePayPolicy: normalizeLeavePayPolicy(settingsMap.leave_pay_policy),
    billingConsumptionPolicy: normalizeBooleanPolicy(settingsMap.billing_consumption_policy, DEFAULT_BILLING_CONSUMPTION_POLICY),
    hmoNonAttendanceBillingPolicy: normalizeHmoNonAttendanceBillingPolicy(settingsMap.hmo_non_attendance_billing_policy),
    instructorEarningsPolicy: normalizeBooleanPolicy(settingsMap.instructor_earnings_policy, DEFAULT_INSTRUCTOR_EARNINGS_POLICY),
  };
}

export async function resolveEmployeeRecord(tenantClient, { employeeId, userId, canManageAll = false }) {
  let query = tenantClient
    .from('Employees')
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

export async function loadInstructorProfilesMap(tenantClient, employeeIds = []) {
  const ids = Array.from(new Set((employeeIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('instructor_profiles')
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

export async function loadGraceCancellationParticipantIds(tenantClient, participantIds = []) {
  const ids = Array.from(new Set((participantIds || []).map((participantId) => normalizeString(participantId)).filter(Boolean)));
  if (ids.length === 0) {
    return new Set();
  }

  const { data: graceRows, error: graceRowsError } = await tenantClient
    .from('grace_cancellation_requests')
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

export function resolveLeaveDayValue({
  employee,
  targetDate,
  lessonHistory = [],
  attendanceRecords = [],
  leavePayPolicy = DEFAULT_LEAVE_PAY_POLICY,
  rateRows = [],
}) {
  const method = resolveLeavePayMethod(employee, leavePayPolicy);
  const targetKey = localDateKey(targetDate);
  const employeeId = employee?.id || null;

  if (method === 'fixed_rate') {
    // The fixed leave-day value is a dated rate (pay_basis leave_day); without one, the farm default applies.
    const leaveDayRate = resolveRateOnDate(rateRows, { employeeId, payBasis: PAY_BASIS.LEAVE_DAY, date: targetKey });
    if (leaveDayRate) {
      return leaveDayRate.rate;
    }
    return coerceAgorot(leavePayPolicy.fixed_rate_default);
  }

  // A salaried employee's leave day is worth a day of salary. This follows the rate, not the label
  // on the employee, so someone who is salaried and also teaches is still valued as salaried here.
  if (hasRateKind(rateRows, { employeeId, payBasis: PAY_BASIS.MONTHLY_SALARY, onOrBefore: targetKey })) {
    const monthStart = firstDayOfMonth(localDateKey(targetDate));
    const monthEnd = lastDayOfMonth(localDateKey(targetDate));
    const workingDays = countWorkingDaysInRange(resolveEmployeeWorkingDays(employee), monthStart, monthEnd);
    const monthlySalary = resolveRateOnDate(rateRows, { employeeId, payBasis: PAY_BASIS.MONTHLY_SALARY, date: targetKey })?.rate ?? 0;
    if (monthlySalary > 0 && workingDays > 0) {
      // Both values are in agorot — round to nearest agora for per-day rate
      return Math.round(monthlySalary / workingDays);
    }
    return 0;
  }

  const historicalRecords = [
    ...(lessonHistory || []).map((row) => ({
      date: row.lesson_date || row.created_at || row.datetime_start,
      amount: row.payout_amount,
      hours: row.duration_minutes ? Number(row.duration_minutes) / 60 : 0,
    })),
    // Attendance records hold only work that is not a lesson, so nothing is counted twice.
    ...(attendanceRecords || []).map((row) => {
      const hourlyRate = resolveRateOnDate(rateRows, {
        employeeId,
        payBasis: PAY_BASIS.ATTENDANCE_HOURLY,
        date: localDateKey(row.attendance_date),
      });
      const otherMinutes = Math.max(0, Number(row?.other_minutes) || 0);
      return {
        date: row.attendance_date,
        amount: otherMinutes && hourlyRate
          ? Math.round((otherMinutes / 60) * hourlyRate.rate)
          : 0,
        hours: otherMinutes ? otherMinutes / 60 : 0,
      };
    }),
  ];

  const baseValue = computeAverageDayValue(historicalRecords, targetDate, leavePayPolicy.lookback_months || 3);
  if (method !== 'legal' || !leavePayPolicy.legal_allow_12m_if_better) {
    return Math.round(baseValue);
  }

  const twelveMonth = computeAverageDayValue(historicalRecords, targetDate, 12);
  return Math.round(Math.max(baseValue, twelveMonth));
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

export async function fetchApprovedLeaveDays(tenantClient, { employeeId, startDate, endDate, excludeEntryId = '' }) {
  const startKey = localDateKey(startDate);
  const endKey = localDateKey(endDate);
  if (!employeeId || !startKey || !endKey) {
    return [];
  }

  const { data: leaveDays, error: leaveDayError } = await tenantClient
    .from('employee_leave_days')
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
  const { data: entries, error: entriesError } = await tenantClient
    .from('employee_leave_entries')
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

export async function fetchAttendanceRecords(tenantClient, { employeeId, startDate, endDate }) {
  const startKey = localDateKey(startDate);
  const endKey = localDateKey(endDate);
  if (!employeeId || !startKey || !endKey) {
    return [];
  }

  const { data, error } = await tenantClient
    .from('employee_attendance_records')
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

export async function fetchLessonConflicts(tenantClient, { employeeId, startDate, endDate, excludeInstanceId = '' }) {
  const startKey = localDateKey(startDate);
  const endKey = localDateKey(endDate);
  if (!employeeId || !startKey || !endKey) {
    return [];
  }

  const rangeBounds = localDateRangeUtc(startKey, endKey);
  if (!rangeBounds?.startIso || !rangeBounds?.endExclusiveIso) {
    return [];
  }

  const { data, error } = await tenantClient
    .from('lesson_instances')
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

export async function assertNoLeaveForAttendance(tenantClient, { employeeId, date, excludeEntryId = '' }) {
  const rows = await fetchApprovedLeaveDays(tenantClient, {
    employeeId,
    startDate: date,
    endDate: date,
    excludeEntryId,
  });

  if (rows.length === 0) {
    return null;
  }

  return {
    code: 'leave_conflict',
    leave: rows[0],
    message: 'attendance_conflicts_with_leave',
  };
}

export async function assertNoLeaveForLesson(tenantClient, { employeeId, date, excludeEntryId = '' }) {
  const rows = await fetchApprovedLeaveDays(tenantClient, {
    employeeId,
    startDate: date,
    endDate: date,
    excludeEntryId,
  });

  if (rows.length === 0) {
    return null;
  }

  return {
    code: 'leave_conflict',
    leave: rows[0],
    message: 'lesson_conflicts_with_leave',
  };
}

export async function assertNoOperationalConflictsForLeave(tenantClient, { employeeId, startDate, endDate, excludeEntryId = '' }) {
  const [attendanceRecords, lessonConflicts] = await Promise.all([
    fetchAttendanceRecords(tenantClient, { employeeId, startDate, endDate }),
    fetchLessonConflicts(tenantClient, { employeeId, startDate, endDate }),
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

export function computeLeaveSummary({ employee, balanceEvents = [], targetDate, leavePolicy = DEFAULT_LEAVE_POLICY }) {
  const year = Number((localDateKey(targetDate) || todayKey()).slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const annualLeaveDays = Number(employee?.annual_leave_days || 0);
  let quota = annualLeaveDays;
  const startDate = localDateKey(employee?.start_date);
  if (startDate && startDate > yearStart && startDate <= yearEnd) {
    const totalDaysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${yearEnd}T00:00:00Z`);
    const remainingDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    quota = (annualLeaveDays * remainingDays) / totalDaysInYear;
  }

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

  const rawRemaining = quota + carryIn + allocations + adjustments - used;
  const remaining = leavePolicy.carryover_cap_days != null
    ? Math.min(rawRemaining, quota + Number(leavePolicy.carryover_cap_days || 0) + allocations + adjustments)
    : rawRemaining;

  return {
    year,
    quota: Number(quota.toFixed(3)),
    carryIn: Number(carryIn.toFixed(3)),
    allocations: Number(allocations.toFixed(3)),
    adjustments: Number(adjustments.toFixed(3)),
    used: Number(used.toFixed(3)),
    remaining: Number(remaining.toFixed(3)),
  };
}

export async function listFinanceCorrections(tenantClient, { employeeId = '', startDate = '', endDate = '' } = {}) {
  let query = tenantClient
    .from('finance_corrections')
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
  let resolvedInstructorId = instructorEmployeeId || null;
  let resolvedServiceId = serviceId || null;
  let resolvedOrgId = normalizeString(orgId) || null;
  let resolvedLessonDate = lessonDate || null;

  if ((!resolvedInstructorId || !resolvedServiceId || !resolvedOrgId || !resolvedLessonDate) && lessonInstanceId) {
    const { data: instance, error: instanceError } = await tenantClient
      .from('lesson_instances')
      .select('org_id, instructor_employee_id, service_id, datetime_start')
      .eq('id', lessonInstanceId)
      .maybeSingle();

    if (instanceError) throw instanceError;
    resolvedInstructorId = resolvedInstructorId || instance?.instructor_employee_id || null;
    resolvedServiceId = resolvedServiceId || instance?.service_id || null;
    resolvedOrgId = resolvedOrgId || instance?.org_id || null;
    resolvedLessonDate = resolvedLessonDate || instance?.datetime_start || null;
  }

  // If either is missing there is nothing to validate — downstream will handle it
  if (!resolvedInstructorId || !resolvedServiceId) {
    return null;
  }

  if (!resolvedOrgId) {
    const { data: employee, error: employeeError } = await tenantClient
      .from('Employees')
      .select('org_id')
      .eq('id', resolvedInstructorId)
      .maybeSingle();
    if (employeeError) throw employeeError;
    resolvedOrgId = employee?.org_id || null;
  }

  const rateDate = localDateKey(resolvedLessonDate || new Date());
  const rateRows = resolvedOrgId
    ? await loadRateHistoryRows(tenantClient, resolvedOrgId, {
      employeeIds: [resolvedInstructorId],
      payBases: [...LESSON_PAY_BASES],
    })
    : [];

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
      tenantClient.from('Employees').select('first_name, last_name').eq('id', resolvedInstructorId).maybeSingle(),
      tenantClient.from('Services').select('name').eq('id', resolvedServiceId).maybeSingle(),
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
