/**
 * Frontend currency utilities — mirrors the agorot convention from api/_shared/currency.js.
 * All monetary values in the DB and API layer are integers (agorot).
 * These helpers are for display and CSV export only.
 */

const AGOROT_PER_SHEKEL = 100;

/**
 * Convert an agorot integer to a shekel decimal number for display / export.
 * @param {number|null|undefined} agorot
 * @returns {number}
 */
export function toShekel(agorot) {
  return Number(agorot ?? 0) / AGOROT_PER_SHEKEL;
}

/**
 * Convert a shekel value (from user input or display) to an agorot integer.
 * Mirrors toAgorot from api/_shared/currency.js.
 * @param {unknown} value
 * @returns {number}
 */
export function toAgorot(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * AGOROT_PER_SHEKEL);
}

/**
 * Coerce a value to an integer agorot amount.
 * Safe for read-path display — returns 0 on bad input.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function coerceAgorot(value, fallback = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Validate a shekel string from user input before converting to agorot.
 * Returns true if the value is a finite positive number within the given max (agorot).
 * Gate API submissions with this — call toAgorot(value) on the same input before sending.
 *
 * @param {string|number} shekelString — raw user input (shekel units, e.g. "120")
 * @param {number} [maxAgorot] — default ₪100,000
 * @returns {boolean}
 */
export function isValidCurrencyInput(shekelString, maxAgorot = 10000000) {
  const agorot = toAgorot(shekelString);
  return Number.isFinite(agorot) && agorot > 0 && agorot <= maxAgorot;
}

/**
 * Format an agorot integer as a Hebrew-locale shekel string.
 * Divides by 100 internally — always pass raw agorot from the API/DB.
 * @param {number|null|undefined} agorot
 * @returns {string}
 */
export function formatCurrency(agorot) {
  if (agorot == null || Number.isNaN(Number(agorot))) return '—';
  return `₪${toShekel(agorot).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
