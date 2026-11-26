// @ts-check
/* eslint-env node */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getCoveragePresentation,
  getLessonChargePresentation,
  getParticipantStatusLabel,
} from '../src/features/finance/utils/ledgerPresentation.js';

describe('finance ledger presentation', () => {
  it('labels no-show lesson charges as non-attendance charges', () => {
    const presentation = getLessonChargePresentation({
      source_type: 'lesson_charge',
      metadata: { participant_status: 'no_show' },
    });

    assert.equal(presentation.label, 'חיוב בגין אי הגעה');
    assert.equal(presentation.statusBadge.label, 'לא הגיע/ה');
  });

  it('labels cancelled-student lesson charges as cancellation charges', () => {
    const presentation = getLessonChargePresentation({
      source_type: 'lesson_charge',
      metadata: { participant_status: 'cancelled_student' },
    });

    assert.equal(presentation.label, 'חיוב בגין ביטול לקוח');
    assert.equal(presentation.statusBadge.label, 'בוטל על ידי הלקוח/ה');
  });

  it('does not show active coverage as the main lesson-history badge for billed no-show rows', () => {
    const badge = getCoveragePresentation({
      billing_status: 'charged',
      participant_status: 'no_show',
      coverage_status: 'covered',
    });

    assert.equal(badge.label, 'חיוב בגין אי הגעה');
  });

  it('keeps active coverage label for attended covered rows', () => {
    const badge = getCoveragePresentation({
      billing_status: 'charged',
      participant_status: 'attended',
      coverage_status: 'covered',
    });

    assert.equal(badge.label, 'כיסוי פעיל');
  });

  it('formats unknown statuses defensively', () => {
    assert.equal(getParticipantStatusLabel('custom_status'), 'custom_status');
  });
});

