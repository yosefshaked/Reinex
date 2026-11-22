import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attendanceTotals,
  buildLeaveRequestBody,
  buildMonthWeeks,
  describeLeaveDay,
  isHalfDayLeave,
  LEAVE_PORTION_OPTIONS,
  emptyLeaveForm,
  formatMinutes,
  leaveBalanceText,
  planLeaveDayValue,
  leaveDayRateTimeline,
  leaveFormFromEntry,
  leaveSaveErrorMessage,
  leaveTypeLabel,
} from '../src/components/settings/employee-management/attendance-month-grid.js';

function monthDays(year, month, length) {
  return Array.from({ length }, (_, index) => ({
    date: `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
  }));
}

describe('attendance month grid', () => {
  it('pads a six-week month with empty cells and preserves every day once', () => {
    const days = monthDays(2026, 8, 31); // Starts Saturday, ends Monday.
    const weeks = buildMonthWeeks(days);
    assert.equal(weeks.length, 6);
    assert.ok(weeks.every((week) => week.length === 7));
    assert.deepEqual(weeks[0].slice(0, 6), Array(6).fill(null));
    assert.equal(weeks[0][6], days[0]);
    assert.deepEqual(weeks[5].slice(2), Array(5).fill(null));
    assert.deepEqual(weeks.flat().filter(Boolean), days);
  });

  it('keeps a Sunday-start February to four weeks and includes leap day', () => {
    const february = monthDays(2026, 2, 28);
    assert.equal(buildMonthWeeks(february).length, 4);
    assert.equal(buildMonthWeeks(february)[0][0], february[0]);
    const leapDays = monthDays(2024, 2, 29);
    assert.equal(buildMonthWeeks(leapDays).flat().filter(Boolean).at(-1).date, '2024-02-29');
    assert.deepEqual(buildMonthWeeks([]), []);
  });

  it('formats hours without wrapping at 24 and handles missing or invalid minutes', () => {
    for (const [input, expected] of [[0, '0:00'], [45, '0:45'], [135, '2:15'], [1505, '25:05'], ['90', '1:30'], [null, '0:00'], [-30, '0:00'], [Infinity, '0:00'], ['invalid', '0:00']]) {
      assert.equal(formatMinutes(input), expected);
    }
  });

  it('adds live lessons and manual other work, ignoring obsolete stored lesson fields', () => {
    const days = [
      { lessons: { lesson_minutes: 90 }, record: { other_minutes: 45, lesson_minutes: 900, worked_minutes: 800 } },
      { lessons: { lesson_minutes: 60 } },
      { record: { other_minutes: '30' } },
      { leave: { leave_type: 'paid' } },
      {}, null,
    ];
    assert.deepEqual(attendanceTotals(days), { lessonMinutes: 150, otherMinutes: 75, totalMinutes: 225 });
    assert.deepEqual(attendanceTotals([]), { lessonMinutes: 0, otherMinutes: 0, totalMinutes: 0 });
    const weeks = buildMonthWeeks(monthDays(2026, 8, 31).map((day, index) => ({ ...day, lessons: { lesson_minutes: index }, record: { other_minutes: 15 } })));
    assert.equal(weeks.reduce((sum, week) => sum + attendanceTotals(week).totalMinutes, 0), attendanceTotals(weeks.flat()).totalMinutes);
  });

  describe('leave from the day editor', () => {
    const ids = { orgId: 'org-1', employeeId: 'emp-1' };

    it('starts a new leave on the picked day, as a full day of that day only', () => {
      assert.deepEqual(buildLeaveRequestBody(emptyLeaveForm('2026-11-10'), { ...ids, startDate: '2026-11-10' }), {
        id: undefined,
        org_id: 'org-1',
        employee_id: 'emp-1',
        leave_type: 'employee_paid',
        duration_mode: 'full_day',
        half_day_part: null,
        start_date: '2026-11-10',
        end_date: '2026-11-10',
        reason: null,
        notes: null,
      });
    });

    it('keeps a range end, but never before the start, and a half day is always one date', () => {
      const range = { ...emptyLeaveForm('2026-11-10'), endDate: '2026-11-12', reason: '  חופשה משפחתית ' };
      const body = buildLeaveRequestBody(range, { ...ids, startDate: '2026-11-10' });
      assert.equal(body.end_date, '2026-11-12');
      assert.equal(body.reason, 'חופשה משפחתית');
      assert.equal(buildLeaveRequestBody({ ...range, endDate: '2026-11-01' }, { ...ids, startDate: '2026-11-10' }).end_date, '2026-11-10');
      const half = buildLeaveRequestBody({ ...range, portion: 'half_day', leaveType: 'unpaid' }, { ...ids, startDate: '2026-11-10' });
      assert.equal(half.duration_mode, 'half_day');
      assert.equal(half.half_day_part, 'first_half');
      assert.equal(half.end_date, '2026-11-10');
      assert.equal(half.leave_type, 'unpaid');
    });

    it('opens an existing entry for editing with its own id, type, part and end', () => {
      const form = leaveFormFromEntry({ id: 'L1', leave_type: 'system_paid', duration_mode: 'full_day', start_date: '2026-11-01', end_date: '2026-11-03', reason: 'מילואים', notes: 'x' });
      assert.deepEqual(form, { id: 'L1', leaveType: 'system_paid', portion: 'full_day', endDate: '2026-11-03', reason: 'מילואים', notes: 'x' });
      const body = buildLeaveRequestBody(form, { ...ids, startDate: '2026-11-01' });
      assert.equal(body.id, 'L1');
      assert.equal(body.notes, 'x');
    });

    it('reads the older half_day type as half a day on the employee', () => {
      const form = leaveFormFromEntry({ id: 'L2', leave_type: 'half_day', duration_mode: 'half_day', half_day_part: 'second_half', start_date: '2026-11-04', end_date: '2026-11-04' });
      assert.equal(form.leaveType, 'employee_paid');
      assert.equal(form.portion, 'half_day');
      assert.equal(leaveTypeLabel('half_day'), 'חצי יום');
      assert.equal(leaveTypeLabel('anything'), 'חופשה');
    });

    it('labels a grid day by who carries it, never by the raw code', () => {
      assert.equal(describeLeaveDay(null), null);
      assert.equal(describeLeaveDay({ leave_type: 'system_paid', day_portion: 'full_day', entry: { leave_type: 'system_paid' } }), 'חופשה · על חשבון המערכת');
      assert.equal(describeLeaveDay({ leave_type: 'employee_paid', day_portion: 'first_half' }), 'חופשה · חצי יום · על חשבון העובד');
      assert.equal(describeLeaveDay({ leave_type: 'half_day', day_portion: 'first_half' }), 'חופשה · חצי יום');
    });

    it('offers one half-day choice, not first and second halves', () => {
      assert.deepEqual(LEAVE_PORTION_OPTIONS.map((option) => option.label), ['יום מלא', 'חצי יום']);
    });

    it('tells a half-day leave (shares the day with work) from a full one', () => {
      assert.equal(isHalfDayLeave(null), false);
      assert.equal(isHalfDayLeave({ day_portion: 'full_day', entry: { duration_mode: 'full_day', leave_type: 'unpaid' } }), false);
      assert.equal(isHalfDayLeave({ day_portion: 'first_half' }), true);
      assert.equal(isHalfDayLeave({ day_portion: 'full_day', entry: { duration_mode: 'half_day' } }), true);
      assert.equal(isHalfDayLeave({ day_portion: 'full_day', leave_type: 'half_day' }), true);
    });

    it('turns the save refusals into Hebrew guidance', () => {
      assert.match(leaveSaveErrorMessage({ data: { message: 'leave_conflicts_with_attendance' } }), /שעות/);
      assert.match(leaveSaveErrorMessage({ data: { message: 'leave_conflicts_with_lessons' } }), /שיעורים/);
      assert.match(leaveSaveErrorMessage({ data: { message: 'leave_conflicts_with_existing_leave' } }), /כבר רשומה/);
      assert.equal(leaveSaveErrorMessage({ message: 'boom' }), 'boom');
      assert.equal(leaveSaveErrorMessage(null), 'שמירת החופשה נכשלה.');
    });

    it('shows the balance as one line with the figures behind it', () => {
      assert.equal(leaveBalanceText(null), null);
      const summary = { year: 2026, quota: 12, carryIn: 2, allocations: 0, adjustments: -1, used: 3.5, remaining: 9.5, available: 13 };
      const text = leaveBalanceText(summary, { status: 'ok' }, 2026);
      assert.equal(text.line, 'מגיעים 13 ימי חופשה השנה · נוצלו 3.5 · נשארו 9.5');
      assert.equal(text.details.length, 5);
      assert.ok(text.details.includes('צבירה משנה קודמת: 2'));
      assert.ok(text.details.includes('לפי הזכאות: 12'));
      assert.equal(
        leaveBalanceText(summary, { status: 'ok', days_to_next_leave_day: 10 }, 2026).line,
        'מגיעים 13 ימי חופשה השנה · נוצלו 3.5 · נשארו 9.5 · עוד 10 ימי עבודה ליום החופשה הבא',
      );
      assert.match(leaveBalanceText(summary, { status: 'ok', days_to_next_leave_day: 1 }, 2026).line, /עוד יום עבודה אחד ליום החופשה הבא$/);
      assert.doesNotMatch(leaveBalanceText(summary, { status: 'ok', days_to_next_leave_day: null }, 2026).line, /עוד/);
      assert.equal(leaveBalanceText(summary, null, 2027).line, 'מגיעים 13 ימי חופשה ב-2026 · נוצלו 3.5 · נשארו 9.5');
      assert.equal(
        leaveBalanceText({ ...summary, quota: 0 }, { status: 'manual_needed', reason: 'before_75_days' }, 2026).line,
        'ימי החופשה השנה עדיין לא נקבעו · נוצלו 3.5 · נשארו 9.5',
      );
    });
  });
});

describe('the fixed leave-day value in the employee leave dialog', () => {
  const fixed = { payMethod: 'fixed_rate', dayValue: '250', dayValueDate: '2026-11-18' };

  it('is not needed for the other methods', () => {
    assert.equal(planLeaveDayValue({ ...fixed, payMethod: 'legal', dayValue: '' }).required, false);
    assert.equal(planLeaveDayValue({ ...fixed, payMethod: '', dayValue: '' }).error, '');
  });

  it('"ערך קבוע ליום" needs a positive value', () => {
    for (const dayValue of ['', '0', '-5', 'abc']) {
      const plan = planLeaveDayValue({ ...fixed, dayValue });
      assert.match(plan.error, /גדול מאפס/, dayValue);
      assert.equal(plan.needsSave, false);
    }
    assert.match(planLeaveDayValue({ ...fixed, dayValueDate: '' }).error, /תאריך/);
  });

  it('converts a decimal shekel value to agorot through the shared helper', () => {
    assert.equal(planLeaveDayValue({ ...fixed, dayValue: '250.5' }).rate, 25050);
    assert.equal(planLeaveDayValue({ ...fixed, dayValue: '250' }).rate, 25000);
  });

  it('writes the dated rate in agorot when there is none or it differs, not when it is unchanged', () => {
    const plan = planLeaveDayValue(fixed, null);
    assert.deepEqual([plan.error, plan.rate, plan.effectiveDate, plan.needsSave], ['', 25000, '2026-11-18', true]);
    assert.equal(planLeaveDayValue(fixed, { rate: 25000 }).needsSave, false);
    assert.equal(planLeaveDayValue(fixed, { rate: 20000 }).needsSave, true);
  });
});

describe('the history of the employee fixed leave-day value', () => {
  const rows = [
    { id: 'a', pay_basis: 'leave_day', service_id: null, effective_date: '2026-01-01', rate: 20000 },
    { id: 'b', pay_basis: 'leave_day', service_id: null, effective_date: '2026-12-01', rate: 25050 },
    { id: 'c', pay_basis: 'leave_day', service_id: null, effective_date: '2027-03-01', rate: 30000 },
    { id: 'd', pay_basis: 'hourly', service_id: null, effective_date: '2026-02-01', rate: 9900 },
  ];

  it('lists the leave_day rows newest first and notes the nearest future one', () => {
    const timeline = leaveDayRateTimeline(rows, '2026-11-22');
    assert.deepEqual(timeline.entries.map((entry) => entry.id), ['c', 'b', 'a']);
    assert.equal(timeline.current.id, 'a');
    assert.equal(timeline.entries.find((entry) => entry.id === 'a').isCurrent, true);
    assert.equal(timeline.next.id, 'b');
    assert.match(timeline.note, /^ישתנה ב-.*01.*12.*2026.*: ₪250\.5/);
  });

  it('has no note when nothing is in the future', () => {
    assert.equal(leaveDayRateTimeline(rows, '2027-06-01').note, '');
    assert.equal(leaveDayRateTimeline([], '2026-11-22').entries.length, 0);
  });
});
