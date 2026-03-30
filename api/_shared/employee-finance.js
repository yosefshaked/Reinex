/* eslint-env node */
import { isAdminOrOffice, normalizeString } from './org-bff.js';
import {
  buildCommitmentRuntime,
  computeCommitmentAttention,
} from './commitment-behavior.js';
import { attachHmoContextToCommitments } from './hmo.js';

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

export const ATTENDANCE_STATUSES = new Set(['present', 'partial', 'absent', 'remote']);
export const LEAVE_TYPES = new Set(['employee_paid', 'system_paid', 'unpaid', 'half_day']);
export const LEAVE_ENTRY_STATUSES = new Set(['approved', 'cancelled']);
export const LEAVE_DURATION_MODES = new Set(['full_day', 'half_day']);
export const HALF_DAY_PARTS = new Set(['first_half', 'second_half']);
export const PAYROLL_MODELS = new Set(['hourly', 'monthly_salary', 'lesson_based']);
export const FINANCE_CORRECTION_TYPES = new Set(['bonus', 'deduction', 'adjustment', 'correction']);
export const BILLING_SOURCE_TYPES = new Set(['lesson', 'transfer', 'adjustment']);
export const LEAVE_PAY_METHODS = new Set(['legal', 'avg_hourly_x_avg_day_hours', 'fixed_rate']);

const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isYmdDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeString(value));
}

export function toDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

export function addDays(dateKey, offsetDays) {
  const base = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return '';
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

export function enumerateDateRange(startDate, endDate) {
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  if (!startKey || !endKey || startKey > endKey) {
    return [];
  }

  const dates = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function startOfMonthKey(input) {
  const dateKey = toDateKey(input);
  if (!dateKey) return '';
  return `${dateKey.slice(0, 7)}-01`;
}

export function endOfMonthKey(input) {
  const dateKey = toDateKey(input);
  if (!dateKey) return '';
  const date = new Date(`${dateKey.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
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

export async function loadSettingsMap(tenantClient, keys = []) {
  const normalizedKeys = Array.from(new Set((keys || []).map((key) => normalizeString(key)).filter(Boolean)));
  if (normalizedKeys.length === 0) {
    return {};
  }

  const { data, error } = await tenantClient
    .from('Settings')
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

export async function loadFinancePolicies(tenantClient) {
  const settingsMap = await loadSettingsMap(tenantClient, [
    'leave_policy',
    'leave_pay_policy',
    'billing_consumption_policy',
    'instructor_earnings_policy',
  ]);

  return {
    leavePolicy: normalizeLeavePolicy(settingsMap.leave_policy),
    leavePayPolicy: normalizeLeavePayPolicy(settingsMap.leave_pay_policy),
    billingConsumptionPolicy: normalizeBooleanPolicy(settingsMap.billing_consumption_policy, DEFAULT_BILLING_CONSUMPTION_POLICY),
    instructorEarningsPolicy: normalizeBooleanPolicy(settingsMap.instructor_earnings_policy, DEFAULT_INSTRUCTOR_EARNINGS_POLICY),
  };
}

export async function resolveEmployeeRecord(tenantClient, { employeeId, userId, canManageAll = false }) {
  let query = tenantClient
    .from('Employees')
    .select('id, user_id, first_name, last_name, employee_type, payroll_model, current_rate, monthly_salary_amount, start_date, annual_leave_days, leave_pay_method, leave_fixed_day_rate, employment_scope, working_days')
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
    .select('employee_id, working_days, break_time_minutes, metadata')
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

export function resolveEmployeeWorkingDays(employee, profile = null) {
  const fromProfile = normalizeWorkingDays(profile?.working_days);
  if (fromProfile.length > 0) {
    return fromProfile;
  }

  const fromEmployee = normalizeWorkingDays(employee?.working_days);
  if (fromEmployee.length > 0) {
    return fromEmployee;
  }

  return [...DEFAULT_WORKING_DAYS];
}

export function countWorkingDaysInRange(workingDays, startDate, endDate) {
  const daySet = new Set(normalizeWorkingDays(workingDays).length > 0 ? normalizeWorkingDays(workingDays) : DEFAULT_WORKING_DAYS);
  return enumerateDateRange(startDate, endDate).reduce((count, dateKey) => {
    const dayOfWeek = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    return daySet.has(dayOfWeek) ? count + 1 : count;
  }, 0);
}

export function canManageEmployeeOps(role) {
  return isAdminOrOffice(role);
}

function startOfLookbackRange(targetDate, months) {
  const target = new Date(`${toDateKey(targetDate)}T00:00:00Z`);
  target.setUTCMonth(target.getUTCMonth() - months);
  return target.toISOString().slice(0, 10);
}

function coerceNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function groupRecordsByDate(records = []) {
  const grouped = new Map();
  for (const record of records) {
    const dateKey = toDateKey(record?.date || record?.effective_date || record?.attendance_date || record?.lesson_date);
    if (!dateKey) continue;
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, { amount: 0, hours: 0 });
    }
    const bucket = grouped.get(dateKey);
    bucket.amount += coerceNumber(record?.amount, 0);
    bucket.hours += coerceNumber(record?.hours, 0);
  }
  return grouped;
}

function computeAverageDayValue(records, targetDate, months) {
  const targetKey = toDateKey(targetDate);
  if (!targetKey) {
    return 0;
  }
  const rangeStart = startOfLookbackRange(targetKey, months);
  const grouped = groupRecordsByDate(records.filter((record) => {
    const dateKey = toDateKey(record?.date || record?.effective_date || record?.attendance_date || record?.lesson_date);
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
  profile = null,
  targetDate,
  lessonEarnings = [],
  attendanceRecords = [],
  leavePayPolicy = DEFAULT_LEAVE_PAY_POLICY,
}) {
  const payrollModel = normalizeString(employee?.payroll_model).toLowerCase();
  const method = resolveLeavePayMethod(employee, leavePayPolicy);

  if (method === 'fixed_rate') {
    const employeeRate = Number(employee?.leave_fixed_day_rate);
    if (Number.isFinite(employeeRate) && employeeRate >= 0) {
      return employeeRate;
    }
    return Number(leavePayPolicy.fixed_rate_default || 0);
  }

  if (payrollModel === 'monthly_salary') {
    const monthStart = startOfMonthKey(targetDate);
    const monthEnd = endOfMonthKey(targetDate);
    const workingDays = countWorkingDaysInRange(resolveEmployeeWorkingDays(employee, profile), monthStart, monthEnd);
    const monthlySalary = Number(employee?.monthly_salary_amount);
    if (Number.isFinite(monthlySalary) && monthlySalary > 0 && workingDays > 0) {
      return monthlySalary / workingDays;
    }
    return 0;
  }

  const historicalRecords = [
    ...(lessonEarnings || []).map((row) => ({
      date: row.lesson_date || row.created_at || row.datetime_start,
      amount: row.payout_amount,
      hours: row.duration_minutes ? Number(row.duration_minutes) / 60 : 0,
    })),
    ...(attendanceRecords || []).map((row) => ({
      date: row.attendance_date,
      amount: row.worked_minutes && Number.isFinite(Number(employee?.current_rate))
        ? (Number(row.worked_minutes) / 60) * Number(employee.current_rate)
        : 0,
      hours: row.worked_minutes ? Number(row.worked_minutes) / 60 : 0,
    })),
  ];

  const baseValue = computeAverageDayValue(historicalRecords, targetDate, leavePayPolicy.lookback_months || 3);
  if (method !== 'legal' || !leavePayPolicy.legal_allow_12m_if_better) {
    return roundCurrency(baseValue);
  }

  const twelveMonth = computeAverageDayValue(historicalRecords, targetDate, 12);
  return roundCurrency(Math.max(baseValue, twelveMonth));
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
  const dates = enumerateDateRange(startDate, endDate);
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
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
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
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  if (!employeeId || !startKey || !endKey) {
    return [];
  }

  const { data, error } = await tenantClient
    .from('employee_attendance_records')
    .select('id, employee_id, attendance_date, status, worked_minutes, notes, source_type, created_by, updated_by, created_at, updated_at, metadata')
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
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  if (!employeeId || !startKey || !endKey) {
    return [];
  }

  const { data, error } = await tenantClient
    .from('lesson_instances')
    .select('id, datetime_start, duration_minutes, status, service_id')
    .eq('instructor_employee_id', employeeId)
    .gte('datetime_start', `${startKey}T00:00:00`)
    .lte('datetime_start', `${endKey}T23:59:59`)
    .order('datetime_start', { ascending: true });

  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  return (data || []).filter((instance) => (
    instance.id !== excludeInstanceId
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

export async function upsertLeaveBalanceUsage(tenantClient, leaveDays, { leaveEntryId, employeeId, leaveType, notes, createdBy }) {
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

  const { data, error } = await tenantClient
    .from('employee_leave_balance_events')
    .insert(payload)
    .select('id, employee_id, leave_entry_id, leave_day_id, event_type, leave_type, quantity_days, effective_date, notes, created_by, created_at, metadata');

  if (error) {
    throw error;
  }

  return data || [];
}

export async function deleteLeaveArtifacts(tenantClient, leaveEntryId) {
  if (!leaveEntryId) return;
  await tenantClient
    .from('employee_leave_balance_events')
    .delete()
    .eq('leave_entry_id', leaveEntryId);

  await tenantClient
    .from('employee_leave_days')
    .delete()
    .eq('leave_entry_id', leaveEntryId);
}

export function computeLeaveSummary({ employee, balanceEvents = [], targetDate, leavePolicy = DEFAULT_LEAVE_POLICY }) {
  const year = Number(String(toDateKey(targetDate) || new Date().toISOString().slice(0, 10)).slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const annualLeaveDays = Number(employee?.annual_leave_days || 0);
  let quota = annualLeaveDays;
  const startDate = toDateKey(employee?.start_date);
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
    const effectiveDate = toDateKey(entry?.effective_date);
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

export async function fetchCommitmentsWithBalances(tenantClient, filters = {}) {
  let query = tenantClient
    .from('commitments')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters.studentId) {
    query = query.eq('student_id', filters.studentId);
  }
  if (filters.serviceId) {
    query = query.eq('service_id', filters.serviceId);
  }

  const { data: commitments, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  const commitmentIds = (commitments || []).map((row) => row.id);
  if (commitmentIds.length === 0) {
    return [];
  }

  const { data: ledgerRows, error: ledgerError } = await tenantClient
    .from('ledger_transactions')
    .select('id, commitment_id, transaction_type, usage_type, amount, source_ref, metadata')
    .in('commitment_id', commitmentIds);

  if (ledgerError && ledgerError.code !== '42P01') {
    throw ledgerError;
  }

  const creditSums = new Map();
  const debitSums = new Map();
  const entriesByCommitment = new Map();
  for (const row of ledgerRows || []) {
    if (!entriesByCommitment.has(row.commitment_id)) {
      entriesByCommitment.set(row.commitment_id, []);
    }
    entriesByCommitment.get(row.commitment_id).push(row);
    const amt = coerceNumber(row.amount, 0);
    if (row.transaction_type === 'CREDIT') {
      creditSums.set(row.commitment_id, (creditSums.get(row.commitment_id) || 0) + amt);
    } else {
      debitSums.set(row.commitment_id, (debitSums.get(row.commitment_id) || 0) + amt);
    }
  }

  const enrichedCommitments = await attachHmoContextToCommitments(tenantClient, commitments || []);

  return enrichedCommitments.map((commitment) => {
    const credits = roundCurrency(creditSums.get(commitment.id) || 0);
    const debits = roundCurrency(debitSums.get(commitment.id) || 0);
    const consumedAmount = debits;
    const remainingAmount = roundCurrency(credits - debits);
    const runtime = buildCommitmentRuntime(commitment, entriesByCommitment.get(commitment.id) || []);
    return {
      ...commitment,
      consumed_amount: consumedAmount,
      remaining_amount: remainingAmount,
      runtime: {
        ...runtime,
        attention: computeCommitmentAttention(commitment, runtime),
      },
    };
  });
}

export async function fetchLessonPendingBillingQueue(tenantClient, { startDate = '', endDate = '', studentId = '' } = {}) {
  let query = tenantClient
    .from('lesson_participants')
    .select('id, lesson_instance_id, student_id, participant_status, commitment_id, price_charged')
    .is('commitment_id', null)
    .order('id', { ascending: false });

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  const instanceIds = (data || []).map((row) => row.lesson_instance_id).filter(Boolean);
  if (instanceIds.length === 0) {
    return [];
  }

  const { data: instances, error: instancesError } = await tenantClient
    .from('lesson_instances')
    .select('id, datetime_start, service_id, status')
    .in('id', instanceIds);

  if (instancesError) {
    throw instancesError;
  }

  const instanceMap = new Map((instances || []).map((row) => [row.id, row]));
  return (data || []).filter((row) => {
    const instance = instanceMap.get(row.lesson_instance_id);
    if (!instance) return false;
    const dateKey = toDateKey(instance.datetime_start);
    if (startDate && dateKey < startDate) return false;
    if (endDate && dateKey > endDate) return false;
    return true;
  }).map((row) => ({
    ...row,
    lesson_instance: instanceMap.get(row.lesson_instance_id) || null,
  }));
}

export async function syncLessonInstructorEarnings(
  tenantClient,
  lessonInstanceId,
  actorUserId = null,
  { instance = null, participants = null, policies = null } = {},
) {
  void actorUserId;
  let resolvedInstance = instance;
  if (!resolvedInstance) {
    const { data: instanceData, error: instanceError } = await tenantClient
      .from('lesson_instances')
      .select('id, instructor_employee_id, service_id, duration_minutes, status, datetime_start')
      .eq('id', lessonInstanceId)
      .maybeSingle();

    if (instanceError) {
      throw instanceError;
    }
    if (!instanceData) {
      return null;
    }
    resolvedInstance = instanceData;
  }

  let resolvedParticipants = participants;
  if (!resolvedParticipants) {
    const { data: participantRows, error: participantsError } = await tenantClient
      .from('lesson_participants')
      .select('id, student_id, participant_status, commitment_id, price_charged, attendance_confirmed_at')
      .eq('lesson_instance_id', lessonInstanceId);

    if (participantsError) {
      throw participantsError;
    }
    resolvedParticipants = participantRows || [];
  }

  const resolvedPolicies = policies || await loadFinancePolicies(tenantClient);
  const shouldInstructorEarn = resolvedInstance.status === 'completed'
    && (resolvedParticipants || []).some((participant) => resolvedPolicies.instructorEarningsPolicy[normalizeString(participant.participant_status).toLowerCase()]);

  if (!shouldInstructorEarn || !resolvedInstance.instructor_employee_id) {
    const { error: deleteError } = await tenantClient
      .from('lesson_earnings')
      .delete()
      .eq('lesson_instance_id', lessonInstanceId);

    if (deleteError && deleteError.code !== '42P01') {
      throw deleteError;
    }

    return {
      lesson_instance_id: lessonInstanceId,
      instructor_earned: false,
    };
  }

  const { data: capability, error: capabilityError } = await tenantClient
    .from('instructor_service_capabilities')
    .select('base_rate')
    .eq('employee_id', resolvedInstance.instructor_employee_id)
    .eq('service_id', resolvedInstance.service_id)
    .maybeSingle();

  if (capabilityError && capabilityError.code !== '42P01') {
    throw capabilityError;
  }

  const rateUsed = Number.isFinite(Number(capability?.base_rate)) ? Number(capability.base_rate) : 0;
  const payoutAmount = roundCurrency(rateUsed * (Number(resolvedInstance.duration_minutes || 0) / 60));
  const { error: earningError } = await tenantClient
    .from('lesson_earnings')
    .upsert({
      employee_id: resolvedInstance.instructor_employee_id,
      lesson_instance_id: lessonInstanceId,
      rate_used: rateUsed,
      payout_amount: payoutAmount,
      metadata: {
        service_id: resolvedInstance.service_id,
        lesson_date: toDateKey(resolvedInstance.datetime_start),
        policy_snapshot: {
          instructor_earnings_policy: resolvedPolicies.instructorEarningsPolicy,
        },
      },
    }, { onConflict: 'employee_id,lesson_instance_id' });

  if (earningError) {
    throw earningError;
  }

  return {
    lesson_instance_id: lessonInstanceId,
    instructor_earned: true,
    payout_amount: payoutAmount,
  };
}

export async function syncLessonFinancialArtifacts(tenantClient, lessonInstanceId, actorUserId = null) {
  if (!lessonInstanceId) {
    return null;
  }

  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .select('id, instructor_employee_id, service_id, duration_minutes, status, datetime_start')
    .eq('id', lessonInstanceId)
    .maybeSingle();

  if (instanceError) {
    throw instanceError;
  }
  if (!instance) {
    return null;
  }

  const { data: participants, error: participantsError } = await tenantClient
    .from('lesson_participants')
    .select('id, student_id, participant_status, commitment_id, price_charged, attendance_confirmed_at')
    .eq('lesson_instance_id', lessonInstanceId);

  if (participantsError) {
    throw participantsError;
  }

  const policies = await loadFinancePolicies(tenantClient);
  const commitmentIds = Array.from(new Set((participants || []).map((row) => row.commitment_id).filter(Boolean)));
  const { data: commitments, error: commitmentsError } = commitmentIds.length > 0
    ? await tenantClient
      .from('commitments')
      .select('id, student_id, service_id, default_charge_amount')
      .in('id', commitmentIds)
    : { data: [], error: null };

  if (commitmentsError) {
    throw commitmentsError;
  }

  const commitmentMap = new Map((commitments || []).map((row) => [row.id, row]));

  for (const participant of participants || []) {
    const commitment = participant.commitment_id ? commitmentMap.get(participant.commitment_id) || null : null;
    const derivedCharge = commitment
      ? (Number.isFinite(Number(commitment.default_charge_amount)) ? Number(commitment.default_charge_amount) : null)
      : null;

    if (derivedCharge !== participant.price_charged) {
      await tenantClient
        .from('lesson_participants')
        .update({
          price_charged: derivedCharge,
          attendance_confirmed_at: participant.participant_status !== 'scheduled'
            ? (participant.attendance_confirmed_at || new Date().toISOString())
            : participant.attendance_confirmed_at,
          attendance_confirmed_by: actorUserId || null,
        })
        .eq('id', participant.id);
    }

    const statusKey = normalizeString(participant.participant_status).toLowerCase();
    const shouldCharge = Boolean(
      commitment
      && derivedCharge != null
      && instance.status !== 'cancelled_clinic'
      && policies.billingConsumptionPolicy[statusKey]
    );

    if (shouldCharge) {
      const payload = {
        student_id: participant.student_id,
        commitment_id: commitment.id,
        transaction_type: 'DEBIT',
        usage_type: 'standard',
        amount: derivedCharge,
        source_ref: participant.id,
        notes: null,
        metadata: {
          participant_status: statusKey,
          lesson_instance_id: lessonInstanceId,
          effective_date: toDateKey(instance.datetime_start),
        },
      };

      const { error: upsertError } = await tenantClient
        .from('ledger_transactions')
        .upsert(payload, { onConflict: 'source_ref,usage_type' });

      if (upsertError) {
        throw upsertError;
      }
    } else {
      const { error: deleteError } = await tenantClient
        .from('ledger_transactions')
        .delete()
        .eq('source_ref', participant.id)
        .in('usage_type', ['standard', 'double', 'cross_service']);

      if (deleteError && deleteError.code !== '42P01') {
        throw deleteError;
      }
    }
  }

  return syncLessonInstructorEarnings(tenantClient, lessonInstanceId, actorUserId, {
    instance,
    participants,
    policies,
  });
}

/**
 * Auto-sync instructor attendance when lessons are completed.
 * Upserts an employee_attendance_records row with source_type='system',
 * summing worked_minutes from all completed lessons for that instructor on that date.
 * Respects existing manual attendance: does not overwrite manual/import entries.
 */
export async function syncInstructorAttendanceFromLessons(
  tenantClient,
  lessonInstanceId,
  actorUserId = null,
) {
  if (!lessonInstanceId) {
    return null;
  }

  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .select('id, instructor_employee_id, datetime_start, duration_minutes, status')
    .eq('id', lessonInstanceId)
    .maybeSingle();

  if (instanceError) {
    throw instanceError;
  }
  if (!instance || !instance.instructor_employee_id) {
    return null;
  }

  const lessonDate = toDateKey(instance.datetime_start);
  if (!lessonDate) {
    return null;
  }

  // Check if a manual/import attendance record already exists for this employee+date.
  // If so, do not overwrite — manual entries take precedence.
  const { data: existingRecord, error: existingError } = await tenantClient
    .from('employee_attendance_records')
    .select('id, source_type')
    .eq('employee_id', instance.instructor_employee_id)
    .eq('attendance_date', lessonDate)
    .maybeSingle();

  if (existingError && existingError.code !== '42P01') {
    throw existingError;
  }

  if (existingRecord && existingRecord.source_type !== 'system') {
    // Manual or import entry exists — do not overwrite
    return { employee_id: instance.instructor_employee_id, attendance_date: lessonDate, skipped: true };
  }

  // Sum worked minutes from all completed lessons for this instructor on this date
  const dayStart = `${lessonDate}T00:00:00`;
  const dayEnd = `${lessonDate}T23:59:59`;
  const { data: dayLessons, error: dayLessonsError } = await tenantClient
    .from('lesson_instances')
    .select('id, duration_minutes, status')
    .eq('instructor_employee_id', instance.instructor_employee_id)
    .gte('datetime_start', dayStart)
    .lte('datetime_start', dayEnd);

  if (dayLessonsError) {
    throw dayLessonsError;
  }

  const completedLessons = (dayLessons || []).filter((l) => l.status === 'completed');

  if (completedLessons.length === 0) {
    // No completed lessons — remove system attendance record if it exists
    if (existingRecord && existingRecord.source_type === 'system') {
      await tenantClient
        .from('employee_attendance_records')
        .delete()
        .eq('id', existingRecord.id);
    }
    return { employee_id: instance.instructor_employee_id, attendance_date: lessonDate, removed: true };
  }

  const totalWorkedMinutes = completedLessons.reduce(
    (sum, l) => sum + (Number(l.duration_minutes) || 0), 0
  );

  const { error: upsertError } = await tenantClient
    .from('employee_attendance_records')
    .upsert({
      employee_id: instance.instructor_employee_id,
      attendance_date: lessonDate,
      status: 'present',
      worked_minutes: totalWorkedMinutes,
      source_type: 'system',
      notes: `${completedLessons.length} שיעורים הושלמו`,
      updated_by: actorUserId || null,
      updated_at: new Date().toISOString(),
      metadata: {
        lesson_count: completedLessons.length,
        lesson_ids: completedLessons.map((l) => l.id),
      },
    }, { onConflict: 'employee_id,attendance_date' });

  if (upsertError) {
    throw upsertError;
  }

  return {
    employee_id: instance.instructor_employee_id,
    attendance_date: lessonDate,
    worked_minutes: totalWorkedMinutes,
    lesson_count: completedLessons.length,
  };
}

/**
 * Validates that the instructor has a base_rate configured for the lesson's service.
 * Returns null when valid.
 * Returns { code, instructor_employee_id, service_id } when validation fails.
 *
 * Call this BEFORE marking a lesson completed or recording attendance, so the user
 * can be told exactly what to fix before proceeding.
 */
export async function validateInstructorRateForLesson(
  tenantClient,
  { lessonInstanceId, instructorEmployeeId, serviceId } = {},
) {
  let resolvedInstructorId = instructorEmployeeId || null;
  let resolvedServiceId = serviceId || null;

  if ((!resolvedInstructorId || !resolvedServiceId) && lessonInstanceId) {
    const { data: instance, error: instanceError } = await tenantClient
      .from('lesson_instances')
      .select('instructor_employee_id, service_id')
      .eq('id', lessonInstanceId)
      .maybeSingle();

    if (instanceError) throw instanceError;
    resolvedInstructorId = resolvedInstructorId || instance?.instructor_employee_id || null;
    resolvedServiceId = resolvedServiceId || instance?.service_id || null;
  }

  // If either is missing there is nothing to validate — downstream will handle it
  if (!resolvedInstructorId || !resolvedServiceId) {
    return null;
  }

  const { data: capability, error: capabilityError } = await tenantClient
    .from('instructor_service_capabilities')
    .select('base_rate')
    .eq('employee_id', resolvedInstructorId)
    .eq('service_id', resolvedServiceId)
    .maybeSingle();

  if (capabilityError && capabilityError.code !== '42P01') {
    throw capabilityError;
  }

  // A base_rate of 0 is explicitly valid (volunteer / zero-rate service).
  // Only a missing row or an explicit null base_rate is a configuration error.
  if (!capability || capability.base_rate == null) {
    return {
      code: 'instructor_rate_not_configured',
      instructor_employee_id: resolvedInstructorId,
      service_id: resolvedServiceId,
    };
  }

  return null;
}
