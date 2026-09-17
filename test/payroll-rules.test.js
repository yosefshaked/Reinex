// Instructor / employee pay rules as executable scenarios.
// Spec: implementations/business-process/payroll-scenarios.md (IDs PAY-A1 … PAY-K7).
// Rules that already exist are real tests against the pure pay helpers. Rules not built yet are
// `it.todo` entries with the same IDs, so the whole spec shows in the test run without failing it;
// each todo becomes a real test when its feature is built (tests before code).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
  buildLeaveDayRows,
  resolveCompensationEligibleParticipants,
  resolveLeaveDayValue,
  resolveLessonInstructorPayout,
} from '../api/_shared/employee-finance.js';
import { shouldParticipantTriggerInstructorCompensation } from '../api/_shared/calendar-workflow-decisions.js';

const POLICIES = { instructorEarningsPolicy: { ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY } };

function participant(id, status, decision = null) {
  return {
    id,
    participant_status: status,
    metadata: decision ? { workflow: { instructor_compensation: { decision } } } : {},
  };
}

const paysInstructor = (entry) => shouldParticipantTriggerInstructorCompensation(entry, POLICIES);

describe('PAY-A rates', () => {
  it('PAY-A5 lesson_hourly: pay = hourly rate × lesson length', () => {
    const { payoutAmount } = resolveLessonInstructorPayout({
      instance: { duration_minutes: 45 },
      rateUsed: 10000, // 100.00 ₪ per hour, in agorot
      servicePaymentModel: 'fixed_rate',
      compensationParticipants: [participant('p1', 'attended')],
    });
    assert.equal(payoutAmount, 7500);
  });

  it.todo('PAY-A1 a rate from 1.10 pays lessons from 1.10 until the next change; earlier lessons keep the previous rate');
  it.todo('PAY-A2 a future-dated rate is scheduled and takes effect on its own');
  it.todo('PAY-A3 a back-dated rate recalculates open months and adds pay differences for closed months');
  it.todo('PAY-A4 a lesson without a rate for its service and date is flagged "missing rate", pays nothing and blocks closing');
  it.todo('PAY-A5 lesson_flat: the same pay per lesson whatever its length');
  it.todo('PAY-A6 an employee with lesson rates and an hourly rate is paid each part from its own rate');
});

describe('PAY-B instructor pay per participant outcome', () => {
  it('PAY-B1 attended: paid', () => {
    assert.equal(paysInstructor(participant('p1', 'attended')), true);
  });

  it('PAY-B2 no-show: paid by default', () => {
    assert.equal(paysInstructor(participant('p1', 'no_show')), true);
  });

  it('PAY-B3 customer cancellation: not paid by default', () => {
    assert.equal(paysInstructor(participant('p1', 'cancelled_student')), false);
  });

  it('PAY-B5 farm cancellation: not paid by default', () => {
    assert.equal(paysInstructor(participant('p1', 'cancelled_clinic')), false);
  });

  it('PAY-B6 excused absence: not paid, even when the status alone would pay', () => {
    const participants = [participant('excused', 'no_show'), participant('present', 'attended')];
    const eligible = resolveCompensationEligibleParticipants(participants, POLICIES, new Set(['excused']));
    assert.deepEqual(eligible.map((entry) => entry.id), ['present']);
  });

  it('PAY-B7 the decision set on the participant in the lesson wins over every default', () => {
    assert.equal(paysInstructor(participant('p1', 'cancelled_student', 'compensated')), true);
    assert.equal(paysInstructor(participant('p2', 'attended', 'not_compensated')), false);
    assert.equal(paysInstructor(participant('p3', 'no_show', 'not_applicable')), false);
  });

  it('PAY-B7 a participant still scheduled never triggers pay, whatever the decision', () => {
    assert.equal(paysInstructor(participant('p1', 'scheduled', 'compensated')), false);
  });

  it.todo('PAY-B3 the cancellation cutoff is when the day\'s list was sent to the instructor (recorded per instructor and day)');
  it.todo('PAY-B4 a customer cancellation after the day\'s list was sent pays the instructor by default');
  it.todo('PAY-B7 the absence form pre-fills from B3/B4 using the list-sent cutoff');
});

describe('PAY-C group lessons', () => {
  const lesson = { duration_minutes: 60 };
  const rate = 8000;

  it('PAY-C1 paid once per lesson: one payment however many participants trigger pay', () => {
    const result = resolveLessonInstructorPayout({
      instance: lesson,
      rateUsed: rate,
      servicePaymentModel: 'fixed_rate',
      compensationParticipants: [participant('a', 'attended'), participant('b', 'attended'), participant('c', 'no_show')],
    });
    assert.equal(result.participantMultiplier, 1);
    assert.equal(result.payoutAmount, 8000);
  });

  it('PAY-C2 paid per student: one payment per participant who triggers pay', () => {
    const result = resolveLessonInstructorPayout({
      instance: lesson,
      rateUsed: rate,
      servicePaymentModel: 'per_student',
      compensationParticipants: [participant('a', 'attended'), participant('b', 'attended')],
    });
    assert.equal(result.participantMultiplier, 2);
    assert.equal(result.payoutAmount, 16000);
  });

  it('PAY-C3 mixed outcomes: per-student pay counts only participants who trigger pay', () => {
    const participants = [
      participant('a', 'attended'),
      participant('b', 'attended'),
      participant('c', 'no_show'),
      participant('d', 'cancelled_student'),
    ];
    const eligible = resolveCompensationEligibleParticipants(participants, POLICIES, new Set());
    const result = resolveLessonInstructorPayout({
      instance: lesson,
      rateUsed: rate,
      servicePaymentModel: 'per_student',
      compensationParticipants: eligible,
    });
    assert.deepEqual(eligible.map((entry) => entry.id), ['a', 'b', 'c']);
    assert.equal(result.payoutAmount, 24000);
  });

  it('PAY-C4 no participant triggers pay: the lesson earns nothing', () => {
    for (const servicePaymentModel of ['fixed_rate', 'per_student']) {
      const result = resolveLessonInstructorPayout({
        instance: lesson,
        rateUsed: rate,
        servicePaymentModel,
        compensationParticipants: [],
      });
      assert.equal(result.payoutAmount, 0, servicePaymentModel);
    }
  });

  it.todo('PAY-C4 a lesson with no pay shows as "no pay" in the monthly review, not as missing');
});

describe('PAY-D changes to a lesson', () => {
  it.todo('PAY-D1 a substitute instructor is paid at their own rate for that date');
  it.todo('PAY-D2 a length change recalculates an open month and becomes a pay difference for a closed month');
  it.todo('PAY-D3 an attendance fix recalculates an open month and becomes a pay difference for a closed month');
  it.todo('PAY-D4 a lesson moved to another date is paid in the new date\'s month at that date\'s rate');
});

describe('PAY-E hours', () => {
  it.todo('PAY-E1 hourly pay uses the hourly rate valid on each day');
  it.todo('PAY-E2 an instructor\'s lesson hours are derived from the lessons they gave');
  it.todo('PAY-E3 non-instructor hours are self-entered, approved by the office, and unapproved hours block closing');
});

describe('PAY-F monthly salary', () => {
  it('PAY-F2 unpaid leave removes the day\'s pay; paid leave keeps it', () => {
    const [unpaid] = buildLeaveDayRows({ employeeId: 'e', leaveEntryId: 'l1', leaveType: 'unpaid', startDate: '2026-09-01', endDate: '2026-09-01' });
    const [paid] = buildLeaveDayRows({ employeeId: 'e', leaveEntryId: 'l2', leaveType: 'employee_paid', startDate: '2026-09-02', endDate: '2026-09-02' });
    assert.equal(unpaid.pay_fraction, 0);
    assert.equal(paid.pay_fraction, 1);
  });

  it.todo('PAY-F1 joining or leaving mid-month pays the share of working days employed');
});

describe('PAY-G annual leave', () => {
  it('PAY-G2 a half day is paid at half the day\'s value', () => {
    const rows = buildLeaveDayRows({ employeeId: 'e', leaveEntryId: 'l1', leaveType: 'half_day', startDate: '2026-09-01', endDate: '2026-09-01' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pay_fraction, 0.5);
  });

  it('PAY-G1 farm override: a fixed leave-day rate per employee is used as is', () => {
    const value = resolveLeaveDayValue({
      employee: { payroll_model: 'lesson_based', leave_pay_method: 'fixed_rate', leave_fixed_day_rate: 25000 },
      targetDate: '2026-09-10',
    });
    assert.equal(value, 25000);
  });

  // Today's "legal" method averages over *worked* days; the law is 3 months' gross ÷ 90 (see the spec).
  it.todo('PAY-G1 hourly / per-lesson leave day = gross wages of the last 3 months ÷ 90, leave days counted including weekends');
  it.todo('PAY-G1 if the last 3 months were not full, the fullest 3 consecutive months of the last 12 are used');
  it.todo('PAY-G1 monthly-salary employees keep their regular salary during leave');
  it.todo('PAY-G3 paid leave days are their own line in the monthly review');
});

describe('PAY-H monthly cycle', () => {
  it.todo('PAY-H1 each farm has one pay period per month, opened automatically');
  it.todo('PAY-H2 the monthly review lists every employee\'s components and total');
  it.todo('PAY-H3 closing freezes the month, locks its lessons and re-syncs lesson closure');
  it.todo('PAY-H4 closing is blocked by unmarked attendance, missing rates, lessons without an instructor or unapproved hours, with a list of each blocker');
  it.todo('PAY-H5 a closed month is never reopened; later changes become linked pay differences in the next open month');
  it.todo('PAY-H6 the office is reminded to close the month before pay is due on the 9th');
});

describe('PAY-I after closing', () => {
  it.todo('PAY-I1 a correction to a closed month creates a pay difference line "הפרש עבור MM/YYYY" in the next open month');
  it.todo('PAY-I2 a bonus or deduction dated in a closed month lands in the next open month');
});

describe('PAY-J outputs and access', () => {
  it.todo('PAY-J1 a monthly summary per employee and in total, with its lines');
  it.todo('PAY-J2 an Excel / CSV export of the closed month with farm-chosen columns and the legal disclaimer');
  it.todo('PAY-J3 an employee sees their own month read-only');
  it.todo('PAY-J4 owner, admins and office can close a month; nobody can reopen it');
});

describe('PAY-K legal pay components (Israel, dated settings)', () => {
  it.todo('PAY-K1 holiday pay: up to 9 days a year after 3 months, for scheduled work days, average daily hours × hourly rate');
  it.todo('PAY-K2 sick pay: 1.5 days a month up to 90; day 1 unpaid, days 2–3 at 50%, day 4 onward in full');
  it.todo('PAY-K3 recuperation pay after 1 year: days by seniority × the dated day rate, proportional to job scope');
  it.todo('PAY-K4 minimum wage top-up: pay for the hours worked is topped up to the dated hourly minimum (youth rates under 18)');
  it.todo('PAY-K5 travel reimbursement: actual cost up to the dated daily cap, half for one direction');
  it.todo('PAY-K6 every employee\'s actual daily hours are recorded (derived from lessons, or entered and approved)');
  it.todo('PAY-K7 pay for a month is due by the 9th of the following month');
});
