// The monthly pay summary rows (src/features/finance/lib/pay-summary.js): they only arrange what
// GET /api/payroll returned, so every test feeds a payroll row as the server shapes it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildLessonCalendarPath,
  buildPayrollTableRows,
  buildSummaryRows,
  describeLessonState,
  formatDays,
  formatMinutes,
  formatUnmarkedCount,
  groupAttendanceByRate,
  groupLessonsByService,
} from '../src/features/finance/lib/pay-summary.js';

function lesson(id, overrides = {}) {
  return {
    lesson_instance_id: id,
    employee_id: 'dana',
    service_id: 'riding',
    service_name: 'רכיבה',
    lesson_date: '2026-10-05',
    start_time: '11:00',
    duration_minutes: 45,
    payout_amount: 7500,
    rate_used: 10000,
    pay_basis: 'lesson_hourly',
    service_payment_model: 'fixed_rate',
    paid_participant_count: 1,
    rate_effective_date: '2026-01-01',
    unmarked: false,
    unmarked_amount: 0,
    missing_rate: false,
    participant_states: { attended: 1 },
    ...overrides,
  };
}

const PAY = {
  employee_id: 'dana',
  employee_name: 'דנה',
  lesson_amount: 15000,
  lesson_count: 3,
  attendance_amount: 7500,
  attendance_minutes: 90,
  monthly_salary_amount: 0,
  paid_leave_amount: 0,
  correction_amount: -2000,
  total_amount: 20500,
  unmarked_lesson_count: 1,
  unmarked_lesson_amount: 7500,
  missing_rate_lesson_count: 1,
  corrections: [{ id: 'c1', correction_type: 'deduction', amount: -2000, effective_date: '2026-10-10', notes: 'ציוד' }],
  details: {
    lessons: [
      lesson('l1'),
      lesson('l2', { lesson_date: '2026-10-06', unmarked: true, unmarked_amount: 7500, participant_states: { unmarked: 1 } }),
      lesson('l3', { service_id: 'therapy', service_name: 'טיפולית', missing_rate: true, payout_amount: 0, rate_used: null }),
    ],
    attendance: [{ attendance_date: '2026-10-05', other_minutes: 90, rate_used: 5000, amount: 7500 }],
    leave: [],
  },
};

describe('formatting', () => {
  it('shows minutes as hours and minutes', () => {
    assert.equal(formatMinutes(90), '1:30');
    assert.equal(formatMinutes(5), '0:05');
  });

  it('says leave days in words', () => {
    assert.equal(formatDays(0.5), 'חצי יום');
    assert.equal(formatDays(1), 'יום אחד');
    assert.equal(formatDays(2.5), '2.5 ימים');
  });

  it('says what happened in a lesson without showing an assumption as a mark', () => {
    assert.equal(describeLessonState({ attended: 1 }), 'הגיע');
    assert.equal(describeLessonState({ unmarked: 1 }), 'לא סומן');
    assert.equal(describeLessonState({ attended: 1, no_show: 1 }), '1 הגיע, 1 לא הגיע');
  });
});

describe('the overview', () => {
  it('has the total, a row per part that has something, and the missing-rate exception', () => {
    const { total, rows, exceptions } = buildSummaryRows(PAY);
    assert.equal(total, 20500);
    assert.deepEqual(rows.map((row) => [row.key, row.label, row.amount]), [
      ['lessons', 'מפגשים · 2', 15000],
      ['attendance', 'שעות עבודה · 1:30', 7500],
      ['corrections', 'תיקונים · 1', -2000],
    ]);
    assert.deepEqual(exceptions.map((row) => [row.key, row.label, row.amount, row.note]), [
      ['missing_rate', 'חסר תעריף · 1 מפגש', null, 'לא נכלל בסכום'],
    ]);
    assert.deepEqual(exceptions[0].lessons.map((line) => [line.id, line.serviceId, line.date]), [['l3', 'therapy', '2026-10-05']]);
  });

  it('lists an unmarked lesson once, in "מפגשים", with the count on the row and on its service line', () => {
    const { rows, exceptions } = buildSummaryRows(PAY);
    assert.equal(exceptions.some((row) => row.key === 'unmarked'), false);
    const lessons = rows.find((row) => row.key === 'lessons');
    assert.equal(lessons.unmarkedCount, 1);
    assert.equal(lessons.unmarkedLabel, '1 לא סומן');
    assert.equal(lessons.amount, 15000, 'the unmarked lesson stays in the total');
    const [group] = lessons.groups;
    assert.equal(group.unmarkedLabel, '1 לא סומן');
    assert.deepEqual(group.lessons.map((line) => [line.id, line.unmarked]), [['l1', false], ['l2', true]]);
    const listed = lessons.groups.flatMap((g) => g.lessons).concat(exceptions.flatMap((row) => row.lessons))
      .filter((line) => line.id === 'l2');
    assert.equal(listed.length, 1);
  });

  it('counts unmarked lessons in plural, without the ones that have no rate, and from the server without details', () => {
    assert.equal(formatUnmarkedCount(2), '2 לא סומנו');
    const pay = {
      ...PAY,
      lesson_count: 4,
      unmarked_lesson_count: 3,
      details: { ...PAY.details, lessons: [
        ...PAY.details.lessons,
        lesson('l4', { lesson_date: '2026-10-07', unmarked: true, participant_states: { unmarked: 1 } }),
        lesson('l5', { service_id: 'therapy', service_name: 'טיפולית', missing_rate: true, unmarked: true, payout_amount: 0, rate_used: null }),
      ] },
    };
    const lessons = buildSummaryRows(pay).rows.find((row) => row.key === 'lessons');
    assert.equal(lessons.unmarkedLabel, '2 לא סומנו');
    assert.equal(lessons.groups[0].unmarkedLabel, '2 לא סומנו');
    const withoutDetails = buildSummaryRows({ ...PAY, details: null }).rows.find((row) => row.key === 'lessons');
    assert.equal(withoutDetails.unmarkedLabel, '1 לא סומן');
    const none = buildSummaryRows({ ...PAY, unmarked_lesson_count: 0, details: null }).rows.find((row) => row.key === 'lessons');
    assert.equal(none.unmarkedLabel, '');
  });

  it('shows no exception row when there is nothing to flag, and no row for an empty part', () => {
    const { rows, exceptions } = buildSummaryRows({ ...PAY, unmarked_lesson_count: 0, missing_rate_lesson_count: 0, corrections: [], correction_amount: 0, attendance_minutes: 0, attendance_amount: 0 });
    assert.deepEqual(rows.map((row) => row.key), ['lessons']);
    assert.equal(exceptions.length, 0);
  });

  it('a monthly salary and paid leave each get a row, the leave with its days', () => {
    const { rows } = buildSummaryRows({
      ...PAY,
      monthly_salary_amount: 800000,
      paid_leave_amount: 45000,
      details: { ...PAY.details, leave: [
        { leave_date: '2026-10-12', pay_fraction: 1, amount: 30000 },
        { leave_date: '2026-10-13', pay_fraction: 0.5, amount: 15000 },
        { leave_date: '2026-10-14', pay_fraction: 0, amount: 0 },
      ] },
    });
    const salary = rows.find((row) => row.key === 'salary');
    const leave = rows.find((row) => row.key === 'leave');
    assert.equal(salary.amount, 800000);
    assert.equal(leave.label, 'חופשה: 1.5 ימים');
    assert.deepEqual(leave.leaveLines.map((line) => [line.dateLabel, line.portionLabel, line.amount]), [
      ['12.10', 'יום מלא', 30000],
      ['13.10', 'חצי יום', 15000],
    ]);
  });

  it('paid leave is its own line: days x the day value, with its total, apart from the hours and lessons (PAY-G3)', () => {
    const { rows, total } = buildSummaryRows({
      ...PAY,
      paid_leave_amount: 45000,
      total_amount: 65500,
      leave_breakdown: { paid_days: 1.5, day_value: 30000, paid_leave_total: 45000 },
    });
    const leave = rows.find((row) => row.key === 'leave');
    assert.equal(leave.label, 'חופשה: 1.5 ימים × ₪300.00');
    assert.equal(leave.amount, 45000);
    assert.deepEqual(rows.map((row) => row.key), ['lessons', 'attendance', 'leave', 'corrections']);
    assert.equal(rows.find((row) => row.key === 'attendance').amount, 7500, 'the hours stay their own amount');
    assert.equal(total, 65500);
    const varied = buildSummaryRows({ ...PAY, paid_leave_amount: 45000, leave_breakdown: { paid_days: 2, day_value: null } }).rows.find((row) => row.key === 'leave');
    assert.equal(varied.label, 'חופשה: 2 ימים', 'no "× value" when the days are not all worth the same');
  });

  it('a monthly salary covers its leave days: they are listed, with no amount', () => {
    const leave = buildSummaryRows({
      ...PAY, monthly_salary_amount: 800000, paid_leave_amount: 0, leave_breakdown: { paid_days: 2, day_value: 30000 },
    }).rows.find((row) => row.key === 'leave');
    assert.equal(leave.label, 'חופשה: 2 ימים');
    assert.equal(leave.amount, null);
    assert.equal(leave.note, 'כלול במשכורת');
  });

  it('lists each correction with its date, kind, note and signed amount', () => {
    const { rows } = buildSummaryRows(PAY);
    const [line] = rows.find((row) => row.key === 'corrections').correctionLines;
    assert.equal(line.dateLabel, '10.10');
    assert.equal(line.kindLabel, 'ניכוי');
    assert.equal(line.note, 'ציוד');
    assert.equal(line.amount, -2000);
    assert.match(line.amountLabel, /^-₪20/);
  });
});

describe('lessons by service, pay basis and rate', () => {
  it('shows an hourly service as hours × rate per hour, the amount being the server sum', () => {
    const [group] = groupLessonsByService(PAY.details.lessons);
    assert.equal(group.name, 'רכיבה');
    assert.equal(group.count, 2);
    assert.equal(group.amount, 15000);
    assert.equal(group.countLabel, '1:30 שעות × ₪100.00 לשעה');
    assert.deepEqual(group.lessons.map((line) => [line.dateLabel, line.time, line.minutes, line.stateLabel, line.amount]), [
      ['05.10', '11:00', 45, 'הגיע', 7500],
      ['06.10', '11:00', 45, 'לא סומן', 7500],
    ]);
  });

  it('shows a per-lesson rate as lessons × rate', () => {
    const flat = (id) => lesson(id, { pay_basis: 'lesson_flat', rate_used: 9000, payout_amount: 9000, duration_minutes: 30 });
    const [group] = groupLessonsByService([flat('a'), flat('b'), flat('c')]);
    assert.equal(group.countLabel, '3 מפגשים × ₪90.00');
    assert.equal(group.amount, 27000);
    assert.equal(groupLessonsByService([flat('a')])[0].countLabel, '1 מפגש × ₪90.00');
  });

  it('shows a per-rider service paid per lesson as riders × rate', () => {
    const rider = (id, riders) => lesson(id, {
      pay_basis: 'lesson_flat',
      service_payment_model: 'per_student',
      rate_used: 3000,
      paid_participant_count: riders,
      payout_amount: 3000 * riders,
    });
    const [group] = groupLessonsByService([rider('a', 6), rider('b', 8)]);
    assert.equal(group.countLabel, '14 רוכבים × ₪30.00');
    assert.equal(group.amount, 42000);
  });

  it('shows a per-rider hourly service as rider-hours × rate per hour', () => {
    const rider = (id, riders) => lesson(id, {
      service_payment_model: 'per_student',
      rate_used: 8000,
      duration_minutes: 60,
      paid_participant_count: riders,
      payout_amount: 8000 * riders,
    });
    const [group] = groupLessonsByService([rider('a', 2), rider('b', 1)]);
    assert.equal(group.countLabel, '3:00 שעות רוכב × ₪80.00 לשעה');
    assert.equal(group.amount, 24000);
  });

  it('gives a service two lines when its rate changed in the month, the older rate first', () => {
    const groups = groupLessonsByService([
      lesson('late', { lesson_date: '2026-10-20', rate_used: 12000, payout_amount: 9000, rate_effective_date: '2026-10-15' }),
      lesson('early', { lesson_date: '2026-10-05', rate_used: 10000, payout_amount: 7500 }),
      lesson('other', { service_id: 'group', service_name: 'קבוצה', pay_basis: 'lesson_flat', rate_used: 5000, payout_amount: 5000 }),
    ]);
    assert.deepEqual(groups.map((group) => [group.serviceId, group.countLabel, group.amount]), [
      ['riding', '0:45 שעות × ₪100.00 לשעה', 7500],
      ['riding', '0:45 שעות × ₪120.00 לשעה', 9000],
      ['group', '1 מפגש × ₪50.00', 5000],
    ]);
  });

  it('drops the "× rate" part when quantity × rate does not equal what was paid', () => {
    const [hourly] = groupLessonsByService([lesson('a'), lesson('b', { payout_amount: 7400 })]);
    assert.equal(hourly.countLabel, '1:30 שעות');
    assert.equal(hourly.amount, 14900);
    const [flat] = groupLessonsByService([
      lesson('c', { pay_basis: 'lesson_flat', rate_used: 9000, payout_amount: 9000 }),
      lesson('d', { pay_basis: 'lesson_flat', rate_used: 9000, payout_amount: 4500 }),
    ]);
    assert.equal(flat.countLabel, '2 מפגשים');
    const [riders] = groupLessonsByService([
      lesson('e', { pay_basis: 'lesson_flat', service_payment_model: 'per_student', rate_used: 3000, paid_participant_count: 2, payout_amount: 6000 }),
      lesson('f', { pay_basis: 'lesson_flat', service_payment_model: 'per_student', rate_used: 3000, paid_participant_count: 3, payout_amount: 8000 }),
    ]);
    assert.equal(riders.countLabel, '5 רוכבים');
  });

  it('leaves a lesson with no rate out of the services: it is listed under "חסר תעריף"', () => {
    const groups = groupLessonsByService(PAY.details.lessons);
    assert.deepEqual(groups.map((group) => group.serviceId), ['riding']);
  });

  it('marks the missing-rate exception as not paid: red, shown as zero', () => {
    const { exceptions } = buildSummaryRows(PAY);
    assert.deepEqual(exceptions.map((row) => [row.key, row.tone]), [['missing_rate', 'danger']]);
    assert.equal(exceptions[0].amountLabel, '₪0');
    assert.equal(exceptions[0].note, 'לא נכלל בסכום');
  });
});

describe('office hours by rate period', () => {
  it('starts a new period when the hourly rate changes', () => {
    const periods = groupAttendanceByRate([
      { attendance_date: '2026-10-02', other_minutes: 60, rate_used: 5000, amount: 5000 },
      { attendance_date: '2026-10-01', other_minutes: 30, rate_used: 5000, amount: 2500 },
      { attendance_date: '2026-10-20', other_minutes: 60, rate_used: 6000, amount: 6000 },
      { attendance_date: '2026-10-21', other_minutes: 0, rate_used: 6000, amount: 0 },
    ]);
    assert.deepEqual(periods.map((period) => [period.rangeLabel, period.minutes, period.amount]), [
      ['01.10–02.10', 90, 7500],
      ['20.10', 60, 6000],
    ]);
    assert.match(periods[0].label, /^1:30 × ₪50/);
  });
});

describe('the all-employees table', () => {
  it('tags an employee only with the exceptions they have', () => {
    const rows = buildPayrollTableRows([PAY, { ...PAY, employee_id: 'omer', unmarked_lesson_count: 0, missing_rate_lesson_count: 0 }]);
    assert.deepEqual(rows[0].tags.map((tag) => tag.label), ['לא סומן: 1', 'חסר תעריף: 1']);
    assert.deepEqual(rows[0].tags.map((tag) => tag.tone), ['warning', 'danger']);
    assert.deepEqual(rows[1].tags, []);
    assert.equal(rows[0].total, 20500);
  });
});

describe('the link to a lesson', () => {
  it('opens the calendar on the lesson day with the lesson', () => {
    assert.equal(buildLessonCalendarPath({ id: 'l1', date: '2026-10-05' }), '/calendar?date=2026-10-05&lesson=l1');
  });
});
