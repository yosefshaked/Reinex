/* eslint-env node */
/**
 * An employee's own way of valuing a leave day is a dated setting: a version from a date until the
 * next one (dated-settings.js, key `leave_pay_method`, one row per employee and date in
 * "SettingsHistory"). A leave day is valued by the version in force on that day, so changing it
 * never re-values leave that was already paid. No version in force (or a version saying "follow the
 * organisation") means the organisation's leave_pay_policy in force on that day.
 */
import { normalizeString } from './org-bff.js';
import { isDateKey } from './local-time.js';

export const EMPLOYEE_LEAVE_PAY_METHODS = Object.freeze(['legal', 'avg_hourly_x_avg_day_hours', 'fixed_rate']);

/**
 * Checks a version about to be written. `method` null / '' = follow the organisation.
 * Returns { value: { method, effectiveDate } } or { error } (invalid_leave_pay_method,
 * missing_effective_date, invalid_effective_date).
 */
export function validateLeavePayMethodVersion({ method, effectiveDate } = {}) {
  const raw = normalizeString(method).toLowerCase();
  if (raw && !EMPLOYEE_LEAVE_PAY_METHODS.includes(raw)) return { error: 'invalid_leave_pay_method' };
  const date = normalizeString(effectiveDate);
  if (!date) return { error: 'missing_effective_date' };
  if (!isDateKey(date)) return { error: 'invalid_effective_date' };
  return { value: { method: raw || null, effectiveDate: date } };
}

/** A stored version as the screen reads it. */
export function leavePayMethodVersionView(row) {
  return {
    effective_date: row.effective_date,
    method: normalizeString(row?.settings_value?.method).toLowerCase() || null,
    notes: row.notes ?? null,
    created_at: row.created_at ?? null,
  };
}
