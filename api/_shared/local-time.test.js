import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ORG_TIME_ZONE,
  addDays,
  addMonths,
  compareDateKeys,
  currentMonthKey,
  dateKeyFromCalendarDate,
  daysInMonth,
  diffDays,
  endOfLocalDayUtc,
  enumerateDateKeys,
  firstDayOfMonth,
  formatInstant,
  formatLocalDateTime,
  isDateKey,
  lastDayOfMonth,
  localDateKey,
  localDateRangeUtc,
  localDateTimeToUtc,
  localMonthKey,
  localMonthRangeUtc,
  localTime,
  localWeekday,
  monthKeyOfDateKey,
  normalizeDateKey,
  resolveOrgTimeZone,
  startOfLocalDayUtc,
  todayKey,
  utcDateKey,
  utcFileStamp,
  utcOffsetMinutes,
  weekdayOfDateKey,
} from './local-time.js';

const TZ = 'Asia/Jerusalem';
const HOUR_MS = 60 * 60 * 1000;

function hoursBetween(range) {
  return (Date.parse(range.endExclusiveIso) - Date.parse(range.startIso)) / HOUR_MS;
}

test('every organisation resolves to the Israeli zone today', () => {
  assert.equal(DEFAULT_ORG_TIME_ZONE, TZ);
  assert.equal(resolveOrgTimeZone(), TZ);
});

test('a lesson at 00:30 Israel time belongs to that local day, not the UTC one', () => {
  // 00:30 on 1.10.2026 (summer time, UTC+3) is 21:30Z on 30.09.
  const instant = '2026-09-30T21:30:00.000Z';
  assert.equal(localDateKey(instant, TZ), '2026-10-01');
  assert.equal(localMonthKey(instant, TZ), '2026-10');
  assert.equal(localTime(instant, TZ), '00:30');
  assert.equal(localWeekday(instant, TZ), 4, 'Thursday');
  assert.equal(utcDateKey(instant), '2026-09-30', 'the technical UTC date differs');
  // Winter (UTC+2): 00:30 on 1.12.2026 is 22:30Z on 30.11.
  assert.equal(localDateKey('2026-11-30T22:30:00.000Z', TZ), '2026-12-01');
});

test('the last day of a month at 23:30 UTC is already the next month locally', () => {
  const instant = '2026-01-31T23:30:00.000Z';
  assert.equal(localDateKey(instant, TZ), '2026-02-01');
  assert.equal(localMonthKey(instant, TZ), '2026-02');
  assert.equal(localTime(instant, TZ), '01:30');
  // And at year end.
  assert.equal(localMonthKey('2026-12-31T22:15:00.000Z', TZ), '2027-01');
  // 21:59Z on 31.01 is still 23:59 on 31.01 locally.
  assert.equal(localDateKey('2026-01-31T21:59:00.000Z', TZ), '2026-01-31');
});

test('a date key is never shifted through the zone', () => {
  assert.equal(localDateKey('2026-10-01', TZ), '2026-10-01');
  assert.equal(localDateKey(' 2026-10-01 ', 'Pacific/Kiritimati'), '2026-10-01');
  assert.equal(localDateKey('', TZ), '');
  assert.equal(localDateKey(null, TZ), '');
  assert.equal(localDateKey('not a date', TZ), '');
  assert.equal(localWeekday('2026-10-01', TZ), 4);
});

test('Israel 2026 DST transitions (verified with Intl): 27.03 02:00->03:00 and 25.10 02:00->01:00', () => {
  assert.equal(utcOffsetMinutes('2026-03-26T23:59:00.000Z', TZ), 120);
  assert.equal(utcOffsetMinutes('2026-03-27T00:00:00.000Z', TZ), 180);
  assert.equal(utcOffsetMinutes('2026-10-24T22:59:00.000Z', TZ), 180);
  assert.equal(utcOffsetMinutes('2026-10-24T23:00:00.000Z', TZ), 120);
  assert.equal(localTime('2026-03-27T00:00:00.000Z', TZ), '03:00');
  assert.equal(localTime('2026-10-24T23:00:00.000Z', TZ), '01:00');
});

test('day bounds are DST-correct: 23-hour spring day, 25-hour autumn day', () => {
  assert.equal(startOfLocalDayUtc('2026-03-27', TZ), '2026-03-26T22:00:00.000Z');
  assert.equal(endOfLocalDayUtc('2026-03-27', TZ), '2026-03-27T21:00:00.000Z');
  assert.equal(hoursBetween(localDateRangeUtc('2026-03-27', '2026-03-27', TZ)), 23);

  assert.equal(startOfLocalDayUtc('2026-10-25', TZ), '2026-10-24T21:00:00.000Z');
  assert.equal(endOfLocalDayUtc('2026-10-25', TZ), '2026-10-25T22:00:00.000Z');
  assert.equal(hoursBetween(localDateRangeUtc('2026-10-25', '2026-10-25', TZ)), 25);

  assert.equal(hoursBetween(localDateRangeUtc('2026-07-15', '2026-07-15', TZ)), 24);
  const reversed = localDateRangeUtc('2026-07-16', '2026-07-15', TZ);
  assert.ok(Date.parse(reversed.startIso) >= Date.parse(reversed.endExclusiveIso), 'a reversed range is empty');
  assert.equal(localDateRangeUtc('2026-07-xx', '2026-07-15', TZ), null);
});

test('month ranges cover the whole local month, including DST months', () => {
  const march = localMonthRangeUtc('2026-03', TZ);
  assert.equal(march.startIso, '2026-02-28T22:00:00.000Z');
  assert.equal(march.endExclusiveIso, '2026-03-31T21:00:00.000Z');
  assert.equal(hoursBetween(march), (31 * 24) - 1);

  const october = localMonthRangeUtc('2026-10', TZ);
  assert.equal(october.startIso, '2026-09-30T21:00:00.000Z');
  assert.equal(october.endExclusiveIso, '2026-10-31T22:00:00.000Z');
  assert.equal(hoursBetween(october), (31 * 24) + 1);

  assert.equal(hoursBetween(localMonthRangeUtc('2026-02', TZ)), 28 * 24);
  assert.deepEqual(localMonthRangeUtc('2026-10-17', TZ), october, 'a date key selects its month');

  // The 00:30 lesson on 1.10 is inside October's range and outside September's.
  const lesson = Date.parse('2026-09-30T21:30:00.000Z');
  const september = localMonthRangeUtc('2026-09', TZ);
  assert.ok(lesson >= Date.parse(october.startIso) && lesson < Date.parse(october.endExclusiveIso));
  assert.ok(!(lesson >= Date.parse(september.startIso) && lesson < Date.parse(september.endExclusiveIso)));
});

test('local wall time to UTC, including the non-existent and the repeated hour', () => {
  assert.equal(localDateTimeToUtc('2026-07-01', '16:00', TZ), '2026-07-01T13:00:00.000Z');
  assert.equal(localDateTimeToUtc('2026-01-01', '16:00', TZ), '2026-01-01T14:00:00.000Z');
  assert.equal(localDateTimeToUtc('2026-10-01', '00:30', TZ), '2026-09-30T21:30:00.000Z');

  // Spring forward 27.03.2026: 01:30 still exists (winter, UTC+2); 02:30 does not -> 03:30 (UTC+3).
  assert.equal(localDateTimeToUtc('2026-03-27', '01:30', TZ), '2026-03-26T23:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-03-27', '02:00', TZ), '2026-03-27T00:00:00.000Z');
  assert.equal(localDateTimeToUtc('2026-03-27', '02:30', TZ), '2026-03-27T00:30:00.000Z');
  assert.equal(localTime(localDateTimeToUtc('2026-03-27', '02:30', TZ), TZ), '03:30');
  assert.equal(localDateTimeToUtc('2026-03-27', '03:00', TZ), '2026-03-27T00:00:00.000Z');

  // Autumn back 25.10.2026: 01:30 happens twice; the first occurrence (summer, UTC+3) is used.
  assert.equal(localDateTimeToUtc('2026-10-25', '01:30', TZ), '2026-10-24T22:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-10-25', '00:30', TZ), '2026-10-24T21:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-10-25', '02:00', TZ), '2026-10-25T00:00:00.000Z');

  assert.equal(localDateTimeToUtc('2026-02-30', '10:00', TZ), null);
  assert.equal(localDateTimeToUtc('2026-02-01', '24:00', TZ), null);
  assert.equal(localDateTimeToUtc('2026-02-01', '9:05:30', TZ), '2026-02-01T07:05:30.000Z');
});

test('today and the current month follow the zone, not UTC', () => {
  const lateEvening = new Date('2026-10-31T22:30:00.000Z'); // 00:30 on 1.11 in Israel
  assert.equal(todayKey(TZ, lateEvening), '2026-11-01');
  assert.equal(currentMonthKey(TZ, lateEvening), '2026-11');
  assert.equal(todayKey('UTC', lateEvening), '2026-10-31');
});

test('date-only helpers across month and year ends, never touching a zone', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29', 'leap year');
  assert.equal(addDays('2026-03-27', 1), '2026-03-28', 'a DST day is still one day');
  assert.equal(addDays('bad', 1), '');

  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15');

  assert.equal(compareDateKeys('2026-12-31', '2027-01-01'), -1);
  assert.equal(compareDateKeys('2026-12-31', '2026-12-31'), 0);
  assert.equal(diffDays('2026-12-30', '2027-01-02'), 3);
  assert.equal(diffDays('2026-03-26', '2026-03-28'), 2);

  assert.equal(monthKeyOfDateKey('2026-12-31'), '2026-12');
  assert.equal(firstDayOfMonth('2026-12-31'), '2026-12-01');
  assert.equal(lastDayOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(lastDayOfMonth('2028-02'), '2028-02-29');
  assert.equal(daysInMonth('2026-04'), 30);

  assert.deepEqual(enumerateDateKeys('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(enumerateDateKeys('2027-01-02', '2026-12-30'), []);

  assert.equal(weekdayOfDateKey('2026-03-27'), 5, 'Friday');
  assert.equal(isDateKey('2026-02-29'), false);
  assert.equal(normalizeDateKey(' 2026-02-28 '), '2026-02-28');
  assert.equal(normalizeDateKey('2026-09-30T21:30:00.000Z'), '', 'never cuts a timestamp');
});

test('a calendar day picked in the UI keeps its day', () => {
  assert.equal(dateKeyFromCalendarDate(new Date(2026, 9, 1)), '2026-10-01');
  assert.equal(dateKeyFromCalendarDate(new Date('invalid')), '');
});

test('display formatters use the zone', () => {
  assert.equal(formatLocalDateTime('2026-09-30T21:30:00.000Z', TZ), '01/10/2026 00:30');
  assert.equal(formatLocalDateTime('nope', TZ), '');
  assert.equal(
    formatInstant('2026-09-30T21:30:00.000Z', { year: 'numeric', month: '2-digit', day: '2-digit' }, { locale: 'en-CA' }),
    '2026-10-01',
  );
  assert.equal(formatInstant(null), '');
  assert.equal(utcFileStamp('2026-09-30T21:30:05.000Z'), '2026-09-30-21-30-05');
});
