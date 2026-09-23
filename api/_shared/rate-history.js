/* eslint-env node */
/**
 * Dated pay rates. `RateHistory` is the single source of truth for every pay rate
 * (spec: implementations/business-process/payroll-prerequisites.md, P2).
 *
 * A row means "from `effective_date` until the next row of the same kind, this employee's rate is X".
 * `pay_basis` says what the number means:
 * - lesson_hourly      (service required) instructor pay per lesson hour for that service
 * - lesson_flat        (service required) instructor pay per lesson for that service, whatever its length
 * - attendance_hourly  (no service)       hourly pay for attended work hours
 * - monthly_salary     (no service)       monthly salary
 * - leave_day          (no service)       fixed value of a paid leave day
 *
 * Each calculation asks for exactly one kind; there is no fallback between kinds. Dates are
 * 'YYYY-MM-DD' keys produced by the caller (the same keys used for lesson_date elsewhere).
 */
import { normalizeString, withOrgScope } from './org-bff.js';
import { coerceAgorot } from './currency.js';
import { getDateKeyInTimezone } from './instructor-availability.js';

export const PAY_BASIS = Object.freeze({
  LESSON_HOURLY: 'lesson_hourly',
  LESSON_FLAT: 'lesson_flat',
  ATTENDANCE_HOURLY: 'attendance_hourly',
  MONTHLY_SALARY: 'monthly_salary',
  LEAVE_DAY: 'leave_day',
});

export const PAY_BASES = Object.freeze(new Set(Object.values(PAY_BASIS)));
export const LESSON_PAY_BASES = Object.freeze(new Set([PAY_BASIS.LESSON_HOURLY, PAY_BASIS.LESSON_FLAT]));

/** Whether the employee has any rate of this kind — what decides if that part of their pay exists. */
export function hasRateKind(rows, { employeeId, payBasis, onOrBefore = null } = {}) {
  const basis = normalizeString(payBasis).toLowerCase();
  if (!PAY_BASES.has(basis)) return false;
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeRateRow)
    .some((row) => row
      && row.employee_id === normalizeString(employeeId)
      && row.pay_basis === basis
      && (!onOrBefore || row.effective_date <= onOrBefore));
}

const RATE_HISTORY_COLUMNS = 'id, employee_id, service_id, pay_basis, rate, effective_date, created_at, notes, metadata';
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value) {
  return typeof value === 'string' && DATE_KEY_PATTERN.test(value);
}

/**
 * The date a rate is looked up for: a 'YYYY-MM-DD' key is used as is; a timestamp (for example a
 * lesson's datetime_start) becomes its calendar date in the scheduling timezone (Asia/Jerusalem),
 * so a rate "from 1.10" applies to a lesson at 00:30 on 1.10.
 */
export function toRateDateKey(value) {
  if (typeof value === 'string' && DATE_KEY_PATTERN.test(value.trim())) {
    return value.trim();
  }
  if (value == null || value === '') return '';
  return getDateKeyInTimezone(value) || '';
}

function sameService(rowServiceId, serviceId) {
  return normalizeString(rowServiceId) === normalizeString(serviceId);
}

// Latest effective_date wins; two rows on the same date resolve to the most recently created one.
function pickLatest(candidates) {
  let best = null;
  for (const row of candidates) {
    if (!best) {
      best = row;
      continue;
    }
    if (row.effective_date > best.effective_date) {
      best = row;
    } else if (row.effective_date === best.effective_date && String(row.created_at || '') > String(best.created_at || '')) {
      best = row;
    }
  }
  return best;
}

export function normalizeRateRow(row) {
  if (!row || typeof row !== 'object') return null;
  const payBasis = normalizeString(row.pay_basis).toLowerCase();
  const effectiveDate = normalizeString(row.effective_date).slice(0, 10);
  if (!PAY_BASES.has(payBasis) || !isDateKey(effectiveDate)) return null;
  return {
    id: row.id || null,
    employee_id: normalizeString(row.employee_id) || null,
    service_id: normalizeString(row.service_id) || null,
    pay_basis: payBasis,
    rate: coerceAgorot(row.rate),
    effective_date: effectiveDate,
    created_at: row.created_at || null,
    notes: row.notes ?? null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : null,
  };
}

function candidateRows(rows, { employeeId, date }) {
  if (!isDateKey(date)) return [];
  const normalizedEmployeeId = normalizeString(employeeId);
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeRateRow)
    .filter((row) => row
      && (!normalizedEmployeeId || row.employee_id === normalizedEmployeeId)
      && row.effective_date <= date);
}

/**
 * The rate row of one kind in effect on `date`, or null when none exists (never guessed).
 * Lesson kinds need `serviceId`; the other kinds only match rows without a service.
 */
export function resolveRateOnDate(rows, { employeeId = null, payBasis, serviceId = null, date } = {}) {
  const normalizedBasis = normalizeString(payBasis).toLowerCase();
  if (!PAY_BASES.has(normalizedBasis)) return null;
  const requiresService = LESSON_PAY_BASES.has(normalizedBasis);
  if (requiresService && !normalizeString(serviceId)) return null;
  return pickLatest(candidateRows(rows, { employeeId, date }).filter((row) => (
    row.pay_basis === normalizedBasis
    && (requiresService ? sameService(row.service_id, serviceId) : !row.service_id)
  )));
}

/**
 * The lesson rate (hourly or flat) in effect on `date` for an instructor and service, or null.
 * Only one lesson kind applies at a time: the most recent lesson row decides whether it's hourly or flat.
 */
export function resolveLessonRateOnDate(rows, { employeeId = null, serviceId, date } = {}) {
  if (!normalizeString(serviceId)) return null;
  return pickLatest(candidateRows(rows, { employeeId, date }).filter((row) => (
    LESSON_PAY_BASES.has(row.pay_basis) && sameService(row.service_id, serviceId)
  )));
}

/**
 * Validate a new rate before it is written. Returns `{ value }` or `{ error }` with a stable code.
 * Lesson kinds need a service; the other kinds must not carry one.
 */
export function validateRateInput({ employeeId, payBasis, serviceId = null, rate, effectiveDate } = {}) {
  const normalizedEmployeeId = normalizeString(employeeId);
  if (!normalizedEmployeeId) return { error: 'missing_employee_id' };

  const normalizedBasis = normalizeString(payBasis).toLowerCase();
  if (!PAY_BASES.has(normalizedBasis)) return { error: 'invalid_pay_basis' };

  const normalizedServiceId = normalizeString(serviceId) || null;
  if (LESSON_PAY_BASES.has(normalizedBasis) && !normalizedServiceId) return { error: 'missing_service_id' };
  if (!LESSON_PAY_BASES.has(normalizedBasis) && normalizedServiceId) return { error: 'service_not_allowed_for_pay_basis' };

  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate) || !Number.isInteger(numericRate) || numericRate < 0) return { error: 'invalid_rate' };

  const normalizedDate = normalizeString(effectiveDate);
  if (!isDateKey(normalizedDate)) return { error: 'invalid_effective_date' };

  return {
    value: {
      employeeId: normalizedEmployeeId,
      payBasis: normalizedBasis,
      serviceId: normalizedServiceId,
      rate: coerceAgorot(numericRate),
      effectiveDate: normalizedDate,
    },
  };
}

/**
 * What the office should be told before a rate is saved, and the rows it interacts with.
 * - effective_date_in_past: the rate applies to days that already happened.
 * - effective_date_before_current_rate: it slots in before the current rate and only applies until the next one.
 * - rate_exists_on_date: a rate of this kind already exists on that date (saving replaces it).
 */
export function buildRateChangeWarnings(rows, { employeeId, payBasis, serviceId = null, effectiveDate }, todayKey) {
  const isLesson = LESSON_PAY_BASES.has(normalizeString(payBasis).toLowerCase());
  const sameKind = (Array.isArray(rows) ? rows : [])
    .map(normalizeRateRow)
    .filter((row) => row
      && row.employee_id === normalizeString(employeeId)
      && (isLesson
        ? (LESSON_PAY_BASES.has(row.pay_basis) && sameService(row.service_id, serviceId))
        : (row.pay_basis === normalizeString(payBasis).toLowerCase() && !row.service_id)));

  const currentRate = pickLatest(sameKind.filter((row) => row.effective_date <= todayKey));
  const nextRate = sameKind
    .filter((row) => row.effective_date > todayKey)
    .sort((left, right) => left.effective_date.localeCompare(right.effective_date))[0] || null;
  const existingOnDate = sameKind.find((row) => row.effective_date === effectiveDate
    && (isLesson ? true : row.pay_basis === normalizeString(payBasis).toLowerCase())) || null;

  const warnings = [];
  if (isDateKey(effectiveDate) && isDateKey(todayKey) && effectiveDate < todayKey) {
    warnings.push('effective_date_in_past');
  }
  if (currentRate && isDateKey(effectiveDate) && effectiveDate < currentRate.effective_date) {
    warnings.push('effective_date_before_current_rate');
  }
  if (existingOnDate) {
    warnings.push('rate_exists_on_date');
  }

  return { warnings, currentRate, nextRate, existingOnDate, history: sameKind };
}

/** Load RateHistory rows for employees (optionally only some kinds). */
export async function loadRateHistoryRows(tenantClient, orgId, { employeeIds = [], payBases = null } = {}) {
  const ids = Array.from(new Set((employeeIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0 || !normalizeString(orgId)) return [];

  let query = withOrgScope(tenantClient, 'RateHistory', orgId)
    .select(RATE_HISTORY_COLUMNS)
    .in('employee_id', ids);
  const bases = Array.isArray(payBases) ? payBases.filter((basis) => PAY_BASES.has(basis)) : null;
  if (bases && bases.length > 0) {
    query = query.in('pay_basis', bases);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return (data || []).map(normalizeRateRow).filter(Boolean);
}
