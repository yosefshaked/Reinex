// Characterization tests for src/features/calendar/utils/lessonDialogModel.js.
// These lock in the CURRENT behavior of the lesson dialog helpers ahead of the
// LessonInstanceDialog UI refactor. Where current behavior looks wrong, the test
// still asserts it and carries a "CHARACTERIZATION NOTE" comment explaining why.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_BILLING_POLICY,
  DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
  buildConflictLines,
  buildSchedulingOverrideMetadata,
  deriveDisplayWorkflowDecisions,
  formatAgorotPreview,
  getCancellationStatusLabel,
  getDisplayInstance,
  getDisplayParticipants,
  getImpactGroupMeta,
  getOpenActionTab,
  getParticipantStatusLabel,
  groupPreviewImpacts,
  isCancellationStatus,
  isResolvedParticipantStatus,
  normalizeInstanceStatus,
  parseIsoDateSafe,
  resolveClosureStepState,
  resolveLatestWorkflowState,
  resolveMutationError,
  shortId,
  shouldShowGraceWaiver,
  toLocalDateString,
  toUtcIsoString,
} from '../src/features/calendar/utils/lessonDialogModel.js';
import { formatDateDisplay, formatTimeDisplay } from '../src/features/calendar/utils/timeGrid.js';
import { createSupportAwareApiError } from '../src/lib/error-support.js';

// Mirrors decorateApiError() in src/lib/api-client.js: error.data = payload,
// error.status = HTTP status, error.code = payload code, and error.message is the
// (optionally COMMON_API_ERROR_MESSAGES-translated) code.
function apiError(payload, status, { translatedMessage } = {}) {
  const code = payload?.message || payload?.error || payload?.details || payload?.description || payload?.title || null;
  const error = new Error(translatedMessage || code || `HTTP ${status}`);
  error.status = status;
  if (payload) {
    error.data = payload;
  }
  if (code) {
    error.code = code;
    error.apiCode = code;
  }
  return error;
}

const GENERIC_409_MESSAGE = 'השיעור עודכן על ידי משתמש אחר. רעננו את התצוגה ונסו שוב.';
const NO_VISIBLE_CHANGE_LINE = 'קיימת גרסה חדשה יותר של השיעור בשרת, גם אם לא זוהה שינוי גלוי בשדות המוצגים כאן.';

// ---------------------------------------------------------------------------
// Constants and status helpers
// ---------------------------------------------------------------------------
describe('lessonDialogModel: constants and status helpers', () => {
  it('exposes the default billing and instructor earnings policies', () => {
    assert.deepEqual(DEFAULT_BILLING_POLICY, {
      attended: true,
      no_show: false,
      cancelled_student: false,
      cancelled_clinic: false,
    });
    assert.deepEqual(DEFAULT_INSTRUCTOR_EARNINGS_POLICY, {
      attended: true,
      no_show: true,
      cancelled_student: false,
      cancelled_clinic: false,
    });
  });

  it('normalizeInstanceStatus folds cancelled_* and no_show into "cancelled" and lowercases/trims', () => {
    assert.equal(normalizeInstanceStatus('cancelled_student'), 'cancelled');
    assert.equal(normalizeInstanceStatus('cancelled_clinic'), 'cancelled');
    assert.equal(normalizeInstanceStatus('no_show'), 'cancelled');
    assert.equal(normalizeInstanceStatus(' No_Show '), 'cancelled');
    assert.equal(normalizeInstanceStatus('Completed '), 'completed');
    assert.equal(normalizeInstanceStatus('scheduled'), 'scheduled');
    assert.equal(normalizeInstanceStatus(null), '');
    assert.equal(normalizeInstanceStatus(undefined), '');
  });

  it('isCancellationStatus / getCancellationStatusLabel follow the normalized status', () => {
    assert.equal(isCancellationStatus('cancelled'), true);
    assert.equal(isCancellationStatus('cancelled_clinic'), true);
    assert.equal(isCancellationStatus('no_show'), true);
    assert.equal(isCancellationStatus('scheduled'), false);
    assert.equal(getCancellationStatusLabel('cancelled_student'), 'שיעור בוטל');
    assert.equal(getCancellationStatusLabel('scheduled'), 'ביטול');
  });

  it('isResolvedParticipantStatus accepts only final participant statuses', () => {
    for (const status of ['attended', 'no_show', 'cancelled_student', 'cancelled_clinic', ' ATTENDED ']) {
      assert.equal(isResolvedParticipantStatus(status), true, status);
    }
    for (const status of ['scheduled', 'cancelled', 'completed', '', null]) {
      assert.equal(isResolvedParticipantStatus(status), false, String(status));
    }
  });

  it('getParticipantStatusLabel maps known statuses and defaults to "scheduled"', () => {
    assert.equal(getParticipantStatusLabel('attended'), 'נכח');
    assert.equal(getParticipantStatusLabel('no_show'), 'לא הגיע');
    assert.equal(getParticipantStatusLabel('cancelled'), 'בוטל');
    assert.equal(getParticipantStatusLabel('cancelled_student'), 'בוטל ע"י תלמיד');
    assert.equal(getParticipantStatusLabel('cancelled_clinic'), 'בוטל ע"י המכון');
    assert.equal(getParticipantStatusLabel('completed'), 'הושלם');
    assert.equal(getParticipantStatusLabel('scheduled'), 'מתוכנן');
    // CHARACTERIZATION NOTE: any unknown status (e.g. 'requires_attention') is labelled "scheduled".
    assert.equal(getParticipantStatusLabel('requires_attention'), 'מתוכנן');
  });
});

// ---------------------------------------------------------------------------
// shouldShowGraceWaiver
// ---------------------------------------------------------------------------
describe('lessonDialogModel: shouldShowGraceWaiver', () => {
  it('shows the waiver only for grace-eligible statuses that the billing policy charges', () => {
    assert.equal(shouldShowGraceWaiver({ no_show: true }, 'no_show'), true);
    assert.equal(shouldShowGraceWaiver({ cancelled_student: true }, 'cancelled_student'), true);
    assert.equal(shouldShowGraceWaiver({ cancelled_clinic: true }, 'cancelled_clinic'), true);
    assert.equal(shouldShowGraceWaiver({ no_show: true }, ' NO_SHOW '), true);
  });

  it('hides the waiver when the policy does not charge the status', () => {
    assert.equal(shouldShowGraceWaiver(DEFAULT_BILLING_POLICY, 'no_show'), false);
    assert.equal(shouldShowGraceWaiver(DEFAULT_BILLING_POLICY, 'cancelled_student'), false);
    assert.equal(shouldShowGraceWaiver(undefined, 'no_show'), false);
  });

  it('never shows the waiver for non-grace statuses, even if the policy charges them', () => {
    assert.equal(shouldShowGraceWaiver({ attended: true }, 'attended'), false);
    assert.equal(shouldShowGraceWaiver({ cancelled: true }, 'cancelled'), false);
    assert.equal(shouldShowGraceWaiver({ scheduled: true }, 'scheduled'), false);
  });
});

// ---------------------------------------------------------------------------
// Date / time
// ---------------------------------------------------------------------------
describe('lessonDialogModel: toUtcIsoString / toLocalDateString', () => {
  it('toUtcIsoString interprets date + time as local time and returns an ISO UTC string', () => {
    assert.equal(toUtcIsoString('2026-09-14', '10:30'), new Date(2026, 8, 14, 10, 30, 0, 0).toISOString());
    assert.equal(toUtcIsoString('2026-01-05', '00:00'), new Date(2026, 0, 5, 0, 0, 0, 0).toISOString());
  });

  it('toUtcIsoString returns null for missing or unparseable dates', () => {
    assert.equal(toUtcIsoString('', '10:00'), null);
    assert.equal(toUtcIsoString('2026-09-14', ''), null);
    assert.equal(toUtcIsoString(null, '10:00'), null);
    assert.equal(toUtcIsoString('2026-09-14', undefined), null);
    assert.equal(toUtcIsoString('not-a-date', '10:00'), null);
  });

  it('toUtcIsoString silently coerces an unparseable time to midnight', () => {
    // CHARACTERIZATION NOTE (suspicious): `hours || 0` turns NaN into 0, so an invalid
    // time string does not return null; it becomes 00:00 local time on that date.
    assert.equal(toUtcIsoString('2026-09-14', 'abc'), new Date(2026, 8, 14, 0, 0, 0, 0).toISOString());
  });

  it('toUtcIsoString lets out-of-range date parts roll over (no validation)', () => {
    // CHARACTERIZATION NOTE: month 13 / day 40 are passed straight to new Date(), which rolls over.
    assert.equal(toUtcIsoString('2026-13-40', '09:00'), new Date(2026, 12, 40, 9, 0, 0, 0).toISOString());
  });

  it('toLocalDateString formats a Date as a local YYYY-MM-DD string', () => {
    assert.equal(toLocalDateString(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(toLocalDateString(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
  });

  it('toLocalDateString returns "" for invalid input', () => {
    assert.equal(toLocalDateString(new Date('invalid')), '');
    assert.equal(toLocalDateString('2026-09-14'), '');
    assert.equal(toLocalDateString(null), '');
    assert.equal(toLocalDateString(undefined), '');
  });

  it('toLocalDateString round-trips a value produced by toUtcIsoString', () => {
    const iso = toUtcIsoString('2026-09-14', '23:45');
    assert.equal(toLocalDateString(new Date(iso)), '2026-09-14');
  });
});

// ---------------------------------------------------------------------------
// buildSchedulingOverrideMetadata
// ---------------------------------------------------------------------------
describe('lessonDialogModel: buildSchedulingOverrideMetadata', () => {
  it('enables a one-time override with the preset reason label and a fresh created_at', () => {
    const before = Date.now();
    const result = buildSchedulingOverrideMetadata(
      { source: 'import' },
      { enabled: true, selectedReasonCode: 'holiday_or_special_activity', customReason: '' },
    );
    const after = Date.now();

    assert.equal(result.source, 'import');
    const { created_at: createdAt, ...rest } = result.scheduling_override;
    assert.deepEqual(rest, {
      type: 'one_time_exception',
      reason: 'חג / פעילות מיוחדת',
      reason_code: 'holiday_or_special_activity',
      created_by_ui: true,
    });
    const createdTs = Date.parse(createdAt);
    assert.ok(createdTs >= before && createdTs <= after, `created_at ${createdAt} should be "now"`);
  });

  it('uses the trimmed custom reason for the "custom" code', () => {
    const result = buildSchedulingOverrideMetadata(null, {
      enabled: true,
      selectedReasonCode: 'custom',
      customReason: '  אירוע משפחתי  ',
    });
    assert.equal(result.scheduling_override.reason, 'אירוע משפחתי');
    assert.equal(result.scheduling_override.reason_code, 'custom');
  });

  it('still writes an override with empty reason/code when the reason is invalid', () => {
    // CHARACTERIZATION NOTE: the helper does not validate; the UI is expected to gate on
    // hasValidSchedulingOverrideReason() before saving.
    const emptyCustom = buildSchedulingOverrideMetadata({}, { enabled: true, selectedReasonCode: 'custom', customReason: '   ' });
    assert.equal(emptyCustom.scheduling_override.reason, '');
    assert.equal(emptyCustom.scheduling_override.reason_code, '');

    const unknownCode = buildSchedulingOverrideMetadata({}, { enabled: true, selectedReasonCode: 'nope', customReason: '' });
    assert.equal(unknownCode.scheduling_override.reason, '');
    assert.equal(unknownCode.scheduling_override.reason_code, '');
    assert.equal(unknownCode.scheduling_override.type, 'one_time_exception');
  });

  it('preserves an existing created_at when re-enabling/updating the override', () => {
    const base = {
      scheduling_override: {
        type: 'one_time_exception',
        reason: 'חג / פעילות מיוחדת',
        reason_code: 'holiday_or_special_activity',
        created_at: '2026-01-01T08:00:00.000Z',
        legacy_field: 'dropped',
      },
    };
    const result = buildSchedulingOverrideMetadata(base, {
      enabled: true,
      selectedReasonCode: 'urgent_schedule_adjustment',
      customReason: '',
    });
    assert.deepEqual(result.scheduling_override, {
      type: 'one_time_exception',
      reason: 'שינוי תפעולי דחוף',
      reason_code: 'urgent_schedule_adjustment',
      created_by_ui: true,
      created_at: '2026-01-01T08:00:00.000Z',
    });
  });

  it('disabling removes only the scheduling_override key and keeps unrelated metadata', () => {
    const base = {
      notes: 'keep me',
      nested: { a: 1 },
      scheduling_override: { type: 'one_time_exception', created_at: '2026-01-01T08:00:00.000Z' },
    };
    const result = buildSchedulingOverrideMetadata(base, { enabled: false });
    assert.deepEqual(result, { notes: 'keep me', nested: { a: 1 } });
    assert.equal(result.nested, base.nested, 'shallow copy keeps nested references');
  });

  it('does not mutate the base metadata object', () => {
    const base = { notes: 'x', scheduling_override: { created_at: '2026-01-01T08:00:00.000Z' } };
    const snapshot = structuredClone(base);
    buildSchedulingOverrideMetadata(base, { enabled: false });
    buildSchedulingOverrideMetadata(base, { enabled: true, selectedReasonCode: 'custom', customReason: 'y' });
    assert.deepEqual(base, snapshot);
  });

  it('treats null, arrays and primitives as empty metadata', () => {
    assert.deepEqual(buildSchedulingOverrideMetadata(null, { enabled: false }), {});
    assert.deepEqual(buildSchedulingOverrideMetadata(['a'], { enabled: false }), {});
    assert.deepEqual(buildSchedulingOverrideMetadata('str', { enabled: false }), {});
  });
});

// ---------------------------------------------------------------------------
// getDisplayInstance / getDisplayParticipants
// ---------------------------------------------------------------------------
describe('lessonDialogModel: getDisplayInstance / getDisplayParticipants', () => {
  it('merges latest_correction.effective_state.instance over the instance', () => {
    const instance = {
      id: 'inst-1',
      status: 'scheduled',
      duration_minutes: 45,
      datetime_start: '2026-09-14T07:00:00.000Z',
      latest_correction: {
        id: 'corr-1',
        effective_state: {
          instance: { status: 'completed', duration_minutes: 60 },
        },
      },
    };
    const display = getDisplayInstance(instance);
    assert.equal(display.id, 'inst-1');
    assert.equal(display.status, 'completed');
    assert.equal(display.duration_minutes, 60);
    assert.equal(display.datetime_start, '2026-09-14T07:00:00.000Z');
    assert.equal(display.latest_correction, instance.latest_correction);
    assert.equal(instance.status, 'scheduled', 'input is not mutated');
  });

  it('normalizes cancelled_* and no_show (base or corrected) to "cancelled"', () => {
    assert.equal(getDisplayInstance({ status: 'cancelled_student' }).status, 'cancelled');
    assert.equal(getDisplayInstance({ status: 'cancelled_clinic' }).status, 'cancelled');
    assert.equal(getDisplayInstance({ status: 'no_show' }).status, 'cancelled');
    assert.equal(getDisplayInstance({ status: ' Completed ' }).status, 'completed');
    assert.equal(
      getDisplayInstance({
        status: 'scheduled',
        latest_correction: { effective_state: { instance: { status: 'cancelled_clinic' } } },
      }).status,
      'cancelled',
    );
  });

  it('ignores a correction without an effective instance', () => {
    const display = getDisplayInstance({ status: 'scheduled', latest_correction: { effective_state: { participants: [] } } });
    assert.equal(display.status, 'scheduled');
  });

  it('passes through nullish input and keeps a nullish status as-is', () => {
    assert.equal(getDisplayInstance(null), null);
    assert.equal(getDisplayInstance(undefined), undefined);
    assert.equal(getDisplayInstance({ id: 'x', status: null }).status, null);
    assert.equal(getDisplayInstance({ id: 'x' }).status, undefined);
  });

  it('merges effective participants by id and leaves others untouched', () => {
    const instance = {
      participants: [
        { id: 'p1', participant_status: 'scheduled', student: { full_name: 'דנה כהן' } },
        { id: 'p2', participant_status: 'scheduled' },
      ],
      latest_correction: {
        effective_state: {
          participants: [{ id: 'p1', participant_status: 'attended' }],
        },
      },
    };
    const participants = getDisplayParticipants(instance);
    assert.deepEqual(participants, [
      { id: 'p1', participant_status: 'attended', student: { full_name: 'דנה כהן' } },
      { id: 'p2', participant_status: 'scheduled' },
    ]);
  });

  it('does not normalize participant statuses (no_show stays no_show)', () => {
    const participants = getDisplayParticipants({
      participants: [{ id: 'p1', participant_status: 'scheduled' }],
      latest_correction: { effective_state: { participants: [{ id: 'p1', participant_status: 'no_show' }] } },
    });
    assert.equal(participants[0].participant_status, 'no_show');
  });

  it('ignores effective participants that are not in the base participant list', () => {
    // CHARACTERIZATION NOTE: a participant that exists only in the correction's effective
    // state is not shown; the base participant list is authoritative for membership.
    const participants = getDisplayParticipants({
      participants: [{ id: 'p1', participant_status: 'scheduled' }],
      latest_correction: { effective_state: { participants: [{ id: 'p9', participant_status: 'attended' }] } },
    });
    assert.deepEqual(participants, [{ id: 'p1', participant_status: 'scheduled' }]);
  });

  it('returns [] when there are no participants', () => {
    assert.deepEqual(getDisplayParticipants(null), []);
    assert.deepEqual(getDisplayParticipants({}), []);
    assert.deepEqual(getDisplayParticipants({ participants: 'nope' }), []);
  });
});

// ---------------------------------------------------------------------------
// resolveMutationError
// ---------------------------------------------------------------------------
describe('lessonDialogModel: resolveMutationError', () => {
  it('capacity_exceeded with max_capacity mentions the number of seats', () => {
    const error = apiError(
      { message: 'capacity_exceeded', current_count: 4, max_capacity: 4 },
      422,
      { translatedMessage: 'השיעור מלא — אין מקום פנוי למשתתף/ת נוסף/ת.' },
    );
    assert.equal(resolveMutationError(error), 'השיעור מלא — כל 4 המקומות תפוסים. אפשר לפנות מקום אם משתתף/ת ביטל/ה.');
  });

  it('capacity_exceeded coerces a numeric-string max_capacity', () => {
    const error = apiError({ message: 'capacity_exceeded', max_capacity: '6' }, 422);
    assert.equal(resolveMutationError(error), 'השיעור מלא — כל 6 המקומות תפוסים. אפשר לפנות מקום אם משתתף/ת ביטל/ה.');
  });

  it('capacity_exceeded without a usable max_capacity uses the generic "full" message', () => {
    const expected = 'השיעור מלא — אין מקום פנוי למשתתף/ת נוסף/ת.';
    assert.equal(resolveMutationError(apiError({ message: 'capacity_exceeded' }, 422)), expected);
    assert.equal(resolveMutationError(apiError({ message: 'capacity_exceeded', max_capacity: 0 }, 422)), expected);
    assert.equal(resolveMutationError(apiError({ message: 'capacity_exceeded', max_capacity: 'x' }, 422)), expected);
  });

  it('cancel_instance_requires_dedicated_action points to the dedicated cancel action', () => {
    const error = apiError({ message: 'cancel_instance_requires_dedicated_action' }, 422);
    assert.equal(resolveMutationError(error), 'ביטול שיעור נעשה דרך "בטל שיעור" ולא דרך העריכה.');
  });

  it('maps instructor availability codes carried on error.message', () => {
    assert.equal(
      resolveMutationError(apiError({ message: 'missing_instructor_service_capability' }, 422)),
      'למדריך/ה שנבחר/ה אין יכולת שירות פעילה עבור השירות הזה.',
    );
    assert.equal(
      resolveMutationError(apiError({ message: 'outside_instructor_service_availability' }, 422)),
      'המועד שנבחר נמצא מחוץ לחלונות הזמינות של השירות אצל המדריך/ה.',
    );
  });

  it('423 means the lesson is locked for direct edits', () => {
    const error = apiError({ message: 'instance_locked' }, 423);
    assert.equal(resolveMutationError(error), 'השיעור נעול לשינוי ישיר. יש להשתמש בזרימת התיקון.');
  });

  it('409 means someone else updated the lesson', () => {
    const error = apiError({ message: 'version_conflict', code: 'version_conflict' }, 409);
    assert.equal(resolveMutationError(error), GENERIC_409_MESSAGE);
  });

  it('missing_instructor_compensation_decision (data.code, 400) asks for a compensation decision', () => {
    const error = apiError(
      { message: 'missing_instructor_compensation_decision', code: 'missing_instructor_compensation_decision', participant_status: 'no_show' },
      400,
    );
    assert.equal(resolveMutationError(error), 'יש לבחור אם המדריך אמור לקבל פיצוי לפני שמאשרים אי-הגעה מחויבת.');
  });

  it('instance_cancelled_has_attended_participants lists attended names when not a 409', () => {
    const error = apiError(
      {
        message: 'instance_cancelled_has_attended_participants',
        attended_participants: [{ id: 'p1', name: 'דנה כהן' }, { id: 'p2', name: '' }, { id: 'p3', name: 'יוסי לוי' }],
      },
      400,
    );
    assert.equal(
      resolveMutationError(error),
      'לא ניתן לבטל שיעור שבו כבר סומנה נוכחות. יש להסדיר קודם את: דנה כהן, יוסי לוי.',
    );
  });

  it('instance_cancelled_has_attended_participants falls back to error.attended_participants', () => {
    const error = new Error('instance_cancelled_has_attended_participants');
    error.attended_participants = [{ name: 'רותם' }];
    assert.equal(resolveMutationError(error), 'לא ניתן לבטל שיעור שבו כבר סומנה נוכחות. יש להסדיר קודם את: רותם.');
  });

  it('instance_cancelled_has_attended_participants without names uses the nameless message', () => {
    const error = apiError({ message: 'instance_cancelled_has_attended_participants', attended_participants: [] }, 400);
    assert.equal(resolveMutationError(error), 'לא ניתן לבטל שיעור שבו כבר סומנה נוכחות לאחד המשתתפים.');
  });

  it('instance_cancelled_has_attended_participants as the API sends it (409) lists the attended names', () => {
    // Regression: api/calendar/index.js returns this code with HTTP 409 (not a version conflict).
    // It used to be swallowed by the generic 409 "updated by another user" message.
    const error = apiError(
      {
        message: 'instance_cancelled_has_attended_participants',
        attended_participants: [{ id: 'p1', name: 'דנה כהן' }],
      },
      409,
    );
    assert.equal(resolveMutationError(error), 'לא ניתן לבטל שיעור שבו כבר סומנה נוכחות. יש להסדיר קודם את: דנה כהן.');
  });

  it('a translated 409 (documented session report) shows its own message, not the version-conflict text', () => {
    const translated = 'קיים דיווח מתועד לשיעור הזה. יש למחוק או לבטל את הדיווח לפני ביצוע הפעולה.';
    const error = apiError(
      { message: 'report_has_documentation', documented_participant_ids: ['p1'] },
      409,
      { translatedMessage: translated },
    );
    assert.equal(resolveMutationError(error), translated);
  });

  it('an untranslated 409 code still falls back to the version-conflict text', () => {
    assert.equal(resolveMutationError(apiError({ message: 'instance_not_in_reportable_state' }, 409)), GENERIC_409_MESSAGE);
  });

  it('passes a support-code message through verbatim, ahead of any code mapping', () => {
    const error = createSupportAwareApiError(
      { message: 'capacity_exceeded', error_id: 'ERR-20260914-ABC123' },
      500,
    );
    assert.equal(resolveMutationError(error), 'הפעולה נכשלה. קוד תמיכה: ERR-20260914-ABC123');
  });

  it('passes a support code embedded in a plain error message through verbatim', () => {
    const error = new Error('Something broke (ERR-20260101-ZZ99AA)');
    assert.equal(resolveMutationError(error), 'Something broke (ERR-20260101-ZZ99AA)');
  });

  it('falls back to error.message, then to a generic Hebrew failure message', () => {
    assert.equal(resolveMutationError(apiError({ message: 'some_unmapped_code' }, 400)), 'some_unmapped_code');
    assert.equal(resolveMutationError(new Error('Network down')), 'Network down');
    assert.equal(resolveMutationError(new Error('')), 'הפעולה נכשלה.');
    assert.equal(resolveMutationError(null), 'הפעולה נכשלה.');
    assert.equal(resolveMutationError(undefined), 'הפעולה נכשלה.');
  });

  it('returns error.message (possibly translated) rather than data.message for unmapped codes', () => {
    // CHARACTERIZATION NOTE: the fallback reads error.message, so a COMMON_API_ERROR_MESSAGES
    // translation from api-client wins over the raw payload code.
    const error = apiError({ message: 'forbidden' }, 403, { translatedMessage: 'אין לכם הרשאה לבצע את הפעולה.' });
    assert.equal(resolveMutationError(error), 'אין לכם הרשאה לבצע את הפעולה.');
  });
});

// ---------------------------------------------------------------------------
// deriveDisplayWorkflowDecisions
// ---------------------------------------------------------------------------
describe('lessonDialogModel: deriveDisplayWorkflowDecisions', () => {
  it('attended without HMO coverage: pending billing, compensated instructor, unknown HMO', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions({ participant_status: 'attended' }, DEFAULT_BILLING_POLICY),
      { studentBillingDecision: 'pending', compensationDecision: 'compensated', hmoDecision: 'unknown' },
    );
  });

  it('attended with covered HMO: HMO claim is pending', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions(
        { participant_status: 'attended', hmo_coverage: { status: 'covered' } },
        DEFAULT_BILLING_POLICY,
      ),
      { studentBillingDecision: 'pending', compensationDecision: 'compensated', hmoDecision: 'pending' },
    );
  });

  it('attended with a policy that does not bill attendance: billing not applicable', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions({ participant_status: 'attended' }, { attended: false }),
      { studentBillingDecision: 'not_applicable', compensationDecision: 'compensated', hmoDecision: 'unknown' },
    );
  });

  it('no_show under the default policy: not billed, compensation unknown, HMO claim not required', () => {
    // CHARACTERIZATION NOTE: compensation is 'unknown' for no_show even though
    // DEFAULT_INSTRUCTOR_EARNINGS_POLICY.no_show is true; the helper does not take the
    // instructor earnings policy into account.
    assert.deepEqual(
      deriveDisplayWorkflowDecisions({ participant_status: 'no_show' }, DEFAULT_BILLING_POLICY),
      { studentBillingDecision: 'not_applicable', compensationDecision: 'unknown', hmoDecision: 'not_required' },
    );
  });

  it('no_show with covered HMO and a policy that bills no-shows', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions(
        { participant_status: 'no_show', hmo_coverage: { status: 'covered' } },
        { ...DEFAULT_BILLING_POLICY, no_show: true },
      ),
      { studentBillingDecision: 'pending', compensationDecision: 'unknown', hmoDecision: 'not_required' },
    );
  });

  it('scheduled with covered HMO: HMO claim is expected, billing unknown', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions(
        { participant_status: 'scheduled', hmo_coverage: { status: 'covered' } },
        DEFAULT_BILLING_POLICY,
      ),
      { studentBillingDecision: 'unknown', compensationDecision: 'unknown', hmoDecision: 'expected' },
    );
  });

  it('scheduled without HMO coverage: everything unknown', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions({ participant_status: 'scheduled' }, DEFAULT_BILLING_POLICY),
      { studentBillingDecision: 'unknown', compensationDecision: 'unknown', hmoDecision: 'unknown' },
    );
  });

  it('blocked HMO coverage wins over status-based HMO inference', () => {
    for (const status of ['attended', 'no_show', 'scheduled']) {
      assert.equal(
        deriveDisplayWorkflowDecisions(
          { participant_status: status, hmo_coverage: { status: 'blocked' } },
          DEFAULT_BILLING_POLICY,
        ).hmoDecision,
        'blocked',
        status,
      );
    }
  });

  it('explicit workflow decisions from metadata win', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions(
        {
          participant_status: 'attended',
          hmo_coverage: { status: 'covered' },
          metadata: {
            workflow: {
              student_billing: { decision: 'resolved' },
              instructor_compensation: { decision: 'not_compensated' },
              hmo_claim: { decision: 'required' },
            },
          },
        },
        DEFAULT_BILLING_POLICY,
      ),
      { studentBillingDecision: 'resolved', compensationDecision: 'not_compensated', hmoDecision: 'required' },
    );
  });

  it('a stored "pending" billing decision becomes not_applicable when the policy does not bill the status', () => {
    const participant = {
      participant_status: 'cancelled_student',
      metadata: { workflow: { student_billing: { decision: 'pending' } } },
    };
    assert.equal(deriveDisplayWorkflowDecisions(participant, DEFAULT_BILLING_POLICY).studentBillingDecision, 'not_applicable');
    assert.equal(
      deriveDisplayWorkflowDecisions(participant, { cancelled_student: true }).studentBillingDecision,
      'pending',
    );
  });

  it('without a billing policy, resolved statuses show billing as not_applicable', () => {
    // CHARACTERIZATION NOTE: a missing billingPolicy (e.g. before settings load) is not
    // defaulted to DEFAULT_BILLING_POLICY, so attended shows 'not_applicable', and even a
    // stored 'pending' decision is rewritten to 'not_applicable'.
    assert.equal(
      deriveDisplayWorkflowDecisions({ participant_status: 'attended' }, undefined).studentBillingDecision,
      'not_applicable',
    );
    assert.equal(
      deriveDisplayWorkflowDecisions(
        { participant_status: 'attended', metadata: { workflow: { student_billing: { decision: 'pending' } } } },
        undefined,
      ).studentBillingDecision,
      'not_applicable',
    );
  });

  it('is case/whitespace-insensitive for participant and coverage status', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions(
        { participant_status: ' ATTENDED ', hmo_coverage: { status: 'Covered' } },
        DEFAULT_BILLING_POLICY,
      ),
      { studentBillingDecision: 'pending', compensationDecision: 'compensated', hmoDecision: 'pending' },
    );
  });

  it('handles a missing participant', () => {
    assert.deepEqual(
      deriveDisplayWorkflowDecisions(null, DEFAULT_BILLING_POLICY),
      { studentBillingDecision: 'unknown', compensationDecision: 'unknown', hmoDecision: 'unknown' },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveLatestWorkflowState / resolveClosureStepState / parseIsoDateSafe
// ---------------------------------------------------------------------------
describe('lessonDialogModel: resolveLatestWorkflowState / resolveClosureStepState', () => {
  it('parseIsoDateSafe returns epoch ms, or 0 for unparseable input', () => {
    assert.equal(parseIsoDateSafe('2026-09-14T10:00:00.000Z'), Date.UTC(2026, 8, 14, 10));
    assert.equal(parseIsoDateSafe('garbage'), 0);
    assert.equal(parseIsoDateSafe('   '), 0);
    assert.equal(parseIsoDateSafe(1700000000000), 0);
    assert.equal(parseIsoDateSafe(null), 0);
  });

  it('picks the state with the newer evaluated_at', () => {
    const older = { evaluated_at: '2026-09-14T10:00:00.000Z', tag: 'older' };
    const newer = { evaluated_at: '2026-09-14T11:00:00.000Z', tag: 'newer' };
    assert.equal(resolveLatestWorkflowState(older, newer), newer);
    assert.equal(resolveLatestWorkflowState(newer, older), newer);
  });

  it('prefers the preferred state on ties and when both timestamps are missing', () => {
    const a = { evaluated_at: '2026-09-14T10:00:00.000Z', tag: 'a' };
    const b = { evaluated_at: '2026-09-14T10:00:00.000Z', tag: 'b' };
    assert.equal(resolveLatestWorkflowState(a, b), a);
    const c = { tag: 'c' };
    const d = { tag: 'd' };
    assert.equal(resolveLatestWorkflowState(c, d), c);
  });

  it('treats an unparseable evaluated_at as the oldest possible', () => {
    const invalid = { evaluated_at: 'not-a-date', tag: 'invalid' };
    const valid = { evaluated_at: '2020-01-01T00:00:00.000Z', tag: 'valid' };
    assert.equal(resolveLatestWorkflowState(invalid, valid), valid);
  });

  it('returns whichever side exists, or {} when neither does', () => {
    const only = { evaluated_at: '2026-09-14T10:00:00.000Z' };
    assert.equal(resolveLatestWorkflowState(only, null), only);
    assert.equal(resolveLatestWorkflowState(undefined, only), only);
    assert.equal(resolveLatestWorkflowState('string', only), only);
    assert.deepEqual(resolveLatestWorkflowState(null, undefined), {});
  });

  it('resolveClosureStepState: an explicit boolean in the summary wins, even false over isClosed', () => {
    assert.equal(resolveClosureStepState({ billing: true }, 'billing', false), true);
    assert.equal(resolveClosureStepState({ billing: false }, 'billing', true), false);
  });

  it('resolveClosureStepState: falls back to true when closed, otherwise null', () => {
    assert.equal(resolveClosureStepState({}, 'billing', true), true);
    assert.equal(resolveClosureStepState(null, 'billing', true), true);
    assert.equal(resolveClosureStepState({ billing: 'yes' }, 'billing', false), null);
    assert.equal(resolveClosureStepState(null, 'billing', false), null);
    assert.equal(resolveClosureStepState(undefined, 'billing', undefined), null);
    assert.equal(resolveClosureStepState({}, 'billing', 'true'), null, 'isClosed must be strictly true');
  });
});

// ---------------------------------------------------------------------------
// Preview impacts / open actions / small formatters
// ---------------------------------------------------------------------------
describe('lessonDialogModel: groupPreviewImpacts / getOpenActionTab / formatters', () => {
  it('getImpactGroupMeta maps impact types to groups, defaulting to workflow', () => {
    assert.equal(getImpactGroupMeta('billing_charge').key, 'billing');
    assert.equal(getImpactGroupMeta('post_coverage_charge').key, 'billing');
    assert.equal(getImpactGroupMeta('instructor_earning_update').key, 'payroll');
    assert.equal(getImpactGroupMeta('instructor_attendance_remove').key, 'attendance');
    assert.equal(getImpactGroupMeta('hmo_split_detail').key, 'hmo');
    assert.deepEqual(getImpactGroupMeta('something_else'), {
      key: 'workflow',
      label: 'זרימת שיעור',
      borderClass: 'border-slate-200',
      bgClass: 'bg-slate-50/70',
    });
  });

  it('groups impacts in order of first appearance, keeping input order within a group', () => {
    const impacts = [
      { id: 1, type: 'instructor_earning_add' },
      { id: 2, type: 'billing_charge' },
      { id: 3, type: 'status_change' },
      { id: 4, type: 'billing_reversal' },
      { id: 5, type: 'hmo_task_resolve' },
      { id: 6, type: 'instructor_attendance_add' },
      { id: 7, type: 'instructor_earning_reversal' },
    ];
    const groups = groupPreviewImpacts(impacts);
    assert.deepEqual(groups.map((group) => group.key), ['payroll', 'billing', 'workflow', 'hmo', 'attendance']);
    assert.deepEqual(groups.map((group) => group.impacts.map((impact) => impact.id)), [[1, 7], [2, 4], [3], [5], [6]]);
    assert.deepEqual(
      groups.map((group) => group.label),
      ['שכר מדריך', 'חיוב כספי', 'זרימת שיעור', 'גורם מממן', 'נוכחות מדריך'],
    );
    assert.equal(groups[0].impacts[0], impacts[0], 'impacts are kept by reference');
  });

  it('returns [] for non-array input and puts null entries in the workflow group', () => {
    assert.deepEqual(groupPreviewImpacts(null), []);
    assert.deepEqual(groupPreviewImpacts({ type: 'billing_charge' }), []);
    const groups = groupPreviewImpacts([null]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].key, 'workflow');
    assert.deepEqual(groups[0].impacts, [null]);
  });

  it('getOpenActionTab routes each open action to its dialog tab', () => {
    const expected = {
      attendance: 'participants',
      reminders: 'participants',
      documentation: 'workflow',
      billing: 'workflow',
      payroll: 'workflow',
      hmo: 'workflow',
      closure: 'workflow',
      exception: 'overview',
      anything_else: 'overview',
    };
    for (const [actionId, tab] of Object.entries(expected)) {
      assert.equal(getOpenActionTab(actionId), tab, actionId);
    }
    assert.equal(getOpenActionTab(undefined), 'overview');
  });

  it('formatAgorotPreview formats agorot as ILS with two decimals', () => {
    const formatted = formatAgorotPreview(12345);
    assert.match(formatted, /123\.45/);
    assert.match(formatted, /₪/);
    assert.match(formatAgorotPreview(null), /0\.00/);
  });

  it('shortId keeps the last 8 characters', () => {
    assert.equal(shortId('0123456789abcdef'), '89abcdef');
    assert.equal(shortId('abc'), 'abc');
    assert.equal(shortId(null), '');
    assert.equal(shortId(''), '');
  });
});

// ---------------------------------------------------------------------------
// buildConflictLines
// ---------------------------------------------------------------------------
describe('lessonDialogModel: buildConflictLines', () => {
  const baseInstance = {
    id: 'inst-1',
    status: 'scheduled',
    datetime_start: '2026-09-14T07:00:00.000Z',
    duration_minutes: 45,
    participants: [
      { id: 'p1', participant_status: 'scheduled', student: { full_name: 'דנה כהן' }, metadata: { notes: '' } },
      { id: 'p2', participant_status: 'scheduled', student: { first_name: 'יוסי', last_name: 'לוי' } },
    ],
  };

  it('returns [] when there is no latest instance', () => {
    assert.deepEqual(buildConflictLines(baseInstance, null), []);
    assert.deepEqual(buildConflictLines(baseInstance, undefined, 'p1'), []);
  });

  it('returns the "no visible change" line when nothing visible changed', () => {
    assert.deepEqual(buildConflictLines(baseInstance, structuredClone(baseInstance), 'p1'), [NO_VISIBLE_CHANGE_LINE]);
  });

  it('reports an instance status change using the normalized display status', () => {
    const latest = { ...baseInstance, status: 'cancelled_clinic' };
    assert.deepEqual(buildConflictLines(baseInstance, latest), ['סטטוס השיעור כעת הוא "בוטל" במקום "מתוכנן".']);
  });

  it('does not report a change between two statuses that both normalize to "cancelled"', () => {
    // CHARACTERIZATION NOTE: no_show -> cancelled_student is invisible here because both
    // normalize to 'cancelled', so only the fallback line appears.
    const base = { ...baseInstance, status: 'no_show' };
    const latest = { ...baseInstance, status: 'cancelled_student' };
    assert.deepEqual(buildConflictLines(base, latest), [NO_VISIBLE_CHANGE_LINE]);
  });

  it('reports a time change using the calendar date/time formatters', () => {
    const latest = { ...baseInstance, datetime_start: '2026-09-15T09:30:00.000Z' };
    assert.deepEqual(buildConflictLines(baseInstance, latest), [
      `מועד השיעור השתנה ל-${formatDateDisplay('2026-09-15T09:30:00.000Z')} ${formatTimeDisplay('2026-09-15T09:30:00.000Z')}.`,
    ]);
  });

  it('reports a duration change, rendering a missing duration as 0', () => {
    assert.deepEqual(
      buildConflictLines(baseInstance, { ...baseInstance, duration_minutes: 60 }),
      ['משך השיעור עודכן ל-60 דקות.'],
    );
    assert.deepEqual(
      buildConflictLines(baseInstance, { ...baseInstance, duration_minutes: null }),
      ['משך השיעור עודכן ל-0 דקות.'],
    );
  });

  it('reports a participant status change with the participant name', () => {
    const latest = structuredClone(baseInstance);
    latest.participants[0].participant_status = 'attended';
    assert.deepEqual(buildConflictLines(baseInstance, latest, 'p1'), ['דנה כהן מסומן כרגע כ-"נכח".']);
  });

  it('composes the name from first/last name and ignores other participants', () => {
    const latest = structuredClone(baseInstance);
    latest.participants[0].participant_status = 'attended';
    latest.participants[1].participant_status = 'no_show';
    assert.deepEqual(buildConflictLines(baseInstance, latest, 'p2'), ['יוסי לוי מסומן כרגע כ-"לא הגיע".']);
  });

  it('falls back to the previous participant name, then to "הלקוח/ה"', () => {
    const latestNoStudent = structuredClone(baseInstance);
    latestNoStudent.participants[0] = { id: 'p1', participant_status: 'attended' };
    assert.deepEqual(buildConflictLines(baseInstance, latestNoStudent, 'p1'), ['דנה כהן מסומן כרגע כ-"נכח".']);

    const baseNoStudent = { ...baseInstance, participants: [{ id: 'p1', participant_status: 'scheduled' }] };
    const latestNoStudentEither = { ...baseInstance, participants: [{ id: 'p1', participant_status: 'attended' }] };
    assert.deepEqual(buildConflictLines(baseNoStudent, latestNoStudentEither, 'p1'), ['הלקוח/ה מסומן כרגע כ-"נכח".']);
  });

  it('uses the correction effective state when comparing participants', () => {
    const latest = {
      ...structuredClone(baseInstance),
      latest_correction: { effective_state: { participants: [{ id: 'p1', participant_status: 'cancelled_student' }] } },
    };
    assert.deepEqual(buildConflictLines(baseInstance, latest, 'p1'), ['דנה כהן מסומן כרגע כ-"בוטל ע"י תלמיד".']);
  });

  it('ignores participant changes when no participantId is given', () => {
    const latest = structuredClone(baseInstance);
    latest.participants[0].participant_status = 'attended';
    assert.deepEqual(buildConflictLines(baseInstance, latest), [NO_VISIBLE_CHANGE_LINE]);
  });

  it('reports a new participant note', () => {
    const latest = structuredClone(baseInstance);
    latest.participants[0].metadata = { notes: 'הגיע באיחור' };
    assert.deepEqual(buildConflictLines(baseInstance, latest, 'p1'), ['הערת המשתתף עודכנה ל-"הגיע באיחור".']);
  });

  it('does not report a cleared note', () => {
    // CHARACTERIZATION NOTE: clearing a note (non-empty -> empty) is not reported, so the
    // conflict panel shows only the fallback line.
    const base = structuredClone(baseInstance);
    base.participants[0].metadata = { notes: 'הערה ישנה' };
    const latest = structuredClone(baseInstance);
    latest.participants[0].metadata = { notes: '' };
    assert.deepEqual(buildConflictLines(base, latest, 'p1'), [NO_VISIBLE_CHANGE_LINE]);
  });

  it('does not report a participant removed on the server', () => {
    // CHARACTERIZATION NOTE: if the participant no longer exists in the latest instance,
    // nothing is reported for them.
    const latest = { ...baseInstance, participants: [baseInstance.participants[1]] };
    assert.deepEqual(buildConflictLines(baseInstance, latest, 'p1'), [NO_VISIBLE_CHANGE_LINE]);
  });

  it('emits lines in order: status, time, duration, participant, notes', () => {
    const latest = structuredClone(baseInstance);
    latest.status = 'completed';
    latest.datetime_start = '2026-09-15T09:30:00.000Z';
    latest.duration_minutes = 30;
    latest.participants[0].participant_status = 'attended';
    latest.participants[0].metadata = { notes: 'עודכן' };
    assert.deepEqual(buildConflictLines(baseInstance, latest, 'p1'), [
      'סטטוס השיעור כעת הוא "הושלם" במקום "מתוכנן".',
      `מועד השיעור השתנה ל-${formatDateDisplay('2026-09-15T09:30:00.000Z')} ${formatTimeDisplay('2026-09-15T09:30:00.000Z')}.`,
      'משך השיעור עודכן ל-30 דקות.',
      'דנה כהן מסומן כרגע כ-"נכח".',
      'הערת המשתתף עודכנה ל-"עודכן".',
    ]);
  });
});
