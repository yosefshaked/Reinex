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
  it('has the total, a row per part that has something, and the two exception rows', () => {
    const { total, rows, exceptions } = buildSummaryRows(PAY);
    assert.equal(total, 20500);
    assert.deepEqual(rows.map((row) => [row.key, row.label, row.amount]), [
      ['lessons', 'מפגשים · 2', 15000],
      ['attendance', 'שעות עבודה · 1:30', 7500],
      ['corrections', 'תיקונים · 1', -2000],
    ]);
    assert.deepEqual(exceptions.map((row) => [row.key, row.label, row.amount, row.note]), [
      ['unmarked', 'לא סומן אם הגיעו · 1 מפגש', 7500, 'נכלל בסכום'],
      ['missing_rate', 'חסר תעריף · 1 מפגש', null, 'לא נכלל בסכום'],
    ]);
    assert.deepEqual(exceptions[0].lessons.map((line) => line.id), ['l2']);
    assert.deepEqual(exceptions[1].lessons.map((line) => [line.id, line.serviceId, line.date]), [['l3', 'therapy', '2026-10-05']]);
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
    assert.equal(leave.label, 'חופשה בתשלום · 1.5 ימים');
    assert.deepEqual(leave.leaveLines.map((line) => [line.dateLabel, line.portionLabel, line.amount]), [
      ['12.10', 'יום מלא', 30000],
      ['13.10', 'חצי יום', 15000],
    ]);
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

describe('lessons by service', () => {
  it('shows count × amount when every lesson of the service paid the same', () => {
    const [group] = groupLessonsByService(PAY.details.lessons);
    assert.equal(group.name, 'רכיבה');
    assert.equal(group.count, 2);
    assert.equal(group.amount, 15000);
    assert.match(group.countLabel, /^2 × ₪75/);
    assert.deepEqual(group.lessons.map((line) => [line.dateLabel, line.time, line.minutes, line.stateLabel, line.amount]), [
      ['05.10', '11:00', 45, 'הגיע', 7500],
      ['06.10', '11:00', 45, 'לא סומן', 7500],
    ]);
  });

  it('shows only the count when the lessons paid different amounts, never a made-up rate', () => {
    const [group] = groupLessonsByService([lesson('a'), lesson('b', { payout_amount: 10000, duration_minutes: 60 })]);
    assert.equal(group.unitAmount, null);
    assert.equal(group.countLabel, '2 מפגשים');
    assert.equal(group.amount, 17500);
  });

  it('leaves a lesson with no rate out of the services: it is listed under "חסר תעריף"', () => {
    const groups = groupLessonsByService(PAY.details.lessons);
    assert.deepEqual(groups.map((group) => group.serviceId), ['riding']);
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
    assert.deepEqual(rows[1].tags, []);
    assert.equal(rows[0].total, 20500);
  });
});

describe('the link to a lesson', () => {
  it('opens the calendar on the lesson day with the lesson', () => {
    assert.equal(buildLessonCalendarPath({ id: 'l1', date: '2026-10-05' }), '/calendar?date=2026-10-05&lesson=l1');
  });
});
