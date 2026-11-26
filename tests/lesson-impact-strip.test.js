// Tests for the display helpers behind the lesson dialog's roster status pills and the one-line
// confirm strip (src/features/calendar/utils/lessonDialogModel.js, session-modal redesign Phase 3).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PARTICIPANT_STATUS_DISPLAY,
  formatAgorotCompact,
  getParticipantCardHref,
  getParticipantStatusDisplay,
  summarizePreviewImpacts,
} from '../src/features/calendar/utils/lessonDialogModel.js';

describe('getParticipantCardHref', () => {
  it('builds hash-router links so a new tab opens the profile, not the site root', () => {
    assert.equal(getParticipantCardHref({ student_id: 's-1', client_profile_id: 'c-1' }), '#/students/s-1');
    assert.equal(getParticipantCardHref({ student_id: null, client_profile_id: 'c-1' }), '#/one-time-customers/c-1');
    assert.equal(getParticipantCardHref({}), null);
    assert.equal(getParticipantCardHref(null), null);
  });
});

// Keep only the number (Intl adds bidi marks and the currency symbol around it).
const numberPart = (value) => value.replace(/[^\d.,]/g, '');

describe('getParticipantStatusDisplay', () => {
  it('maps participant statuses to a Hebrew label and a tone', () => {
    assert.deepEqual(getParticipantStatusDisplay('attended'), { label: 'נכח/ה', tone: 'ok' });
    assert.deepEqual(getParticipantStatusDisplay('no_show'), { label: 'לא הגיע/ה', tone: 'bad' });
    assert.deepEqual(getParticipantStatusDisplay(' Scheduled '), { label: 'מתוכנן', tone: 'neutral' });
    assert.deepEqual(getParticipantStatusDisplay('cancelled_clinic'), { label: 'ביטול ע"י המכון', tone: 'neutral' });
  });

  it('uses straight quotes in every label', () => {
    for (const { label } of Object.values(PARTICIPANT_STATUS_DISPLAY)) {
      assert.doesNotMatch(label, /[„”“]/);
    }
  });

  it('falls back to a neutral unknown label', () => {
    assert.deepEqual(getParticipantStatusDisplay('mystery'), { label: 'לא ידוע', tone: 'neutral' });
    assert.deepEqual(getParticipantStatusDisplay(null), { label: 'לא ידוע', tone: 'neutral' });
  });
});

describe('formatAgorotCompact', () => {
  it('formats agorot as unsigned shekels', () => {
    assert.match(formatAgorotCompact(15000), /₪/);
    assert.equal(numberPart(formatAgorotCompact(15000)), '150');
    assert.equal(numberPart(formatAgorotCompact(15050)), '150.5');
    assert.equal(formatAgorotCompact(-15050), formatAgorotCompact(15050));
    assert.equal(numberPart(formatAgorotCompact(null)), '0');
  });
});

describe('summarizePreviewImpacts', () => {
  it('builds money-first segments phrased with Hebrew verbs instead of +/- signs', () => {
    const summary = summarizePreviewImpacts({
      impacts: [
        { type: 'participant_status', message: 'הסטטוס ישתנה' },
        { type: 'billing_charge', amount: 15000, message: 'ייווצר חיוב' },
        {
          type: 'hmo_split_detail',
          hmo_provider_name: 'כללית',
          hmo_student_copay_amount: 2000,
          hmo_insurer_claim_amount: 13000,
          message: 'פיצול קופה',
        },
        { type: 'instructor_earning_add', amount: 8000, message: 'תתווסף רשומת שכר' },
      ],
    });

    assert.deepEqual(summary.segments.map((segment) => [segment.key, segment.label]), [
      ['billing', 'חיוב'],
      ['hmo', 'כללית'],
      ['payroll', 'שכר'],
    ]);
    assert.match(summary.segments[0].value, /יחויבו$/);
    assert.match(summary.segments[1].value, /^השתתפות .+ · תביעה .+/);
    assert.match(summary.segments[2].value, /יתווספו$/);
    for (const segment of summary.segments) {
      assert.doesNotMatch(segment.value, /[+-]/);
    }
    assert.deepEqual(summary.warnings, []);
    assert.equal(summary.quiet, false);
    // The status line itself is already shown as from → to pills, so it is not repeated in the details.
    assert.deepEqual(summary.details.map((detail) => detail.type), ['billing_charge', 'hmo_split_detail', 'instructor_earning_add']);
    assert.ok(summary.details.every((detail) => detail.group && detail.message));
  });

  it('phrases reversals and updates', () => {
    const summary = summarizePreviewImpacts({
      impacts: [
        { type: 'billing_reversal', amount: -15000 },
        { type: 'instructor_earning_reversal', amount: 8000 },
        { type: 'billing_update', amount_before: 10000, amount_after: 12000 },
        { type: 'instructor_earning_update', amount_before: 8000, amount_after: 6000 },
      ],
    });

    assert.match(summary.segments[0].value, /יזוכו$/);
    assert.match(summary.segments[1].value, /יוסרו$/);
    assert.match(summary.segments[2].value, /←/);
    assert.match(summary.segments[3].value, /←/);
    assert.equal(numberPart(summary.segments[0].value), '150');
    assert.deepEqual(summary.details, [], 'impacts without a message add no detail lines');
  });

  it('turns billing_blocked into a warning with a Hebrew fallback', () => {
    const summary = summarizePreviewImpacts({ impacts: [{ type: 'billing_blocked' }] });
    assert.deepEqual(summary.segments, []);
    assert.deepEqual(summary.warnings, ['החיוב דורש בדיקה לפני שיתבצע.']);
    assert.equal(summary.quiet, false);
  });

  it('is quiet when nothing financial changes', () => {
    for (const preview of [null, {}, { impacts: 'bad' }, { impacts: [{ type: 'participant_status', message: 'הסטטוס ישתנה' }] }]) {
      const summary = summarizePreviewImpacts(preview);
      assert.deepEqual(summary.segments, []);
      assert.deepEqual(summary.warnings, []);
      assert.deepEqual(summary.details, []);
      assert.equal(summary.quiet, true);
    }
  });
});
