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
