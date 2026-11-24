// What the user reads when an API call fails (docs/project-rules/20, "The product speaks Hebrew").
// A support code is shown only when the server returned one; every other message is Hebrew, while
// the original API code stays on the error for consumers that branch on it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildApiErrorMessage,
  buildUserErrorMessage,
  createSupportAwareApiError,
  resolveApiErrorMessage,
  resolveUserErrorMessage,
} from '../src/lib/error-support.js';

const HEBREW = /[֐-׿]/;
const LATIN_WORD = /[A-Za-z]{3,}/;
const CODE = 'ERR-20261124-ABC123';

function assertHebrewOnly(text) {
  assert.ok(HEBREW.test(text), `expected Hebrew, got: ${text}`);
  assert.ok(!LATIN_WORD.test(text.replace(/ERR-\d{8}-[A-Z0-9]{6}/, '')), `expected no English words, got: ${text}`);
}

describe('the message a user reads after a failed API call', () => {
  it('a saved 5xx shows a Hebrew message with the support code', () => {
    const text = buildUserErrorMessage({ message: 'failed_to_update_lesson_template', error_id: CODE }, 500);
    assert.equal(text, `הפעולה נכשלה. קוד תמיכה: ${CODE}`);
  });

  it('a 5xx without a support code (tracking failed) shows Hebrew and no code', () => {
    const text = buildUserErrorMessage({ message: 'failed_to_update_lesson_template' }, 500);
    assertHebrewOnly(text);
    assert.ok(!text.includes('ERR-'));
  });

  it('a known code shows its Hebrew message', () => {
    assert.equal(buildUserErrorMessage({ message: 'forbidden' }, 403), 'אין לכם הרשאה לבצע את הפעולה.');
  });

  it('an unmapped code, an English server message and an empty response show a Hebrew default', () => {
    assertHebrewOnly(buildUserErrorMessage({ message: 'some_new_code' }, 400));
    assertHebrewOnly(buildUserErrorMessage({ message: 'Something went wrong on the server' }, 400));
    assertHebrewOnly(buildUserErrorMessage({}, 500));
    assertHebrewOnly(buildUserErrorMessage(null, 502));
  });

  it('a Hebrew message from the server is shown as it is', () => {
    assert.equal(buildUserErrorMessage({ message: 'השיעור כבר בוטל.' }, 409), 'השיעור כבר בוטל.');
  });
});

describe('the error object keeps what code consumers rely on', () => {
  it('an unmapped 4xx code stays in error.message for consumers that branch on it, and displays as Hebrew', () => {
    const error = createSupportAwareApiError({ message: 'invitation_already_pending' }, 409);
    assert.equal(error.message, 'invitation_already_pending');
    assert.equal(buildApiErrorMessage({ message: 'invitation_already_pending' }, 409), 'invitation_already_pending');
    assertHebrewOnly(resolveUserErrorMessage(error));
  });

  it('English prose and an empty response never stay in error.message', () => {
    assertHebrewOnly(buildApiErrorMessage({ message: 'Something went wrong on the server' }, 400));
    assertHebrewOnly(buildApiErrorMessage({}, 400));
    assertHebrewOnly(buildApiErrorMessage({ message: 'some_new_code' }, 503));
  });

  it('a 5xx without a support code keeps the API code but shows Hebrew', () => {
    const error = createSupportAwareApiError({ message: 'internal_error' }, 500, 'Failed to fetch guardians: 500');
    assertHebrewOnly(error.message);
    assert.equal(error.code, 'internal_error');
    assert.equal(error.apiCode, 'internal_error');
    assert.equal(error.status, 500);
    assert.equal(error.error_id, undefined);
    assert.equal(resolveApiErrorMessage(error), 'internal_error');
  });

  it('a saved 5xx keeps the support code on the error', () => {
    const error = createSupportAwareApiError({ message: 'internal_error', error_id: CODE }, 500);
    assert.equal(error.message, `הפעולה נכשלה. קוד תמיכה: ${CODE}`);
    assert.equal(error.error_id, CODE);
    assert.equal(error.supportCode, CODE);
  });

  it('a Hebrew fallback is used when the response has no usable message', () => {
    const error = createSupportAwareApiError({}, 500, 'טעינת המסמכים נכשלה.');
    assert.equal(error.message, 'טעינת המסמכים נכשלה.');
  });
});

describe('resolveUserErrorMessage, for display', () => {
  it('shows Hebrew for an API error without a support code, and the code-bearing message otherwise', () => {
    assertHebrewOnly(resolveUserErrorMessage(createSupportAwareApiError({ message: 'internal_error' }, 500)));
    assert.equal(
      resolveUserErrorMessage(createSupportAwareApiError({ message: 'internal_error', error_id: CODE }, 500)),
      `הפעולה נכשלה. קוד תמיכה: ${CODE}`,
    );
  });

  it('uses the Hebrew fallback for a non-API error such as a network failure', () => {
    assert.equal(resolveUserErrorMessage(new Error('Failed to fetch'), 'טעינת הדיווחים נכשלה.'), 'טעינת הדיווחים נכשלה.');
    assertHebrewOnly(resolveUserErrorMessage(new Error('Failed to fetch')));
  });

  it('maps a known code carried on the error', () => {
    assert.equal(resolveUserErrorMessage({ code: 'forbidden', data: { message: 'forbidden' } }), 'אין לכם הרשאה לבצע את הפעולה.');
  });
});
