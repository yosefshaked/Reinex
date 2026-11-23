// Why a manual leave-balance change was made. Every new carry-over or adjustment carries one of
// these reasons (stored as metadata.reason); "other" needs free text, kept in the row's notes.
export const BALANCE_REASONS = Object.freeze({
  previous_system: 'מעבר מהמערכת הקודמת',
  agreed_with_employee: 'סוכם עם העובד/ת',
  mistake_correction: 'תיקון טעות',
  other: 'אחר',
});

export const OFFERED_BALANCE_EVENT_TYPES = Object.freeze(['carryover', 'adjustment']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reads the reason of a new manual balance change from the request body: `reason` (a key of
 * BALANCE_REASONS) and `notes` (free text; required for "other"). Returns { reason, notes } or
 * { error } with a stable code.
 */
export function readBalanceReason(body) {
  const reason = text(body?.reason);
  if (!Object.prototype.hasOwnProperty.call(BALANCE_REASONS, reason)) {
    return { error: 'missing_balance_reason' };
  }
  const notes = text(body?.notes);
  if (reason === 'other' && !notes) {
    return { error: 'missing_balance_reason_text' };
  }
  return { reason, notes: notes || null };
}
