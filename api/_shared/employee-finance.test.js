/* eslint-env node */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveLessonInstructorPayout } from './employee-finance.js';

describe('resolveLessonInstructorPayout', () => {
  const instance = { duration_minutes: 60 };
  const participants = [{ id: 'p1' }, { id: 'p2' }];

  it('pays once per lesson for fixed_rate services', () => {
    const singleParticipant = resolveLessonInstructorPayout({
      instance,
      rateUsed: 10000,
      servicePaymentModel: 'fixed_rate',
      compensationParticipants: [participants[0]],
    });
    const twoParticipants = resolveLessonInstructorPayout({
      instance,
      rateUsed: 10000,
      servicePaymentModel: 'fixed_rate',
      compensationParticipants: participants,
    });

    assert.equal(singleParticipant.payoutAmount, 10000);
    assert.equal(twoParticipants.payoutAmount, 10000);
    assert.equal(twoParticipants.participantMultiplier, 1);
  });

  it('multiplies by participant count for per_student services', () => {
    const payout = resolveLessonInstructorPayout({
      instance,
      rateUsed: 10000,
      servicePaymentModel: 'per_student',
      compensationParticipants: participants,
    });

    assert.equal(payout.payoutAmount, 20000);
    assert.equal(payout.participantMultiplier, 2);
  });

  it('returns zero when there are no compensation-eligible participants', () => {
    const payout = resolveLessonInstructorPayout({
      instance,
      rateUsed: 10000,
      servicePaymentModel: 'per_student',
      compensationParticipants: [],
    });

    assert.equal(payout.payoutAmount, 0);
    assert.equal(payout.participantMultiplier, 0);
  });
});
