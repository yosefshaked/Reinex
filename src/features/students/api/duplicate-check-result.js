/**
 * What a documents screen returns and tells the user when the duplicate check fails
 * (student, instructor and organisation documents share it).
 *
 * The result keeps the shape of a successful check, so uploads behave as before (a failed check
 * does not block the upload), and adds `check_failed`, so a caller can tell a failed check apart
 * from a check that found no duplicates.
 */

import { isNetworkError } from '../../../lib/error-support.js';

export const DUPLICATE_CHECK_TOAST_ID = 'duplicate-check-failed';
export const DUPLICATE_CHECK_ACTION = 'בדיקת כפילויות';
export const DUPLICATE_CHECK_FAILED_MESSAGE = 'בדיקת הכפילויות לא הושלמה. הקבצים יועלו בלי בדיקת כפילויות.';
export const DUPLICATE_CHECK_UNAUTHORIZED_MESSAGE = 'שגיאת הרשאה. נא להתחבר מחדש';
export const DUPLICATE_CHECK_OFFLINE_MESSAGE = 'בדיקת הכפילויות לא הושלמה כי אין חיבור לשרת. הקבצים יועלו בלי בדיקת כפילויות.';

/** 'cancelled' (the screen aborted it), 'unauthorized' (401), 'forbidden' (403) or 'failed'. */
export function classifyDuplicateCheckFailure(error) {
  if (error?.name === 'AbortError') return 'cancelled';
  if (error?.status === 401) return 'unauthorized';
  if (error?.status === 403) return 'forbidden';
  return 'failed';
}

/** The result a screen returns from its check when it failed. */
export function duplicateCheckFailureResult(error) {
  const failureKind = classifyDuplicateCheckFailure(error);
  return {
    has_duplicates: false,
    duplicates: [],
    check_failed: failureKind !== 'cancelled',
    failure_kind: failureKind,
  };
}

/**
 * Tells the user what happened, through the screen's toast, and returns the failure result.
 * A cancelled check is silent. 401 and 403 keep the screen's existing messages. Anything else
 * (a network failure, a 500 with or without a support code) shows that the check did not complete,
 * with "פירוט השגיאה" and "העתקה לשליחה לתמיכה". All files of one upload share one toast.
 */
export function reportDuplicateCheckFailure(error, { toast, forbiddenMessage }) {
  const result = duplicateCheckFailureResult(error);
  if (result.failure_kind === 'unauthorized') {
    toast.error(DUPLICATE_CHECK_UNAUTHORIZED_MESSAGE);
  } else if (result.failure_kind === 'forbidden') {
    toast.error(forbiddenMessage);
  } else if (result.failure_kind === 'failed') {
    toast.apiError(error, {
      id: DUPLICATE_CHECK_TOAST_ID,
      action: DUPLICATE_CHECK_ACTION,
      fallback: DUPLICATE_CHECK_FAILED_MESSAGE,
      // A request with no response gets its own title, so the user still learns the check did not run.
      ...(isNetworkError(error) ? { message: DUPLICATE_CHECK_OFFLINE_MESSAGE } : {}),
    });
  }
  return result;
}
