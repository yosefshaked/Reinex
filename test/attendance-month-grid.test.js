import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attendanceTotals, buildMonthWeeks, formatMinutes } from '../src/components/settings/employee-management/attendance-month-grid.js';

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
});
