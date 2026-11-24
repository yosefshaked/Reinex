// What the user reads, sees under "פירוט השגיאה" and copies for support when something fails
// (docs/project-rules/20, "The product speaks Hebrew" and "Showing an error").
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NETWORK_ERROR_MESSAGE,
  buildApiErrorMessage,
  buildUserErrorMessage,
  createNetworkError,
  createSupportAwareApiError,
  describeError,
  errorDetailRows,
  formatErrorDetailsForCopy,
  publicErrorCodeFromPayload,
  resolveApiErrorMessage,
  resolveUserErrorMessage,
  withErrorContext,
} from '../src/lib/error-support.js';

const HEBREW = /[֐-׿]/;
const CODE = 'ERR-20261124-ABC123';
const AT = '2026-11-24T16:05:00.000Z';

describe('the message a user reads after a failed API call', () => {
  it('a saved 5xx keeps the public code in the title, and the support code as a separate field', () => {
    assert.equal(
      buildUserErrorMessage({ message: 'failed_to_update_lesson_template', error_id: CODE }, 500),
      `הפעולה נכשלה. נסו שוב בעוד כמה דקות. (failed_to_update_lesson_template) קוד תמיכה: ${CODE}`,
    );
  });

  it('a known code shows only its Hebrew explanation', () => {
    assert.equal(buildUserErrorMessage({ message: 'forbidden' }, 403), 'אין לכם הרשאה לבצע את הפעולה.');
  });

  it('an unmapped code shows a general Hebrew message and the public code in parentheses', () => {
    const text = buildUserErrorMessage({ message: 'failed_to_update_lesson_template' }, 500);
    assert.ok(HEBREW.test(text));
    assert.ok(text.endsWith('(failed_to_update_lesson_template)'), text);
    assert.ok(!text.includes('ERR-'));
  });

  it('with no public code, only the HTTP status is shown; nothing is invented', () => {
    assert.ok(buildUserErrorMessage({}, 500).endsWith('(HTTP 500)'));
    assert.ok(buildUserErrorMessage(null, 502).endsWith('(HTTP 502)'));
    assert.ok(buildUserErrorMessage({ message: 'Something went wrong on the server' }, 400).endsWith('(HTTP 400)'));
  });

  it('raw technical server text is never shown or treated as a public code', () => {
    const payload = { message: 'duplicate key value violates unique constraint "students_pkey"', details: 'Key (id)=(1) already exists.' };
    const text = buildUserErrorMessage(payload, 500);
    assert.ok(!text.includes('duplicate key'));
    assert.ok(!text.includes('Key (id)'));
    assert.equal(publicErrorCodeFromPayload(payload), '');
    assert.equal(publicErrorCodeFromPayload({ details: 'some_code_like_text' }), '', 'details is never a public code');
  });

  it('a Hebrew message from the server is shown as it is', () => {
    assert.equal(buildUserErrorMessage({ message: 'השיעור כבר בוטל.' }, 409), 'השיעור כבר בוטל.');
  });

  it('a Hebrew fallback replaces the general message', () => {
    assert.equal(buildUserErrorMessage({}, 500, 'טעינת המסמכים נכשלה.'), 'טעינת המסמכים נכשלה. (HTTP 500)');
  });
});

describe('the error object keeps what code consumers rely on', () => {
  it('an unmapped 4xx code stays in error.message for consumers that branch on it', () => {
    const error = createSupportAwareApiError({ message: 'invitation_already_pending' }, 409);
    assert.equal(error.message, 'invitation_already_pending');
    assert.equal(buildApiErrorMessage({ message: 'invitation_already_pending' }, 409), 'invitation_already_pending');
    assert.equal(error.code, 'invitation_already_pending');
    assert.equal(error.publicCode, 'invitation_already_pending');
    assert.equal(resolveUserErrorMessage(error), 'הפעולה לא הושלמה. בדקו את הפרטים ונסו שוב. (invitation_already_pending)');
  });

  it('a 5xx without a support code keeps its status and codes', () => {
    const error = createSupportAwareApiError({ message: 'internal_error' }, 500);
    assert.equal(error.status, 500);
    assert.equal(error.code, 'internal_error');
    assert.equal(error.apiCode, 'internal_error');
    assert.equal(resolveApiErrorMessage(error), 'internal_error');
    assert.equal(error.error_id, undefined);
  });

  it('a saved 5xx keeps the support code on the error', () => {
    const error = createSupportAwareApiError({ message: 'internal_error', error_id: CODE }, 500);
    assert.equal(error.error_id, CODE);
    assert.equal(error.supportCode, CODE);
  });
});

describe('details and the text copied for support', () => {
  it('with a support code: the same rows on screen and in the copy, and nothing internal', () => {
    const error = createSupportAwareApiError({ message: 'failed_to_check_duplicates', error_id: CODE, stack: 'at db.query', internal_error: { message: 'pg says no' } }, 500);
    error.occurredAt = AT;
    const details = describeError(error, { action: 'בדיקת כפילויות' });
    assert.equal(details.message, 'הפעולה נכשלה. נסו שוב בעוד כמה דקות. (failed_to_check_duplicates)');
    assert.deepEqual(errorDetailRows(details).map((row) => [row.key, row.value]), [
      ['action', 'בדיקת כפילויות'],
      ['occurredAt', AT],
      ['status', '500'],
      ['publicCode', 'failed_to_check_duplicates'],
      ['supportCode', CODE],
    ]);
    const copied = formatErrorDetailsForCopy(details);
    assert.equal(copied, [
      'פרטי שגיאה לתמיכה',
      'הודעה: הפעולה נכשלה. נסו שוב בעוד כמה דקות. (failed_to_check_duplicates)',
      'פעולה: בדיקת כפילויות',
      `זמן: ${AT}`,
      'סטטוס HTTP: 500',
      'קוד שגיאה: failed_to_check_duplicates',
      `קוד תמיכה: ${CODE}`,
    ].join('\n'));
    for (const secret of ['at db.query', 'pg says no', 'stack', 'internal_error']) assert.ok(!copied.includes(secret), secret);
  });

  it('without a support code: copying still works, with no support-code row', () => {
    const error = createSupportAwareApiError({ message: 'failed_to_check_duplicates' }, 500);
    error.occurredAt = AT;
    const details = describeError(error, { action: 'בדיקת כפילויות' });
    assert.equal(details.supportCode, '');
    assert.ok(details.message.endsWith('(failed_to_check_duplicates)'));
    const copied = formatErrorDetailsForCopy(details);
    assert.ok(copied.includes('קוד שגיאה: failed_to_check_duplicates'));
    assert.ok(!copied.includes('קוד תמיכה'));
  });

  it('raw technical server text: the copy has the status but not the text', () => {
    const error = createSupportAwareApiError({ message: 'TypeError: Cannot read properties of undefined (reading "id")' }, 500);
    const copied = formatErrorDetailsForCopy(describeError(error));
    assert.ok(copied.includes('סטטוס HTTP: 500'));
    assert.ok(!copied.includes('TypeError'));
    assert.ok(!copied.includes('Cannot read'));
  });

  it('a network failure: a Hebrew connection message, no status and no codes', () => {
    for (const error of [new TypeError('Failed to fetch'), createNetworkError(new TypeError('Load failed'))]) {
      const details = describeError(error, { action: 'שמירת השיעור' });
      assert.equal(details.message, NETWORK_ERROR_MESSAGE);
      assert.equal(details.status, null);
      assert.equal(details.publicCode, '');
      assert.equal(details.supportCode, '');
      assert.ok(!formatErrorDetailsForCopy(details).includes('Failed to fetch'));
    }
    assert.equal(resolveUserErrorMessage(new TypeError('Failed to fetch')), NETWORK_ERROR_MESSAGE);
  });

  it('the time row uses the formatter the screen uses', () => {
    const details = describeError(createSupportAwareApiError({}, 500), { occurredAt: AT });
    const rows = errorDetailRows(details, { formatTime: () => '24.11.2026 18:05' });
    assert.equal(rows.find((row) => row.key === 'occurredAt').value, '24.11.2026 18:05');
  });

  it('an English action label is dropped rather than shown', () => {
    assert.equal(describeError(createSupportAwareApiError({}, 500), { action: 'duplicate check' }).action, '');
  });
});

describe('resolveUserErrorMessage, for display as one string', () => {
  it('a known code carried on the error shows its Hebrew message', () => {
    assert.equal(resolveUserErrorMessage({ code: 'forbidden', data: { message: 'forbidden' }, status: 403 }), 'אין לכם הרשאה לבצע את הפעולה.');
  });

  it('a saved support code is appended so alerts and toasts lift it into their code chip', () => {
    const error = createSupportAwareApiError({ message: 'internal_error_x', error_id: CODE }, 500);
    assert.equal(resolveUserErrorMessage(error), `הפעולה נכשלה. נסו שוב בעוד כמה דקות. (internal_error_x) קוד תמיכה: ${CODE}`);
  });

  it('a Hebrew error thrown by the app itself is shown as it is', () => {
    assert.equal(resolveUserErrorMessage(new Error('יש לבחור קובץ.')), 'יש לבחור קובץ.');
  });
});

describe('server text is shown only from a trusted source, never because it contains Hebrew', () => {
  const MIXED = 'שגיאה: duplicate key value violates unique constraint "students_pkey" (SQLSTATE 23505)';

  it('a 5xx with mixed Hebrew and technical text shows the default, and the copy has none of it', () => {
    const error = createSupportAwareApiError({ message: MIXED }, 500);
    const details = describeError(error, { action: 'שמירת תלמיד' });
    assert.equal(details.message, 'הפעולה נכשלה. נסו שוב בעוד כמה דקות. (HTTP 500)');
    const copied = formatErrorDetailsForCopy(details);
    for (const leak of ['duplicate key', 'students_pkey', 'SQLSTATE', 'שגיאה:']) {
      assert.ok(!details.message.includes(leak) && !copied.includes(leak), leak);
    }
    assert.ok(!error.message.includes('duplicate key'), 'error.message does not carry it either');
  });

  it('Hebrew in details or description of a 4xx is not shown either', () => {
    const error = createSupportAwareApiError({ message: 'invalid_payload', details: MIXED }, 400);
    const details = describeError(error);
    assert.ok(!details.message.includes('duplicate'));
    assert.ok(!formatErrorDetailsForCopy(details).includes('duplicate'));
    assert.ok(details.message.endsWith('(invalid_payload)'));
  });

  it('the Hebrew message a 4xx endpoint wrote for users is kept, on screen and in the copy', () => {
    const error = createSupportAwareApiError({ message: 'התלמיד כבר משובץ בשיעור אחר בזמן זה.' }, 409);
    const details = describeError(error);
    assert.equal(details.message, 'התלמיד כבר משובץ בשיעור אחר בזמן זה.');
    assert.ok(formatErrorDetailsForCopy(details).includes('הודעה: התלמיד כבר משובץ בשיעור אחר בזמן זה.'));
  });

  it('a Hebrew error thrown by the app keeps its text; the same text from a server 500 does not', () => {
    assert.equal(resolveUserErrorMessage(new Error('יש לבחור קובץ.')), 'יש לבחור קובץ.');
    assert.ok(resolveUserErrorMessage(createSupportAwareApiError({ message: 'יש לבחור קובץ.' }, 500)).endsWith('(HTTP 500)'));
  });
});

describe('withErrorContext carries the action wording to the display and to the copy', () => {
  it('the fallback and action attached at the catch are used later, with no string conversion', () => {
    const error = withErrorContext(new TypeError('Failed to fetch'), { action: 'חיפוש תלמידים', fallback: 'חיפוש תלמידים נכשל.' });
    assert.equal(describeError(error).action, 'חיפוש תלמידים');
    const api = withErrorContext(createSupportAwareApiError({ message: 'search_failed' }, 500), { action: 'חיפוש תלמידים', fallback: 'חיפוש תלמידים נכשל.' });
    const details = describeError(api);
    assert.equal(details.message, 'חיפוש תלמידים נכשל. (search_failed)');
    assert.equal(resolveUserErrorMessage(api), 'חיפוש תלמידים נכשל. (search_failed)');
    assert.ok(formatErrorDetailsForCopy(details).startsWith(
      ['פרטי שגיאה לתמיכה', 'הודעה: חיפוש תלמידים נכשל. (search_failed)', 'פעולה: חיפוש תלמידים'].join('\n'),
    ));
  });
});
