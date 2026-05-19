// @ts-check
/* eslint-env node */

/**
 * Currency helpers — all monetary values are stored and computed in agorot (1 ₪ = 100 agorot).
 * Convert at API boundaries only; internal logic always works with integers.
 */

const AGOROT_PER_SHEKEL = 100;

/**
 * Convert a shekel value (from request body or legacy data) to an agorot integer.
 * Rounds half-up to the nearest agora.
 * @param {unknown} value
 * @returns {number} non-negative integer in agorot, or 0 on bad input
 */
export function toAgorot(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * AGOROT_PER_SHEKEL);
}

/**
 * Convert an agorot integer to a shekel decimal for display / API responses.
 * @param {unknown} value
 * @returns {number}
 */
export function toShekel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n / AGOROT_PER_SHEKEL;
}

/**
 * Assert that a value is a valid agorot integer (finite, integer, >= 0).
 * Throws a descriptive Error on failure — never returns NaN or negative values.
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number}
 */
export function assertAgorot(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid agorot value for "${fieldName}": ${value}`);
  }
  return n;
}

/**
 * Like assertAgorot but also allows null/undefined (returns null).
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number|null}
 */
export function assertAgorotNullable(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return assertAgorot(value, fieldName);
}

/**
 * Coerce an agorot value from DB (already integer, but may arrive as string/float due to JSON).
 * Returns 0 on bad input — safe for read-path aggregations.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function coerceAgorot(value, fallback = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Configurable ceilings for financial amounts (all in agorot).
 * Guards against accidental or malicious extreme values.
 */
export const FINANCE_LIMITS = Object.freeze({
  /** Maximum single payroll adjustment: 100,000 ₪ = 10,000,000 agorot */
  MAX_ADJUSTMENT_AGOROT: 10_000_000,
  /** Maximum hourly rate: 5,000 ₪ = 500,000 agorot */
  MAX_HOURLY_RATE_AGOROT: 500_000,
  /** Maximum charge amount per lesson: 10,000 ₪ = 1,000,000 agorot */
  MAX_CHARGE_AMOUNT_AGOROT: 1_000_000,
});

/**
 * Billing attention thresholds — extracted so they are easy to locate
 * and eventually move into org-level settings.
 */
export const BILLING_THRESHOLDS = Object.freeze({
  /** Days before expiry to flag "expiring soon" */
  EXPIRING_SOON_DAYS: 30,
  /** Remaining-lessons count below which a commitment is flagged "low balance" */
  LOW_BALANCE_LESSONS: 2,
});
