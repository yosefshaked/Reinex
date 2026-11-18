// Pay computed from the facts (api/_shared/pay-calculation.js): the rules for one lesson as pure
// tests, and the loader and the period total against an in-memory database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
  DEFAULT_LEAVE_PAY_POLICY,
  checkInstructorRateForLesson,
  checkTemplateInstructorRate,
  hasLessonPayDateChanged,
  loadFinancePolicies,
  resolveTemplateRateCheckDate,
  templateUpdateNeedsRateCheck,
  validateInstructorRateForLesson,
} from '../api/_shared/employee-finance.js';
import {
  applyCorrectionOverlay,
  computeEmployeePay,
  loadCountedLessons,
  resolveCountedLesson,
  summarizeLessonsByDate,
  summarizePaidLeave,
} from '../api/_shared/pay-calculation.js';
import { PAY_BASIS } from '../api/_shared/rate-history.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-20T12:00:00Z');
const POLICIES = {
  instructorEarningsPolicy: { ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY },
  leavePayPolicy: { ...DEFAULT_LEAVE_PAY_POLICY },
};

function rateRow(id, employeeId, serviceId, payBasis, rate, effectiveDate) {
  return { id, org_id: ORG, employee_id: employeeId, service_id: serviceId, pay_basis: payBasis, rate, effective_date: effectiveDate };
}

// Dana teaches riding at 100 ₪/hour until 30.9 and 120 ₪/hour from 1.10. Omer teaches at 110 ₪/hour.
const RATES = [
  rateRow('dana-100', 'dana', 'riding', PAY_BASIS.LESSON_HOURLY, 10000, '2026-01-01'),
  rateRow('dana-120', 'dana', 'riding', PAY_BASIS.LESSON_HOURLY, 12000, '2026-10-01'),
  rateRow('omer-110', 'omer', 'riding', PAY_BASIS.LESSON_HOURLY, 11000, '2026-01-01'),
  rateRow('dana-office', 'dana', null, PAY_BASIS.ATTENDANCE_HOURLY, 5000, '2026-01-01'),
];

function lesson(id, employeeId, start, overrides = {}) {
  return {
    id,
    org_id: ORG,
    instructor_employee_id: employeeId,
    service_id: 'riding',
    datetime_start: start,
    duration_minutes: 60,
    status: 'scheduled',
    ...overrides,
  };
}

function participant(id, lessonId, status, decision = null) {
  return {
    id,
    org_id: ORG,
    lesson_instance_id: lessonId,
    student_id: `student-${id}`,
    participant_status: status,
    metadata: decision ? { workflow: { instructor_compensation: { decision } } } : {},
  };
}

const counted = (instance, participants, extra = {}) => resolveCountedLesson({
  instance, participants, policies: POLICIES, rateRows: RATES, now: NOW, ...extra,
});

describe('one lesson', () => {
  it('a marked lesson pays the rate valid on the lesson date', () => {
    const september = counted(lesson('l1', 'dana', '2026-09-28T08:00:00Z'), [participant('p1', 'l1', 'attended')]);
    const october = counted(lesson('l2', 'dana', '2026-10-05T08:00:00Z'), [participant('p2', 'l2', 'attended')]);
    assert.equal(september.payout_amount, 10000);
    assert.equal(october.payout_amount, 12000);
    assert.equal(october.rate_history_id, 'dana-120');
    assert.equal(october.unmarked, false);
  });

  it('a lesson that ended and nobody marked is paid as attended and flagged as unmarked', () => {
    const result = counted(lesson('l1', 'dana', '2026-10-05T08:00:00Z'), [participant('p1', 'l1', 'scheduled')]);
    assert.equal(result.counted, true);
    assert.equal(result.payout_amount, 12000);
    assert.equal(result.unmarked, true);
    assert.equal(result.unmarked_amount, 12000);
  });

  it('a lesson that has not ended yet pays nothing', () => {
    const result = counted(lesson('l1', 'dana', '2026-10-25T08:00:00Z'), [participant('p1', 'l1', 'scheduled')]);
    assert.equal(result.counted, false);
    assert.equal(result.payout_amount, 0);
  });

  it('a cancelled lesson is never assumed to have taken place', () => {
    const result = counted(
      lesson('l1', 'dana', '2026-10-05T08:00:00Z', { status: 'cancelled' }),
      [participant('p1', 'l1', 'scheduled')],
    );
    assert.equal(result.counted, false);
  });

  it('an unmarked participant the office decided not to pay for stays unpaid', () => {
    const result = counted(
      lesson('l1', 'dana', '2026-10-05T08:00:00Z'),
      [participant('p1', 'l1', 'scheduled', 'not_compensated')],
    );
    assert.equal(result.counted, false);
  });

  it('once per lesson: an unmarked rider next to a marked one puts no money at stake', () => {
    const result = counted(
      lesson('l1', 'dana', '2026-10-05T08:00:00Z'),
      [participant('p1', 'l1', 'attended'), participant('p2', 'l1', 'scheduled')],
    );
    assert.equal(result.payout_amount, 12000);
    assert.equal(result.unmarked, true);
    assert.equal(result.unmarked_amount, 0);
  });

  it('per rider: only the unmarked rider\'s share is at stake', () => {
    const result = counted(
      lesson('l1', 'dana', '2026-10-05T08:00:00Z'),
      [participant('p1', 'l1', 'attended'), participant('p2', 'l1', 'scheduled'), participant('p3', 'l1', 'cancelled_student')],
      { servicePaymentModel: 'per_student' },
    );
    assert.equal(result.paid_participant_count, 2);
    assert.equal(result.payout_amount, 24000);
    assert.equal(result.unmarked_amount, 12000);
  });

  it('a lesson before the instructor\'s first rate counts, pays nothing and is flagged', () => {
    const result = counted(lesson('l1', 'dana', '2025-12-10T08:00:00Z'), [participant('p1', 'l1', 'attended')]);
    assert.equal(result.counted, true);
    assert.equal(result.missing_rate, true);
    assert.equal(result.payout_amount, 0);
  });

  it('an excused absence pays nothing even when the status alone would', () => {
    const result = counted(
      lesson('l1', 'dana', '2026-10-05T08:00:00Z'),
      [participant('p1', 'l1', 'no_show')],
      { graceParticipantIds: new Set(['p1']) },
    );
    assert.equal(result.counted, false);
  });

  it('the lesson date is the farm\'s date, not the UTC date', () => {
    // 22:30 UTC on 30.9 is already 1.10 in Israel, so the October rate applies.
    const result = counted(lesson('l1', 'dana', '2026-09-30T22:30:00Z'), [participant('p1', 'l1', 'attended')]);
    assert.equal(result.lesson_date, '2026-10-01');
    assert.equal(result.payout_amount, 12000);
  });

  it('lists each rider\'s state as marked, and an assumed attendance as unmarked', () => {
    const result = counted(
      lesson('l1', 'dana', '2026-10-05T08:00:00Z'),
      [participant('p1', 'l1', 'attended'), participant('p2', 'l1', 'scheduled'), participant('p3', 'l1', 'no_show')],
      { servicePaymentModel: 'per_student' },
    );
    assert.deepEqual(result.participant_states, { attended: 1, unmarked: 1, no_show: 1 });
    // 08:00 UTC is 11:00 in Israel in October (summer time).
    assert.equal(result.start_time, '11:00');
  });

  it('a correction replaces the instructor and the outcome the lesson is paid by', () => {
    const original = lesson('l1', 'dana', '2026-10-05T08:00:00Z');
    const { instance, participants } = applyCorrectionOverlay(original, [participant('p1', 'l1', 'attended')], {
      effective_state: {
        instance: { instructor_employee_id: 'omer' },
        participants: [participant('p1', 'l1', 'attended')],
      },
    });
    const result = counted(instance, participants);
    assert.equal(result.employee_id, 'omer');
    assert.equal(result.payout_amount, 11000);
  });
});

// ---------------------------------------------------------------------------------------------
// An in-memory stand-in for the database client: enough of the query builder for the loader.
// ---------------------------------------------------------------------------------------------
function createFakeClient(tables) {
  const calls = [];
  function builder(table) {
    const filters = [];
    let window = null;
    const api = {
      select() { return api; },
      eq(column, value) { filters.push((row) => row[column] === value); return api; },
      in(column, values) { filters.push((row) => values.includes(row[column])); return api; },
      gte(column, value) { filters.push((row) => String(row[column]) >= String(value)); return api; },
      lte(column, value) { filters.push((row) => String(row[column]) <= String(value)); return api; },
      lt(column, value) { filters.push((row) => String(row[column]) < String(value)); return api; },
      order() { return api; },
      range(from, to) { window = [from, to]; return api; },
      maybeSingle() {
        calls.push(table);
        const row = (tables[table] || []).find((candidate) => filters.every((filter) => filter(candidate))) || null;
        return Promise.resolve({ data: row, error: null });
      },
      then(resolve, reject) {
        calls.push(table);
        const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
        const data = window ? rows.slice(window[0], window[1] + 1) : rows;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from: builder, calls };
}

function baseTables(extra = {}) {
  return {
    lesson_instances: [],
    lesson_participants: [],
    calendar_instance_corrections: [],
    grace_cancellation_requests: [],
    Services: [{ id: 'riding', org_id: ORG, name: 'רכיבה', payment_model: 'fixed_rate' }],
    RateHistory: RATES,
    Settings: [],
    employee_attendance_records: [],
    employee_leave_days: [],
    employee_leave_entries: [],
    finance_corrections: [],
    ...extra,
  };
}

describe('the lessons of a period', () => {
  it('returns one instructor\'s counted lessons inside the dates, oldest first', async () => {
    const client = createFakeClient(baseTables({
      lesson_instances: [
        lesson('october', 'dana', '2026-10-05T08:00:00Z'),
        lesson('september', 'dana', '2026-09-28T08:00:00Z'),
        lesson('omer-lesson', 'omer', '2026-10-06T08:00:00Z'),
        lesson('future', 'dana', '2026-10-28T08:00:00Z'),
      ],
      lesson_participants: [
        participant('p1', 'october', 'attended'),
        participant('p2', 'september', 'attended'),
        participant('p3', 'omer-lesson', 'attended'),
        participant('p4', 'future', 'scheduled'),
      ],
    }));

    const lessons = await loadCountedLessons(client, ORG, {
      employeeId: 'dana', startDate: '2026-10-01', endDate: '2026-10-31', policies: POLICIES, now: NOW,
    });

    assert.deepEqual(lessons.map((row) => row.lesson_instance_id), ['october']);
    assert.equal(lessons[0].service_name, 'רכיבה');
    assert.equal(lessons[0].payout_amount, 12000);
  });

  it('a lesson corrected over to another instructor is paid to that instructor only', async () => {
    const tables = baseTables({
      lesson_instances: [lesson('moved', 'dana', '2026-10-05T08:00:00Z')],
      lesson_participants: [participant('p1', 'moved', 'attended')],
      calendar_instance_corrections: [{
        id: 'c1',
        org_id: ORG,
        original_instance_id: 'moved',
        status: 'applied',
        created_at: '2026-10-06T10:00:00Z',
        effective_state: { instance: { instructor_employee_id: 'omer' }, participants: [] },
      }],
    });
    const period = { startDate: '2026-10-01', endDate: '2026-10-31', policies: POLICIES, now: NOW };

    const dana = await loadCountedLessons(createFakeClient(tables), ORG, { employeeId: 'dana', ...period });
    const omer = await loadCountedLessons(createFakeClient(tables), ORG, { employeeId: 'omer', ...period });

    assert.deepEqual(dana, []);
    assert.equal(omer.length, 1);
    assert.equal(omer[0].payout_amount, 11000);
  });

  it('adds up lesson minutes per day for the days tab', async () => {
    const client = createFakeClient(baseTables({
      lesson_instances: [
        lesson('a', 'dana', '2026-10-05T08:00:00Z'),
        lesson('b', 'dana', '2026-10-05T10:00:00Z', { duration_minutes: 45 }),
        lesson('c', 'dana', '2026-10-06T08:00:00Z'),
      ],
      lesson_participants: [
        participant('p1', 'a', 'attended'),
        participant('p2', 'b', 'scheduled'),
        participant('p3', 'c', 'cancelled_student'),
      ],
    }));

    const byDate = summarizeLessonsByDate(await loadCountedLessons(client, ORG, {
      employeeId: 'dana', startDate: '2026-10-01', endDate: '2026-10-31', policies: POLICIES, now: NOW,
    }));

    assert.deepEqual([...byDate.keys()], ['2026-10-05']);
    assert.equal(byDate.get('2026-10-05').lesson_minutes, 105);
    assert.equal(byDate.get('2026-10-05').unmarked_lesson_count, 1);
  });
});

describe('the pay of a period', () => {
  it('a lesson at 00:30 Israel time on the 1st is paid in that month and its lesson-day is the 1st', async () => {
    // 00:30 on 1.11.2026 (winter time, UTC+2) is 22:30Z on 31.10: its UTC date is the previous month.
    const tables = baseTables({
      lesson_instances: [lesson('after-midnight', 'dana', '2026-10-31T22:30:00Z')],
      lesson_participants: [participant('p1', 'after-midnight', 'attended')],
    });
    const later = new Date('2026-11-20T12:00:00Z');
    const payFor = (startDate, endDate) => computeEmployeePay(createFakeClient(tables), ORG, {
      employee: { id: 'dana' }, startDate, endDate, policies: POLICIES, rateRows: RATES, now: later, includeDetails: true,
    });

    const november = await payFor('2026-11-01', '2026-11-30');
    const october = await payFor('2026-10-01', '2026-10-31');

    assert.equal(november.lesson_count, 1);
    assert.equal(november.lesson_amount, 12000);
    assert.equal(november.details.lessons[0].lesson_date, '2026-11-01');
    assert.equal(november.details.lessons[0].start_time, '00:30');
    assert.equal(october.lesson_count, 0);
    assert.equal(october.lesson_amount, 0);

    const byDate = summarizeLessonsByDate(await loadCountedLessons(createFakeClient(tables), ORG, {
      employeeId: 'dana', startDate: '2026-11-01', endDate: '2026-11-30', policies: POLICIES, now: later,
    }));
    assert.deepEqual([...byDate.keys()], ['2026-11-01'], 'the attendance lesson-day is the local day');
  });

  it('adds lessons, office hours and hand-entered corrections, and reports what is unmarked', async () => {
    const client = createFakeClient(baseTables({
      lesson_instances: [
        lesson('marked', 'dana', '2026-10-05T08:00:00Z'),
        lesson('unmarked', 'dana', '2026-10-06T08:00:00Z'),
      ],
      lesson_participants: [
        participant('p1', 'marked', 'attended'),
        participant('p2', 'unmarked', 'scheduled'),
      ],
      employee_attendance_records: [{
        id: 'a1', org_id: ORG, employee_id: 'dana', attendance_date: '2026-10-05', source_type: 'manual', other_minutes: 90,
      }],
      finance_corrections: [{
        id: 'f1', org_id: ORG, employee_id: 'dana', correction_type: 'bonus', amount: 5000, effective_date: '2026-10-10',
      }],
    }));

    const pay = await computeEmployeePay(client, ORG, {
      employee: { id: 'dana', first_name: 'דנה' },
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      policies: POLICIES,
      rateRows: RATES,
      now: NOW,
      includeDetails: true,
    });

    assert.equal(pay.lesson_amount, 24000);
    assert.equal(pay.lesson_count, 2);
    assert.equal(pay.unmarked_lesson_count, 1);
    assert.equal(pay.unmarked_lesson_amount, 12000);
    assert.equal(pay.attendance_amount, 7500);
    assert.equal(pay.correction_amount, 5000);
    assert.equal(pay.total_amount, 36500);
    assert.equal(pay.details.lessons.length, 2);
    // What the monthly summary lists per lesson: the farm's date and time and each rider's state.
    const [marked, unmarked] = pay.details.lessons;
    assert.equal(marked.lesson_date, '2026-10-05');
    assert.equal(marked.start_time, '11:00');
    assert.deepEqual(marked.participant_states, { attended: 1 });
    assert.deepEqual(unmarked.participant_states, { unmarked: 1 });
    assert.deepEqual(pay.details.attendance, [{ attendance_date: '2026-10-05', other_minutes: 90, rate_used: 5000, amount: 7500 }]);
    assert.equal(pay.corrections.length, 1);
  });

  it('reassigning one lesson to another instructor moves its pay and its minutes to that instructor', async () => {
    const tables = baseTables({
      lesson_instances: [
        lesson('stays', 'dana', '2026-10-05T08:00:00Z'),
        lesson('reassigned', 'dana', '2026-10-06T08:00:00Z', { duration_minutes: 45 }),
      ],
      lesson_participants: [
        participant('p1', 'stays', 'attended'),
        participant('p2', 'reassigned', 'attended'),
      ],
    });
    const period = { startDate: '2026-10-01', endDate: '2026-10-31', policies: POLICIES, rateRows: RATES, now: NOW };
    const payOf = (employeeId) => computeEmployeePay(createFakeClient(tables), ORG, { ...period, employee: { id: employeeId } });
    const minutesOf = async (employeeId) => summarizeLessonsByDate(
      await loadCountedLessons(createFakeClient(tables), ORG, { ...period, employeeId }),
    );

    const danaBefore = await payOf('dana');
    assert.equal(danaBefore.lesson_amount, 12000 + 9000);
    assert.equal(danaBefore.lesson_minutes, 105);
    assert.equal((await payOf('omer')).lesson_amount, 0);

    // The office gives the 6.10 lesson to Omer (calendar edit: the lesson row's instructor changes).
    // Omer has a riding rate on that date, so the change is allowed.
    assert.equal(await validateInstructorRateForLesson(createFakeClient(tables), {
      orgId: ORG, instructorEmployeeId: 'omer', serviceId: 'riding', lessonDate: '2026-10-06T08:00:00Z',
    }), null);
    tables.lesson_instances[1] = { ...tables.lesson_instances[1], instructor_employee_id: 'omer' };

    const danaAfter = await payOf('dana');
    const omerAfter = await payOf('omer');
    assert.equal(danaAfter.lesson_amount, 12000, 'Dana keeps only the lesson she still teaches');
    assert.equal(danaAfter.lesson_minutes, 60);
    assert.equal(omerAfter.lesson_amount, 8250, 'Omer is paid 45 minutes at his own 110 ₪/hour');
    assert.equal(omerAfter.lesson_minutes, 45);
    assert.deepEqual([...(await minutesOf('dana')).keys()], ['2026-10-05']);
    assert.equal((await minutesOf('omer')).get('2026-10-06').lesson_minutes, 45);
  });

  it('a lesson cannot be given to an instructor without a rate for its service on its date', async () => {
    const tables = baseTables({
      Employees: [{ id: 'noa', org_id: ORG, first_name: 'נועה', last_name: 'לוי' }],
    });
    const blocked = await validateInstructorRateForLesson(createFakeClient(tables), {
      orgId: ORG, instructorEmployeeId: 'noa', serviceId: 'riding', lessonDate: '2026-10-06T08:00:00Z',
    });
    assert.equal(blocked.code, 'instructor_rate_not_configured');
    assert.equal(blocked.instructor_employee_id, 'noa');
    assert.equal(blocked.service_id, 'riding');
    assert.equal(blocked.rate_date, '2026-10-06');
    assert.match(blocked.message, /לנועה לוי אין תעריף על "רכיבה"/);
  });

  it('a rate added for a past date changes the pay of that month straight away', async () => {
    const tables = baseTables({
      lesson_instances: [lesson('old', 'noa', '2026-09-10T08:00:00Z')],
      lesson_participants: [participant('p1', 'old', 'attended')],
    });
    const period = {
      employee: { id: 'noa' }, startDate: '2026-09-01', endDate: '2026-09-30', policies: POLICIES, now: NOW,
    };

    const before = await computeEmployeePay(createFakeClient(tables), ORG, { ...period, rateRows: [] });
    const after = await computeEmployeePay(createFakeClient(tables), ORG, {
      ...period,
      rateRows: [rateRow('noa-90', 'noa', 'riding', PAY_BASIS.LESSON_FLAT, 9000, '2026-09-01')],
    });

    assert.equal(before.lesson_amount, 0);
    assert.equal(before.missing_rate_lesson_count, 1);
    assert.equal(after.lesson_amount, 9000);
    assert.equal(after.missing_rate_lesson_count, 0);
  });
});

describe('policies read as of the date they apply to (dated settings)', () => {
  // No-shows pay the instructor until 30.11 and not from 1.12. Pay is read in mid-December.
  const LATER = new Date('2026-12-20T12:00:00Z');
  const earnings = (id, effectiveDate, noShow) => ({
    id, org_id: ORG, key: 'instructor_earnings_policy', effective_date: effectiveDate,
    settings_value: { ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY, no_show: noShow },
  });
  const FROM_DECEMBER = [earnings('v-start', '2000-01-01', true), earnings('v-dec', '2026-12-01', false)];
  const noShowTables = (versions, decision = null) => baseTables({
    SettingsHistory: versions,
    lesson_instances: [
      lesson('nov', 'dana', '2026-11-10T08:00:00Z'),
      lesson('dec', 'dana', '2026-12-08T08:00:00Z'),
    ],
    lesson_participants: [
      participant('p-nov', 'nov', 'no_show', decision),
      participant('p-dec', 'dec', 'no_show'),
    ],
  });
  const payFor = (tables, startDate, endDate, extra = {}) => computeEmployeePay(createFakeClient(tables), ORG, {
    employee: { id: 'dana' }, startDate, endDate, rateRows: RATES, now: LATER, ...extra,
  });

  it('a change effective 1 December does not change a November lesson', async () => {
    const tables = noShowTables(FROM_DECEMBER);
    const november = await payFor(tables, '2026-11-01', '2026-11-30');
    const december = await payFor(tables, '2026-12-01', '2026-12-31');
    assert.equal(november.lesson_amount, 12000, 'the November no-show is paid by the policy of November');
    assert.equal(december.lesson_amount, 0, 'the December no-show is not');

    // Read with today's policies (as a caller meaning "now" does), November still resolves by its own date.
    const today = await loadFinancePolicies(createFakeClient(tables), ORG, { asOf: '2026-12-20' });
    assert.equal(today.instructorEarningsPolicy.no_show, false);
    const withToday = await payFor(tables, '2026-11-01', '2026-11-30', { policies: today });
    assert.equal(withToday.lesson_amount, 12000);
  });

  it('a back-dated change does change the months it reaches', async () => {
    const tables = noShowTables([...FROM_DECEMBER, earnings('v-nov', '2026-11-01', false)]);
    const november = await payFor(tables, '2026-11-01', '2026-11-30');
    assert.equal(november.lesson_amount, 0);
  });

  it('a choice made in the absence form overrides the policy for that participant', async () => {
    const paidAnyway = await payFor(
      noShowTables([...FROM_DECEMBER, earnings('v-nov', '2026-11-01', false)], 'compensated'),
      '2026-11-01',
      '2026-11-30',
    );
    assert.equal(paidAnyway.lesson_amount, 12000);
    const notPaid = await payFor(noShowTables(FROM_DECEMBER, 'not_compensated'), '2026-11-01', '2026-11-30');
    assert.equal(notPaid.lesson_amount, 0, 'even though November pays no-shows');
  });

  it('a leave day is valued by the leave-pay policy in force on that day', async () => {
    // Until 14.11 the org default is a fixed 300 ₪ a day; from 15.11 the legal average.
    const leavePolicy = (id, effectiveDate, value) => ({
      id, org_id: ORG, key: 'leave_pay_policy', effective_date: effectiveDate, settings_value: value,
    });
    const leaveDay = (id, date) => ({
      id, org_id: ORG, leave_entry_id: `entry-${id}`, employee_id: 'dana', leave_date: date,
      day_portion: 'full_day', leave_type: 'employee_paid', balance_days_delta: -1, pay_fraction: 1,
    });
    const tables = baseTables({
      SettingsHistory: [
        leavePolicy('l-start', '2000-01-01', { default_method: 'fixed_rate', lookback_months: 3, fixed_rate_default: 30000 }),
        leavePolicy('l-nov', '2026-11-15', { default_method: 'legal', lookback_months: 3, fixed_rate_default: 0 }),
      ],
      // One worked day in the months before: 20.10, one hour at 120 ₪.
      lesson_instances: [lesson('oct', 'dana', '2026-10-20T08:00:00Z')],
      lesson_participants: [participant('p-oct', 'oct', 'attended')],
      employee_leave_days: [leaveDay('before', '2026-11-10'), leaveDay('after', '2026-11-20')],
      employee_leave_entries: [
        { id: 'entry-before', org_id: ORG, employee_id: 'dana', status: 'approved' },
        { id: 'entry-after', org_id: ORG, employee_id: 'dana', status: 'approved' },
      ],
    });

    const november = await payFor(tables, '2026-11-01', '2026-11-30', { includeDetails: true });
    const byDate = Object.fromEntries(november.details.leave.map((row) => [row.leave_date, row.amount]));
    assert.equal(byDate['2026-11-10'], 30000, 'the fixed value in force on 10.11');
    // 20.11 is legal: the window is 08–10.2026 (the only worked day is 20.10, 120 ₪), no start_date so ÷ 90:
    // 12000 ÷ 90 × 7 / 5 = 186.67 → 187 agorot. The fixed day on 10.11 is in November, outside the window.
    assert.equal(byDate['2026-11-20'], 187, 'the legal value in force on 20.11');
    assert.equal(november.paid_leave_amount, 30187);
    assert.equal(november.leave_breakdown.paid_days, 2);
    assert.equal(november.leave_breakdown.day_value, null, 'the two days are worth different amounts, so no single day value');
  });

  it('the leave line counts paid days and gives the day value when every day is worth the same', () => {
    assert.deepEqual(summarizePaidLeave([]), { days: 0, dayValue: null });
    const same = summarizePaidLeave([
      { pay_fraction: 1, amount: 30000 }, { pay_fraction: 0.5, amount: 15001 }, { pay_fraction: 0, amount: 0 },
    ]);
    assert.deepEqual(same, { days: 1.5, dayValue: 30000 });
    assert.equal(summarizePaidLeave([{ pay_fraction: 1, amount: 30000 }, { pay_fraction: 1, amount: 12000 }]).dayValue, null);
  });
});

describe('PAY-G1 the "ממוצע מומלץ" leave value through the monthly pay', () => {
  const GAL_RATES = [rateRow('gal-office', 'gal', null, PAY_BASIS.ATTENDANCE_HOURLY, 10000, '2025-01-01')];
  const office = (date, minutes) => ({ id: `att-${date}`, org_id: ORG, employee_id: 'gal', attendance_date: date, other_minutes: minutes });
  const leaveDay = (id, date, fraction, leaveType = 'employee_paid') => ({
    id, org_id: ORG, leave_entry_id: `entry-${id}`, employee_id: 'gal', leave_date: date,
    day_portion: fraction < 1 ? 'first_half' : 'full_day', leave_type: leaveType, balance_days_delta: -fraction, pay_fraction: fraction,
  });
  const entry = (id) => ({ id: `entry-${id}`, org_id: ORG, employee_id: 'gal', status: 'approved' });
  const payFor = (tables) => computeEmployeePay(createFakeClient(tables), ORG, {
    employee: { id: 'gal', working_days: [0, 1, 2, 3, 4] }, startDate: '2026-10-01', endDate: '2026-10-31',
    policies: POLICIES, rateRows: GAL_RATES, now: new Date('2026-11-05T12:00:00Z'), includeDetails: true,
  });

  it('values October leave by 07–09 (with the paid leave day inside), a full day and a half day', async () => {
    // 07–09.2026: 18 days × 5 h × ₪100 a month = ₪27,000. 25.8 is a paid leave day: its own window
    // 05–07 holds ₪9,000 → 900,000 ÷ 90 × 7 ÷ 5 = 14,000. October's base: 2,714,000 ÷ 90 × 7 ÷ 5
    // = 42,217.78 → 42,218 a day; 14.10 full = 42,218, 15.10 half = 21,109; total 63,327.
    // October's own office hours are paid as hours and are not part of the October leave value.
    const attendance = ['2026-07', '2026-08', '2026-09'].flatMap((month) => Array.from({ length: 18 }, (_, index) => (
      office(`${month}-${String(index + 1).padStart(2, '0')}`, 300)
    )));
    const pay = await payFor(baseTables({
      employee_attendance_records: [...attendance, office('2026-10-05', 600)],
      employee_leave_days: [leaveDay('aug', '2026-08-25', 1), leaveDay('full', '2026-10-14', 1), leaveDay('half', '2026-10-15', 0.5)],
      employee_leave_entries: [entry('aug'), entry('full'), entry('half')],
    }));
    const byDate = Object.fromEntries(pay.details.leave.map((row) => [row.leave_date, row]));
    assert.equal(byDate['2026-10-14'].amount, 42218);
    assert.equal(byDate['2026-10-15'].amount, 21109);
    assert.equal(pay.paid_leave_amount, 63327);
    assert.equal(pay.attendance_amount, 100000, 'October: 10 h × ₪100');
    assert.equal(pay.total_amount, 163327);
    assert.deepEqual(pay.leave_breakdown.paid_days, 1.5);
    assert.equal(pay.leave_breakdown.day_value, 42218);
    assert.deepEqual(byDate['2026-10-14'].basis, {
      start_month: '2026-07', end_month: '2026-09', worked_days: 55, wage_base: 2714000, divisor: 90, week_days: 5,
    });
    assert.equal(byDate['2026-10-14'].day_value, 42218);
  });

  it('with no pay before the leave the day is worth 0 and the leave is still listed', async () => {
    const pay = await payFor(baseTables({
      employee_leave_days: [leaveDay('only', '2026-10-14', 1)],
      employee_leave_entries: [entry('only')],
    }));
    assert.equal(pay.paid_leave_amount, 0);
    assert.equal(pay.leave_breakdown.paid_days, 1);
    assert.equal(pay.details.leave.length, 1);
    assert.equal(pay.details.leave[0].amount, 0);
    assert.equal(pay.details.leave[0].basis.wage_base, 0);
  });
});

describe('the missing-rate check as endpoints use it', () => {
  const noa = { Employees: [{ id: 'noa', org_id: ORG, first_name: 'נועה', last_name: 'לוי' }] };

  it('returns null when the instructor has a rate for the service on that date', async () => {
    assert.equal(await checkInstructorRateForLesson(createFakeClient(baseTables()), {
      orgId: ORG, instructorEmployeeId: 'dana', serviceId: 'riding', lessonDate: '2026-10-06T08:00:00Z',
    }), null);
  });

  it('returns the 422 body when the rate is missing', async () => {
    const result = await checkInstructorRateForLesson(createFakeClient(baseTables(noa)), {
      orgId: ORG, instructorEmployeeId: 'noa', serviceId: 'riding', lessonDate: '2026-10-06T08:00:00Z',
    });
    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'instructor_rate_not_configured');
    assert.equal(result.body.rate_date, '2026-10-06');
    assert.equal(result.error, undefined);
  });

  it('returns a 500 with the error, for the endpoint tracked responder, when the lookup throws', async () => {
    const failure = new Error('db down');
    const logged = [];
    const brokenClient = { from() { throw failure; } };
    const result = await checkInstructorRateForLesson(brokenClient, {
      orgId: ORG, instructorEmployeeId: 'dana', serviceId: 'riding', lessonDate: '2026-10-06T08:00:00Z',
    }, { log: { error: (...args) => logged.push(args) } });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { message: 'failed_to_validate_instructor_rate' });
    assert.equal(result.error, failure);
    assert.equal(logged.length, 1);
  });

  it('a template is checked on its first lesson: its start date, or today when it started earlier', async () => {
    assert.equal(resolveTemplateRateCheckDate('2026-12-01', '2026-11-15'), '2026-12-01');
    assert.equal(resolveTemplateRateCheckDate('2026-09-01', '2026-11-15'), '2026-11-15');
    assert.equal(resolveTemplateRateCheckDate('', '2026-11-15'), '2026-11-15');

    const result = await checkTemplateInstructorRate(createFakeClient(baseTables(noa)), ORG, {
      instructorEmployeeId: 'noa', serviceId: 'riding', validFrom: '2026-09-01', today: '2026-11-15',
    });
    assert.equal(result.status, 422);
    assert.equal(result.body.rate_date, '2026-11-15');
  });
});

describe('when a lesson move changes its pay date', () => {
  it('compares the Israel date, not the UTC date, near midnight', () => {
    // 1.10 at 01:00 Israel time is 30.9 22:00 UTC. Moved to 30.9 at 10:00 Israel (07:00 UTC): the UTC
    // date stays 30.9, but the pay date moves from 1.10 to 30.9.
    assert.equal(hasLessonPayDateChanged('2026-09-30T22:00:00.000Z', '2026-09-30T07:00:00.000Z'), true);
    // 30.9 at 23:30 Israel (20:30 UTC) moved to 1.10 at 00:30 Israel (21:30 UTC, still 30.9 in UTC).
    assert.equal(hasLessonPayDateChanged('2026-09-30T20:30:00.000Z', '2026-09-30T21:30:00.000Z'), true);
  });

  it('a new time on the same Israel day is not a date change, even across the UTC midnight', () => {
    // 1.10 at 01:00 Israel (30.9 UTC) moved to 1.10 at 09:00 Israel (1.10 UTC).
    assert.equal(hasLessonPayDateChanged('2026-09-30T22:00:00.000Z', '2026-10-01T06:00:00.000Z'), false);
  });

  it('no new start time is no change', () => {
    assert.equal(hasLessonPayDateChanged('2026-10-01T06:00:00.000Z', undefined), false);
  });
});

describe('which template edits need a rate', () => {
  const template = { instructor_employee_id: 'dana', service_id: 'riding', valid_from: '2026-10-01', is_active: true };

  it('adding or removing riders, or changing only the time, is not checked', () => {
    assert.equal(templateUpdateNeedsRateCheck(template, {}), false);
    assert.equal(templateUpdateNeedsRateCheck(template, { time_of_day: '10:00', day_of_week: 'sun' }), false);
    assert.equal(templateUpdateNeedsRateCheck(template, { instructor_employee_id: 'dana' }), false, 'the same instructor is no change');
  });

  it('a new instructor, service or start date is checked', () => {
    assert.equal(templateUpdateNeedsRateCheck(template, { instructor_employee_id: 'omer' }), true);
    assert.equal(templateUpdateNeedsRateCheck(template, { service_id: 'therapy' }), true);
    assert.equal(templateUpdateNeedsRateCheck(template, { valid_from: '2026-11-01' }), true);
  });

  it('switching a template back on is checked', () => {
    const inactive = { ...template, is_active: false };
    assert.equal(templateUpdateNeedsRateCheck(inactive, { is_active: true, valid_from: inactive.valid_from }), true);
    assert.equal(templateUpdateNeedsRateCheck(template, { is_active: true }), false, 'already on');
  });
});

describe('marking attendance is never blocked by a missing rate', () => {
  // There is no endpoint-level harness for api/calendar-attendance, so this guards the module:
  // the mark path must not call the missing-rate check (a lesson without a rate counts and pays nothing).
  it('the attendance endpoint does not use the rate check', () => {
    const source = readFileSync(new URL('../api/calendar-attendance/index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /validateInstructorRateForLesson|checkInstructorRateForLesson|checkTemplateInstructorRate/);
    assert.doesNotMatch(source, /instructor_rate_not_configured/);
  });
});
