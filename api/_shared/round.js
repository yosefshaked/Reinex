/**
 * Rounding for values that are NOT money (day counts, file sizes). Money is converted and rounded
 * only through the currency helpers (api/_shared/currency.js, src/lib/currency.js); the
 * `no-restricted-syntax` rule in eslint.config.js flags a hand-written `* 100` / `/ 100`.
 */

/**
 * Round a number to 2 decimals (e.g. 1.005 -> 1.01 is not guaranteed; same as Math.round(x * 100) / 100).
 * @param {number} value
 * @returns {number}
 */
export function roundTo2(value) {
  return Math.round(value * 100) / 100;
}
