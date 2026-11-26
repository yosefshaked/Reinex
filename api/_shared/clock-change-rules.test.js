import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_ORG_TIME_ZONE } from './local-time.js';
import {
  LESSON_TIME_SKIPPED_CODE,
  buildClockChangeBands,
  checkRequestedLessonStart,
  clockChangeSeasonLabel,
  describeLessonStartClockChange,
  lessonLocalStartFields,
  readRequestedLocalStart,
  wallTimeAfterDelta,
} from './clock-change-rules.js';

const ZONE = DEFAULT_ORG_TIME_ZONE;

test('season wording follows the direction of the shift, not the month', () => {
  assert.equal(clockChangeSeasonLabel({ offsetBeforeMinutes: 120, offsetAfterMinutes: 180 }), 'שעון קיץ');
  assert.equal(clockChangeSeasonLabel({ offsetBeforeMinutes: 180, offsetAfterMinutes: 120 }), 'שעון חורף');
  // Southern hemisphere: the clock goes back in April — still "שעון חורף".
  const [april] = buildClockChangeBands('2026-04-05', '2026-04-05', { timeZone: 'Australia/Lord_Howe' });
  assert.equal(april.label, 'מעבר לשעון חורף: השעה הזו חוזרת פעמיים');
});

test('describeLessonStartClockChange: skipped blocks with the times from the zone, repeated warns', () => {
  const skipped = describeLessonStartClockChange('2026-03-27', '02:30', ZONE);
  assert.equal(skipped.kind, 'skipped');
  assert.equal(skipped.blocking, true);
  assert.equal(skipped.message, 'השעה הזו לא קיימת בלילה הזה: השעון עובר מ-02:00 ל-03:00.');

  const lordHowe = describeLessonStartClockChange('2026-10-04', '02:10', 'Australia/Lord_Howe');
  assert.equal(lordHowe.message, 'השעה הזו לא קיימת בלילה הזה: השעון עובר מ-02:00 ל-02:30.');

  const repeated = describeLessonStartClockChange('2026-10-25', '01:30:00', ZONE);
  assert.equal(repeated.kind, 'repeated');
  assert.equal(repeated.blocking, false);
  assert.equal(repeated.message, 'השעה הזו חוזרת פעמיים בלילה הזה בגלל המעבר לשעון חורף. המפגש ייקבע לפעם הראשונה.');

  assert.equal(describeLessonStartClockChange('2026-03-27', '03:30', ZONE), null);
  assert.equal(describeLessonStartClockChange('2026-03-27', '', ZONE), null);
  assert.equal(describeLessonStartClockChange('', '02:30', ZONE), null);
  assert.equal(describeLessonStartClockChange('2026-03-27', '02:30', 'Asia/Dubai'), null);
});

test('checkRequestedLessonStart: refuses only a requested wall time in a skipped hour', () => {
  const refusal = checkRequestedLessonStart({ start_local_date: '2026-03-27', start_local_time: '02:30' }, ZONE);
  assert.deepEqual(refusal, {
    code: LESSON_TIME_SKIPPED_CODE,
    message: 'השעה הזו לא קיימת בלילה הזה: השעון עובר מ-02:00 ל-03:00.',
    // Our own wording, marked for display (docs/project-rules/30).
    message_kind: 'user',
    clock_change: { date: '2026-03-27', kind: 'skipped', start_time: '02:00', end_time: '03:00' },
  });
  assert.equal(checkRequestedLessonStart({ start_local_date: '2026-03-27', start_local_time: '03:30' }, ZONE), null);
  assert.equal(checkRequestedLessonStart({ start_local_date: '2026-10-25', start_local_time: '01:30' }, ZONE), null);
  // Without the wall time (older clients, imports) there is nothing to check.
  assert.equal(checkRequestedLessonStart({ datetime_start: '2026-03-27T00:30:00.000Z' }, ZONE), null);
  assert.equal(readRequestedLocalStart({ start_local_date: '2026-02-30', start_local_time: '02:30' }), null);
  assert.equal(readRequestedLocalStart({ start_local_date: '2026-03-27', start_local_time: '25:00' }), null);
});

test('lessonLocalStartFields: the fields sent next to datetime_start', () => {
  assert.deepEqual(lessonLocalStartFields('2026-03-27', '02:30'), { start_local_date: '2026-03-27', start_local_time: '02:30' });
  assert.deepEqual(lessonLocalStartFields('2026-03-27', '02:30:00'), { start_local_date: '2026-03-27', start_local_time: '02:30' });
  assert.deepEqual(lessonLocalStartFields('', '02:30'), {});
});

test('wallTimeAfterDelta: a drag lands on the old wall start moved by the wall-clock delta', () => {
  const start = { dateKey: '2026-03-26', clock: '10:00' };
  assert.deepEqual(wallTimeAfterDelta(start, { days: 1, milliseconds: -(7.5 * 3600000) }), { dateKey: '2026-03-27', clock: '02:30' });
  assert.deepEqual(wallTimeAfterDelta(start, { days: 0, milliseconds: 15 * 3600000 }), { dateKey: '2026-03-27', clock: '01:00' });
  assert.deepEqual(wallTimeAfterDelta(start, { days: 0, milliseconds: -11 * 3600000 }), { dateKey: '2026-03-25', clock: '23:00' });
  assert.equal(wallTimeAfterDelta(start, { months: 1 }), null);
  assert.equal(wallTimeAfterDelta({ dateKey: '', clock: '10:00' }, { days: 1 }), null);
});

test('buildClockChangeBands: wall-clock bands for the visible days, only when the viewer shares the change', () => {
  assert.deepEqual(buildClockChangeBands('2026-03-22', '2026-03-28', { timeZone: ZONE }), [{
    id: 'clock-change-2026-03-27-skipped',
    kind: 'skipped',
    dateKey: '2026-03-27',
    start: '2026-03-27T02:00:00',
    end: '2026-03-27T03:00:00',
    label: 'מעבר לשעון קיץ: השעה הזו מדולגת',
  }]);
  const [autumn] = buildClockChangeBands('2026-10-25', '2026-10-25', { timeZone: ZONE });
  assert.equal(autumn.label, 'מעבר לשעון חורף: השעה הזו חוזרת פעמיים');
  assert.equal(autumn.start, '2026-10-25T01:00:00');
  // A repeated hour that ends at midnight ends on the next date.
  const [beirut] = buildClockChangeBands('2026-10-24', '2026-10-24', { timeZone: 'Asia/Beirut' });
  assert.equal(beirut.start, '2026-10-24T23:00:00');
  assert.equal(beirut.end, '2026-10-25T00:00:00');
  // No change in range, or a viewer whose browser zone does not share it: nothing is drawn.
  assert.deepEqual(buildClockChangeBands('2026-05-01', '2026-05-07', { timeZone: ZONE }), []);
  assert.deepEqual(buildClockChangeBands('2026-03-22', '2026-03-28', { timeZone: ZONE, viewerTimeZone: 'UTC' }), []);
  assert.deepEqual(buildClockChangeBands('2026-03-22', '2026-03-28', { timeZone: ZONE, viewerTimeZone: 'Europe/London' }), []);
  assert.equal(buildClockChangeBands('2026-03-22', '2026-03-28', { timeZone: ZONE, viewerTimeZone: ZONE }).length, 1);
});
