// The duplicate-check failure path of the documents screens, and the locked-correction message
// (docs/project-rules/20, "Showing an error"): what the user reads, and the copy for support.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DUPLICATE_CHECK_FAILED_MESSAGE,
  DUPLICATE_CHECK_OFFLINE_MESSAGE,
  DUPLICATE_CHECK_TOAST_ID,
  DUPLICATE_CHECK_UNAUTHORIZED_MESSAGE,
  duplicateCheckFailureResult,
  reportDuplicateCheckFailure,
} from '../src/features/students/api/duplicate-check-result.js';
import { CORRECTION_ERROR_FALLBACK, resolveCorrectionErrorMessage } from '../src/features/calendar/utils/correctionErrorMessage.js';
import {
  createNetworkError,
  createSupportAwareApiError,
  describeError,
  formatErrorDetailsForCopy,
  stripSupportCode,
} from '../src/lib/error-support.js';

const CODE = 'ERR-20261125-DUP001';
const FORBIDDEN = 'אין לך הרשאה לבצע בדיקה זו';

function fakeToast() {
  const calls = [];
  return {
    calls,
    error: (message, data) => calls.push({ kind: 'error', message, data }),
    apiError: (error, options) => calls.push({ kind: 'apiError', error, options }),
  };
}

function abortError() {
  // What fetch throws when the screen aborts the request.
  return new DOMException('The user aborted a request.', 'AbortError');
}

describe('duplicate check: a failed check is reported and can be told apart from no duplicates', () => {
  it('a 500 without a support code: the check did not complete, with details and copy', () => {
    const toast = fakeToast();
    const error = createSupportAwareApiError({ message: 'failed_to_check_duplicates' }, 500);
    const result = reportDuplicateCheckFailure(error, { toast, forbiddenMessage: FORBIDDEN });
    assert.deepEqual(result, { has_duplicates: false, duplicates: [], check_failed: true, failure_kind: 'failed' });
    assert.equal(toast.calls.length, 1);
    const [call] = toast.calls;
    assert.equal(call.kind, 'apiError');
    assert.equal(call.error, error, 'the error object itself reaches the toast');
    assert.equal(call.options.id, DUPLICATE_CHECK_TOAST_ID, 'one toast for all files of an upload');
    assert.equal(call.options.fallback, DUPLICATE_CHECK_FAILED_MESSAGE);
    const details = describeError(call.error, { action: call.options.action, fallback: call.options.fallback });
    assert.equal(details.message, `${DUPLICATE_CHECK_FAILED_MESSAGE} (failed_to_check_duplicates)`);
    const copied = formatErrorDetailsForCopy(details);
    assert.ok(copied.includes('פעולה: בדיקת כפילויות'));
    assert.ok(copied.includes('סטטוס HTTP: 500'));
  });

  it('a 500 with a saved support code keeps it as a separate field', () => {
    const toast = fakeToast();
    const error = createSupportAwareApiError({ message: 'failed_to_check_duplicates', error_id: CODE }, 500);
    reportDuplicateCheckFailure(error, { toast, forbiddenMessage: FORBIDDEN });
    const { options } = toast.calls[0];
    const details = describeError(error, { action: options.action, fallback: options.fallback });
    assert.equal(details.supportCode, CODE);
    assert.ok(details.message.endsWith('(failed_to_check_duplicates)'));
    assert.ok(formatErrorDetailsForCopy(details).includes(`קוד תמיכה: ${CODE}`));
  });

  it('a network failure says the check did not run, and the copy carries that title', () => {
    const toast = fakeToast();
    const result = reportDuplicateCheckFailure(createNetworkError(new TypeError('Failed to fetch')), { toast, forbiddenMessage: FORBIDDEN });
    assert.equal(result.check_failed, true);
    const { options, error } = toast.calls[0];
    assert.equal(options.message, DUPLICATE_CHECK_OFFLINE_MESSAGE);
    // toast.apiError puts this title on the screen and into ErrorDetails, so the copy matches it.
    const details = { ...describeError(error, { action: options.action, fallback: options.fallback }), message: options.message };
    assert.ok(formatErrorDetailsForCopy(details).startsWith(`פרטי שגיאה לתמיכה\nהודעה: ${DUPLICATE_CHECK_OFFLINE_MESSAGE}`));
    assert.equal(details.status, null);
  });

  it('401 and 403 keep the existing messages; a cancel stays silent and is not a failure', () => {
    const toast = fakeToast();
    assert.equal(reportDuplicateCheckFailure(createSupportAwareApiError({}, 401), { toast, forbiddenMessage: FORBIDDEN }).check_failed, true);
    assert.equal(reportDuplicateCheckFailure(createSupportAwareApiError({ message: 'forbidden' }, 403), { toast, forbiddenMessage: FORBIDDEN }).failure_kind, 'forbidden');
    const cancelled = reportDuplicateCheckFailure(abortError(), { toast, forbiddenMessage: FORBIDDEN });
    assert.deepEqual(toast.calls.map((call) => [call.kind, call.message]), [
      ['error', DUPLICATE_CHECK_UNAUTHORIZED_MESSAGE],
      ['error', FORBIDDEN],
    ]);
    assert.equal(cancelled.check_failed, false);
    assert.equal(cancelled.failure_kind, 'cancelled');
  });

  it('the failure result keeps the shape of a successful check, so uploads are not blocked', () => {
    const result = duplicateCheckFailureResult(createSupportAwareApiError({}, 500));
    assert.equal(result.has_duplicates, false);
    assert.deepEqual(result.duplicates, []);
    const success = { has_duplicates: false, duplicates: [] };
    assert.notEqual(result.check_failed === true, success.check_failed === true, 'a caller can tell them apart');
  });
});

describe('locked correction: participants that need attention keep their business detail', () => {
  const names = new Map([['p1', 'דנה כהן'], ['p2', 'יואב לוי']]);

  it('an unmapped code with participant names: Hebrew title, public code, then the names', () => {
    const error = createSupportAwareApiError({ message: 'participants_need_review', details: { participant_ids: ['p1', 'p2'] } }, 409);
    assert.equal(
      resolveCorrectionErrorMessage(error, names),
      `${CORRECTION_ERROR_FALLBACK} (participants_need_review) משתתפים שדורשים טיפול: דנה כהן, יואב לוי.`,
    );
  });

  it('unknown participants are counted instead of named', () => {
    const error = createSupportAwareApiError({ message: 'participants_need_review', details: { participant_ids: ['x', 'y', 'z'] } }, 409);
    assert.equal(resolveCorrectionErrorMessage(error, names), `${CORRECTION_ERROR_FALLBACK} (participants_need_review) 3 משתתפים דורשים טיפול.`);
  });

  it('a saved support code is appended; the public code stays in the title; the copy matches the screen', () => {
    const error = createSupportAwareApiError({ message: 'participants_need_review', error_id: CODE, details: { participant_ids: ['p1'] } }, 500);
    const text = resolveCorrectionErrorMessage(error, names);
    assert.equal(text, `${CORRECTION_ERROR_FALLBACK} (participants_need_review) משתתפים שדורשים טיפול: דנה כהן. קוד תמיכה: ${CODE}`);
    // The panel shows the text (the Alert lifts the support code into its chip) and passes the text
    // without the code to ErrorDetails as `message`.
    const shown = stripSupportCode(text);
    const copied = formatErrorDetailsForCopy({ ...describeError(error, { fallback: CORRECTION_ERROR_FALLBACK }), message: shown });
    assert.ok(copied.includes(`הודעה: ${shown}`));
    assert.ok(copied.includes(`קוד תמיכה: ${CODE}`));
    assert.ok(copied.includes('קוד שגיאה: participants_need_review'));
  });

  it('known codes keep their dedicated text with the names', () => {
    const error = createSupportAwareApiError({ message: 'cancelled_instance_has_attended_participants', details: { participant_ids: ['p1'] } }, 409);
    assert.equal(resolveCorrectionErrorMessage(error, names), 'לא ניתן לסמן את השיעור כמבוטל כל עוד יש משתתפים שסומנו כנוכחים: דנה כהן.');
  });

  it('no raw code prefix and no technical text', () => {
    const error = createSupportAwareApiError({ message: 'duplicate key value violates "x_pkey"', details: { participant_ids: ['p1'] } }, 500);
    const text = resolveCorrectionErrorMessage(error, names);
    assert.ok(!text.includes('duplicate key'));
    assert.equal(text, `${CORRECTION_ERROR_FALLBACK} (HTTP 500) משתתפים שדורשים טיפול: דנה כהן.`);
  });
});
