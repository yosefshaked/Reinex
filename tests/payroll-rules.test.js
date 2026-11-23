// Instructor / employee pay rules as executable scenarios.
// Spec: implementations/business-process/payroll-scenarios.md (IDs PAY-A1 … PAY-K7).
// Rules that already exist are real tests against the pure pay helpers. Rules not built yet are
// `it.todo` entries with the same IDs, so the whole spec shows in the test run without failing it;
// each todo becomes a real test when its feature is built (tests before code).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
  LEGAL_LEAVE_MAX_DEPTH,
  buildFinancePolicies,
  buildLeaveDayRows,
  combinePayComponents,
  describeMissingLessonRate,
  legalLeaveDivisor,
  legalLeaveHistoryStart,
  resolveCompensationEligibleParticipants,
  resolveLeaveDayDetail,
  resolveLeaveDayValue,
  resolveLessonInstructorPayout,
} from '../api/_shared/employee-finance.js';
import {
  resolveExplicitInstructorCompensationDecision,
  shouldParticipantTriggerInstructorCompensation,
} from '../api/_shared/calendar-workflow-decisions.js';
import { buildSummaryRows } from '../src/features/finance/lib/pay-summary.js';
import { PAY_BASIS, hasRateKind, resolveLessonRateOnDate, resolveRateOnDate } from '../api/_shared/rate-history.js';

function rateRow(id, employeeId, serviceId, payBasis, rate, effectiveDate) {
  return { id, employee_id: employeeId, service_id: serviceId, pay_basis: payBasis, rate, effective_date: effectiveDate };
}

// An employee's own leave pay method is a dated setting: a version in force from a date.
function methodVersion(employeeId, method, effectiveDate = '2000-01-01') {
  return { key: 'leave_pay_method', employee_id: employeeId, effective_date: effectiveDate, settings_value: { method } };
}

// Dana teaches riding at 100 ₪/hour until 30.9, 120 ₪/hour from 1.10. Omer substitutes at 110 ₪/hour.
// Dana also works office hours at 50 ₪/hour.
const RATES = [
  rateRow('dana-100', 'dana', 'riding', PAY_BASIS.LESSON_HOURLY, 10000, '2026-01-01'),
  rateRow('dana-120', 'dana', 'riding', PAY_BASIS.LESSON_HOURLY, 12000, '2026-10-01'),
  rateRow('omer-110', 'omer', 'riding', PAY_BASIS.LESSON_HOURLY, 11000, '2026-01-01'),
  rateRow('dana-office', 'dana', null, PAY_BASIS.ATTENDANCE_HOURLY, 5000, '2026-01-01'),
];

function lessonPay({ employeeId, date, durationMinutes = 60, serviceId = 'riding', rows = RATES }) {
  const lessonRate = resolveLessonRateOnDate(rows, { employeeId, serviceId, date });
  if (!lessonRate) return null;
  return resolveLessonInstructorPayout({
    instance: { duration_minutes: durationMinutes },
    rateUsed: lessonRate.rate,
    servicePaymentModel: 'fixed_rate',
    compensationParticipants: [{ id: 'p1', participant_status: 'attended' }],
    payBasis: lessonRate.pay_basis,
  }).payoutAmount;
}

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

  it('PAY-A1 a rate from 1.10 pays lessons from 1.10 until the next change; earlier lessons keep the previous rate', () => {
    assert.equal(lessonPay({ employeeId: 'dana', date: '2026-09-30' }), 10000);
    assert.equal(lessonPay({ employeeId: 'dana', date: '2026-10-01' }), 12000);
  });

  it('PAY-A2 a future-dated rate is scheduled and takes effect on its own date', () => {
    const scheduled = [...RATES, rateRow('dana-150', 'dana', 'riding', PAY_BASIS.LESSON_HOURLY, 15000, '2027-01-01')];
    assert.equal(lessonPay({ employeeId: 'dana', date: '2026-12-31', rows: scheduled }), 12000);
    assert.equal(lessonPay({ employeeId: 'dana', date: '2027-01-01', rows: scheduled }), 15000);
  });

  it('PAY-A4 a lesson without a rate for its service and date gets no rate (nothing is guessed)', () => {
    assert.equal(resolveLessonRateOnDate(RATES, { employeeId: 'dana', serviceId: 'hippotherapy', date: '2026-06-01' }), null);
    assert.equal(resolveLessonRateOnDate(RATES, { employeeId: 'dana', serviceId: 'riding', date: '2025-12-31' }), null);
  });

  it('PAY-A5 lesson_flat: the same pay per lesson whatever its length', () => {
    const flat = [rateRow('dana-flat', 'dana', 'group', PAY_BASIS.LESSON_FLAT, 9000, '2026-01-01')];
    assert.equal(lessonPay({ employeeId: 'dana', serviceId: 'group', date: '2026-06-01', durationMinutes: 45, rows: flat }), 9000);
    assert.equal(lessonPay({ employeeId: 'dana', serviceId: 'group', date: '2026-06-01', durationMinutes: 90, rows: flat }), 9000);
  });

  it('PAY-A6 an employee with lesson rates and an hourly rate is paid each part from its own rate', () => {
    assert.equal(resolveRateOnDate(RATES, { employeeId: 'dana', payBasis: PAY_BASIS.ATTENDANCE_HOURLY, date: '2026-10-05' }).rate, 5000);
    assert.equal(resolveLessonRateOnDate(RATES, { employeeId: 'dana', serviceId: 'riding', date: '2026-10-05' }).rate, 12000);

    // Dana taught for 3,000 and did office hours worth 500 in the same month: she is paid both,
    // where the old rule paid whichever single model was on her employee record.
    const both = combinePayComponents({ lessonAmount: 300000, attendanceAmount: 50000 });
    assert.equal(both.baseAmount, 350000);
    assert.equal(both.totalAmount, 350000);

    // Rates she does not have contribute nothing.
    assert.equal(hasRateKind(RATES, { employeeId: 'dana', payBasis: PAY_BASIS.MONTHLY_SALARY }), false);
    assert.equal(hasRateKind(RATES, { employeeId: 'omer', payBasis: PAY_BASIS.ATTENDANCE_HOURLY }), false);
    assert.equal(hasRateKind(RATES, { employeeId: 'dana', payBasis: PAY_BASIS.ATTENDANCE_HOURLY }), true);
  });

  it('PAY-A6 paid leave is added on top, except for a salary that already covers the month', () => {
    const hourly = combinePayComponents({ attendanceAmount: 50000, paidLeaveTotal: 20000, correctionTotal: 5000 });
    assert.equal(hourly.paidLeaveAmount, 20000, 'an hourly employee is paid for the leave day itself');
    assert.equal(hourly.totalAmount, 75000);

    const salaried = combinePayComponents({
      monthlySalaryAmount: 800000,
      paidLeaveTotal: 20000,
      paysMonthlySalary: true,
    });
    assert.equal(salaried.paidLeaveAmount, 0, 'the salary is pro-rated over the month, leave included');
    assert.equal(salaried.totalAmount, 800000, 'so the leave day is not paid twice');
  });

  it('PAY-A4 a lesson before the rate started explains when pay starts and how to cover the lesson', () => {
    const message = describeMissingLessonRate({
      instructorName: 'דנה כהן',
      serviceName: 'שיעור ניסיון',
      lessonDate: '2026-09-15',
      nextRateDate: '2026-10-22',
    });
    assert.match(message, /רק מ-22\.10\.2026/, 'when the existing rate starts');
    assert.match(message, /המפגש הזה ב-15\.09\.2026/, 'when the lesson is');
    assert.match(message, /תעריף שחל מ-15\.09\.2026 או קודם/, 'the fix: a rate dated on or before the lesson');
    assert.match(message, /עובדים ← דנה כהן ← פיננסים/, 'where to do it');

    const none = describeMissingLessonRate({ instructorName: 'דנה כהן', serviceName: 'שיעור ניסיון', lessonDate: '2026-09-15' });
    assert.match(none, /אין תעריף על "שיעור ניסיון"/);
    assert.doesNotMatch(none, /רק מ-/, 'no start date is invented when there is no rate at all');
  });

  it.todo('PAY-A3 a back-dated rate recalculates open months and adds pay differences for closed months');
  it.todo('PAY-A4 a lesson without a rate is flagged "missing rate" in the monthly review and blocks closing');
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

  it('PAY-B8 the earnings policy is read as of the lesson date, so a change from a date leaves earlier months alone', () => {
    // No-shows paid until 30.11; from 1.12 they are not.
    const policies = buildFinancePolicies({
      asOf: '2026-12-15',
      datedRows: [
        { key: 'instructor_earnings_policy', effective_date: '2000-01-01', settings_value: { ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY, no_show: true } },
        { key: 'instructor_earnings_policy', effective_date: '2026-12-01', settings_value: { ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY, no_show: false } },
      ],
    });
    const noShow = participant('p1', 'no_show');
    assert.equal(shouldParticipantTriggerInstructorCompensation(noShow, policies.onDate('2026-11-20')), true, 'November keeps the old policy');
    assert.equal(shouldParticipantTriggerInstructorCompensation(noShow, policies.onDate('2026-12-01')), false, 'from 1.12 the new one');
  });

  it('PAY-B8 only a choice made in the absence form is stored; everything else is left to the policy', () => {
    assert.equal(resolveExplicitInstructorCompensationDecision('no_show', 'unknown'), 'unknown');
    assert.equal(resolveExplicitInstructorCompensationDecision('no_show', undefined), 'unknown');
    assert.equal(resolveExplicitInstructorCompensationDecision('cancelled_student', 'compensated'), 'compensated', 'the absence form choice');
    assert.equal(resolveExplicitInstructorCompensationDecision('cancelled_clinic', 'not_compensated'), 'not_compensated');
    assert.equal(resolveExplicitInstructorCompensationDecision('attended', 'compensated'), 'unknown', 'attendance pays by the policy');
    assert.equal(resolveExplicitInstructorCompensationDecision('scheduled', 'compensated'), 'unknown', 'restoring clears the decision');
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
  it('PAY-D1 a substitute instructor is paid at their own rate for that date', () => {
    assert.equal(lessonPay({ employeeId: 'omer', date: '2026-10-05' }), 11000);
  });

  it('PAY-D4 a lesson moved to another date is paid at the rate valid on the new date', () => {
    assert.equal(lessonPay({ employeeId: 'dana', date: '2026-09-28' }), 10000, 'before the move');
    assert.equal(lessonPay({ employeeId: 'dana', date: '2026-10-02' }), 12000, 'after moving past 1.10');
  });

  it.todo('PAY-D2 a length change recalculates an open month and becomes a pay difference for a closed month');
  it.todo('PAY-D3 an attendance fix recalculates an open month and becomes a pay difference for a closed month');
});

describe('PAY-E hours', () => {
  it('PAY-E1 hourly pay uses the hourly rate valid on each day', () => {
    const rows = [
      rateRow('office-50', 'noa', null, PAY_BASIS.ATTENDANCE_HOURLY, 5000, '2026-01-01'),
      rateRow('office-55', 'noa', null, PAY_BASIS.ATTENDANCE_HOURLY, 5500, '2026-09-15'),
    ];
    const hourlyOn = (date) => resolveRateOnDate(rows, { employeeId: 'noa', payBasis: PAY_BASIS.ATTENDANCE_HOURLY, date }).rate;
    assert.equal(hourlyOn('2026-09-14'), 5000);
    assert.equal(hourlyOn('2026-09-15'), 5500);
  });
  it('PAY-E2 hourly pay reads only the other work entered for the day, never lesson time', () => {
    // A day an instructor taught 120 minutes (on the calendar) and entered 90 minutes of office work.
    const employee = { id: 'dana', leave_pay_method_versions: [methodVersion('dana', 'legal')] };
    const rateRows = [rateRow('dana-office', 'dana', null, PAY_BASIS.ATTENDANCE_HOURLY, 6000, '2026-01-01')];
    const lessonHistory = [{ lesson_date: '2026-09-10', payout_amount: 30000, duration_minutes: 120 }];
    const officeOnly = resolveLeaveDayValue({
      employee, targetDate: '2026-10-20', lessonHistory: [], rateRows,
      attendanceRecords: [{ attendance_date: '2026-09-10', source_type: 'manual', other_minutes: 90 }],
    });
    const mixedDay = resolveLeaveDayValue({
      employee, targetDate: '2026-10-20', lessonHistory, rateRows,
      attendanceRecords: [{ attendance_date: '2026-09-10', source_type: 'manual', other_minutes: 90 }],
    });
    const lessonsOnly = resolveLeaveDayValue({
      employee, targetDate: '2026-10-20', lessonHistory, attendanceRecords: [], rateRows,
    });
    // Leave on 20.10 looks at 07–09.2026. Office: 90 min × 60 ₪ = ₪90 → 9000 ÷ 90 × 7 / 5 = 140;
    // lessons: 30000 → 467; both: 39000 → 607.
    assert.equal(officeOnly, 140, 'the 90 office minutes are paid by the hour');
    assert.equal(mixedDay, 607);
    assert.equal(lessonsOnly, 467);
    assert.ok(mixedDay > lessonsOnly, 'office work is added on top of the lesson pay');
  });

  it('PAY-E2 the leave-day average counts a teaching day once, not as lesson pay plus hourly pay', () => {
    const employee = { id: 'dana', leave_pay_method_versions: [methodVersion('dana', 'legal')] };
    const rateRows = [rateRow('dana-office', 'dana', null, PAY_BASIS.ATTENDANCE_HOURLY, 5000, '2026-01-01')];
    const lessonHistory = [{ lesson_date: '2026-09-10', payout_amount: 30000, duration_minutes: 120 }];
    const attendanceRecords = [{
      attendance_date: '2026-09-10',
      source_type: 'manual',
      other_minutes: 0,
    }];

    const withAttendance = resolveLeaveDayValue({
      employee, targetDate: '2026-10-20', lessonHistory, attendanceRecords, rateRows,
    });
    const lessonsOnly = resolveLeaveDayValue({
      employee, targetDate: '2026-10-20', lessonHistory, attendanceRecords: [], rateRows,
    });

    assert.equal(withAttendance, lessonsOnly, 'a day record with no other work adds nothing on top of the lesson');
  });
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

  it('PAY-G1 farm override: the fixed leave-day rate in effect on the leave date is used as is', () => {
    const employee = { id: 'dana', leave_pay_method_versions: [methodVersion('dana', 'fixed_rate')] };
    const rateRows = [
      rateRow('leave-250', 'dana', null, PAY_BASIS.LEAVE_DAY, 25000, '2026-01-01'),
      rateRow('leave-280', 'dana', null, PAY_BASIS.LEAVE_DAY, 28000, '2026-10-01'),
    ];
    assert.equal(resolveLeaveDayValue({ employee, targetDate: '2026-09-10', rateRows }), 25000);
    assert.equal(resolveLeaveDayValue({ employee, targetDate: '2026-10-10', rateRows }), 28000);
  });

  // "ממוצע מומלץ" (method 'legal'), Annual Leave Law section 10. One NET leave day =
  // (wage base of the chosen 3 months ÷ 90) × 7 ÷ W, W = 6 for a six-day week, else 5.
  describe('PAY-G1 the legal leave-day value', () => {
    const OFFICE_100 = [rateRow('gal-office', 'gal', null, PAY_BASIS.ATTENDANCE_HOURLY, 10000, '2025-01-01')];
    // `count` office days from the 1st of `month`, `minutes` each.
    const officeDays = (month, count, minutes) => Array.from({ length: count }, (_, index) => ({
      attendance_date: `${month}-${String(index + 1).padStart(2, '0')}`,
      other_minutes: minutes,
    }));
    // July, August and September 2026: 18 days × 5 hours × ₪100 = ₪9,000 a month, ₪27,000 in all.
    const FULL_QUARTER = [...officeDays('2026-07', 18, 300), ...officeDays('2026-08', 18, 300), ...officeDays('2026-09', 18, 300)];
    const gal = { id: 'gal', leave_pay_method_versions: [methodVersion('gal', 'legal')] };
    const valueOf = (facts) => resolveLeaveDayDetail({ employee: gal, targetDate: '2026-10-15', rateRows: OFFICE_100, ...facts });

    it('(a) a full quarter of hourly pay: ₪27,000 ÷ 90 × 7/5 = ₪420.00 a day; a six-day week ₪350.00', () => {
      const detail = valueOf({ attendanceRecords: FULL_QUARTER });
      // 2,700,000 agorot ÷ 90 = 30,000 a calendar day; × 7 ÷ 5 = 42,000.
      assert.equal(detail.value, 42000);
      assert.deepEqual(detail.basis, {
        start_month: '2026-07', end_month: '2026-09', worked_days: 54, wage_base: 2700000, divisor: 90, week_days: 5,
      });
      // Six working days (Sunday to Friday): 30,000 × 7 ÷ 6 = 35,000.
      const sixDays = valueOf({ employee: { ...gal, working_days: [0, 1, 2, 3, 4, 5] }, attendanceRecords: FULL_QUARTER });
      assert.equal(sixDays.value, 35000);
      assert.equal(sixDays.basis.week_days, 6);
      // Every day of October has the same value: the window follows the leave month, not the day.
      assert.equal(valueOf({ targetDate: '2026-10-01', attendanceRecords: FULL_QUARTER }).value, 42000);
      assert.equal(valueOf({ targetDate: '2026-10-31', attendanceRecords: FULL_QUARTER }).value, 42000);
    });

    it('(b) the last quarter is not full and an earlier one of the last 12 months has more days: the earlier one is used', () => {
      // 07–09.2026: 5 days × 8 h × ₪100 = ₪4,000. 02–04.2026: 20 days a month × 5 h × ₪100 = ₪30,000 (60 days).
      const attendanceRecords = [
        ...officeDays('2026-09', 5, 480),
        ...officeDays('2026-02', 20, 300), ...officeDays('2026-03', 20, 300), ...officeDays('2026-04', 20, 300),
      ];
      const detail = valueOf({ attendanceRecords });
      // 3,000,000 ÷ 90 × 7 ÷ 5 = 46,666.67 → 46,667.
      assert.equal(detail.value, 46667);
      assert.equal(detail.basis.start_month, '2026-02');
      assert.equal(detail.basis.end_month, '2026-04');
      assert.equal(detail.basis.worked_days, 60);
      // A quarter older than 12 months is never used: 02–04.2025 is out of reach for a leave in 10.2026.
      const tooOld = valueOf({ attendanceRecords: [...officeDays('2026-09', 5, 480), ...officeDays('2025-03', 28, 300)] });
      assert.equal(tooOld.basis.end_month, '2026-09');
      // 400,000 ÷ 90 × 7 ÷ 5 = 6,222.22 → 6,222.
      assert.equal(tooOld.value, 6222);
    });

    it('(c) a tie in days worked goes to the more recent quarter', () => {
      // 07–09.2026: 10 days a month × 6 h × ₪100 = ₪18,000 (30 days). 01–03.2026: 10 days a month × 8 h = ₪24,000 (30 days).
      const attendanceRecords = [
        ...officeDays('2026-07', 10, 360), ...officeDays('2026-08', 10, 360), ...officeDays('2026-09', 10, 360),
        ...officeDays('2026-01', 10, 480), ...officeDays('2026-02', 10, 480), ...officeDays('2026-03', 10, 480),
      ];
      const detail = valueOf({ attendanceRecords });
      assert.equal(detail.basis.start_month, '2026-07');
      // 1,800,000 ÷ 90 × 7 ÷ 5 = 28,000 (the older, better-paid quarter would give 37,333).
      assert.equal(detail.value, 28000);
    });

    it('(d) a new employee is divided by the calendar days employed in the window, not by 90', () => {
      // Started 22.8.2026: 22.8–30.9 is 10 + 30 = 40 days. 20 days × 6 h × ₪100 = ₪12,000.
      const attendanceRecords = officeDays('2026-09', 20, 360);
      const detail = valueOf({ employee: { ...gal, start_date: '2026-08-22' }, attendanceRecords });
      // 1,200,000 ÷ 40 = 30,000 a calendar day; × 7 ÷ 5 = 42,000.
      assert.equal(detail.basis.divisor, 40);
      assert.equal(detail.value, 42000);
      // Assumption: no start_date → ÷ 90. 1,200,000 ÷ 90 × 7 ÷ 5 = 18,666.67 → 18,667.
      assert.equal(valueOf({ attendanceRecords }).value, 18667);
      // Employed since before the window: ÷ 90 too.
      assert.equal(valueOf({ employee: { ...gal, start_date: '2020-01-01' }, attendanceRecords }).basis.divisor, 90);
      assert.equal(legalLeaveDivisor({ start_date: '2026-07-02' }, { start: '2026-07-01', end: '2026-09-30' }), 90, 'never more than 90');
    });

    it('(e) a per-lesson instructor: lesson pay is the wage base', () => {
      // Tal is paid ₪150 a lesson (lesson_flat): 20 lessons a month in 07–09.2026 → 60 × ₪150 = ₪9,000.
      const rows = [rateRow('tal-flat', 'tal', 'riding', PAY_BASIS.LESSON_FLAT, 15000, '2026-01-01')];
      const lessonHistory = ['2026-07', '2026-08', '2026-09'].flatMap((month) => Array.from({ length: 20 }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        return { lesson_date: date, counted: true, payout_amount: lessonPay({ employeeId: 'tal', date, rows }) };
      }));
      assert.equal(lessonHistory[0].payout_amount, 15000);
      const detail = resolveLeaveDayDetail({ employee: { id: 'tal' }, targetDate: '2026-10-15', lessonHistory, rateRows: rows });
      // The organisation default is "legal". 900,000 ÷ 90 × 7 ÷ 5 = 14,000.
      assert.equal(detail.method, 'legal');
      assert.equal(detail.basis.wage_base, 900000);
      assert.equal(detail.value, 14000);
    });

    it('(f) a paid leave day inside the window adds its own value to the wage base, once', () => {
      // 25.8.2026 is a paid leave day (no work that day). Its value: 08.2026 looks at 05–07.2026, which
      // holds only July's ₪9,000: 900,000 ÷ 90 × 7 ÷ 5 = 14,000.
      const leaveDays = [{ leave_date: '2026-08-25', leave_type: 'employee_paid', pay_fraction: 1 }];
      const august = valueOf({ targetDate: '2026-08-25', attendanceRecords: FULL_QUARTER, leaveDays });
      assert.equal(august.value, 14000);
      assert.equal(august.basis.end_month, '2026-07');
      // October: 2,700,000 + 14,000 = 2,714,000 ÷ 90 × 7 ÷ 5 = 42,217.78 → 42,218 (54 + 1 days worked).
      const october = valueOf({ attendanceRecords: FULL_QUARTER, leaveDays });
      assert.equal(october.basis.wage_base, 2714000);
      assert.equal(october.basis.worked_days, 55);
      assert.equal(october.value, 42218);
      // Unpaid leave adds nothing and is not a day worked.
      const unpaid = valueOf({ attendanceRecords: FULL_QUARTER, leaveDays: [{ leave_date: '2026-08-25', leave_type: 'unpaid', pay_fraction: 0 }] });
      assert.equal(unpaid.value, 42000);
      assert.equal(unpaid.basis.worked_days, 54);
    });

    it('(f) leave inside a window is followed back at most LEGAL_LEAVE_MAX_DEPTH windows, and history is read that far', () => {
      assert.equal(LEGAL_LEAVE_MAX_DEPTH, 2);
      // October 2026 leave → 03.2026 leave (within its 12 months) → 06.2025 leave → its window starts 06.2024.
      const history = [
        { leave_date: '2026-03-10', leave_type: 'employee_paid', pay_fraction: 1 },
        { leave_date: '2025-06-10', leave_type: 'system_paid', pay_fraction: 1 },
        { leave_date: '2025-09-10', leave_type: 'unpaid', pay_fraction: 0 },
      ];
      assert.equal(legalLeaveHistoryStart(['2026-10-15'], history), '2024-06-01');
      assert.equal(legalLeaveHistoryStart(['2026-10-15'], []), '2025-10-01');
      assert.equal(legalLeaveHistoryStart([], history), '');
    });

    it('(g) a monthly salary is unchanged: the salary keeps running and no leave pay is added', () => {
      const rows = [rateRow('gal-salary', 'gal', null, PAY_BASIS.MONTHLY_SALARY, 1000000, '2026-01-01'), ...OFFICE_100];
      const detail = resolveLeaveDayDetail({ employee: gal, targetDate: '2026-10-15', rateRows: rows, attendanceRecords: FULL_QUARTER });
      assert.equal(detail.method, 'monthly_salary', 'a salary is not valued by the 3-month rule');
      assert.equal(detail.basis, null);
      const pay = combinePayComponents({ monthlySalaryAmount: 1000000, paidLeaveTotal: detail.value, paysMonthlySalary: true });
      assert.equal(pay.paidLeaveAmount, 0);
      assert.equal(pay.totalAmount, 1000000);
    });

    it('(h) a half day is half the day value', () => {
      const [halfDay] = buildLeaveDayRows({ employeeId: 'gal', leaveEntryId: 'l1', leaveType: 'employee_paid', startDate: '2026-10-15', endDate: '2026-10-15', durationMode: 'half_day' });
      assert.equal(halfDay.pay_fraction, 0.5);
      // 42,000 × 0.5 = 21,000 (computeEmployeePay multiplies the day value by pay_fraction).
      assert.equal(valueOf({ attendanceRecords: FULL_QUARTER }).value * halfDay.pay_fraction, 21000);
    });

    it('(i) no pay in the last 12 months: the day is worth 0 and the summary still shows the leave row', () => {
      const detail = valueOf({});
      assert.equal(detail.value, 0);
      assert.equal(detail.basis.wage_base, 0);
      assert.equal(detail.basis.end_month, '2026-09', 'no days anywhere: the most recent quarter');
      const { rows } = buildSummaryRows({
        paid_leave_amount: 0, total_amount: 0,
        leave_breakdown: { paid_days: 1, day_value: 0, paid_leave_total: 0 },
      });
      const leave = rows.find((row) => row.key === 'leave');
      assert.ok(leave, 'the leave row is there');
      assert.equal(leave.label, 'חופשה: יום אחד');
      assert.equal(leave.amount, 0);
    });
  });
  it('PAY-G3 paid leave days are their own line in the monthly review: days x day value, with the total', () => {
    const { rows } = buildSummaryRows({
      lesson_amount: 10000, lesson_count: 1, attendance_amount: 5000, attendance_minutes: 60,
      paid_leave_amount: 60000, total_amount: 75000,
      leave_breakdown: { paid_days: 2, day_value: 30000, paid_leave_total: 60000 },
    });
    assert.deepEqual(rows.map((row) => row.key), ['lessons', 'attendance', 'leave']);
    const leave = rows.find((row) => row.key === 'leave');
    assert.equal(leave.label, 'חופשה: 2 ימים × ₪300.00');
    assert.equal(leave.amount, 60000);
  });
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
