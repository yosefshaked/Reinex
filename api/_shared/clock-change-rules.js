// @ts-check
/**
 * Clock changes (daylight saving) for lessons — the rules the API and the calendar share.
 *
 * Isomorphic (imports only `local-time.js`); the frontend imports it through
 * `src/lib/clock-change.js`. Every interval comes from `findClockChanges` for the org's zone:
 * nothing here knows a country, a date or a shift length.
 *
 * - Spring ('skipped' interval): a lesson may not START in it. The calendar dialogs know the wall
 *   time the person typed or dropped on and send it as `start_local_date` + `start_local_time`
 *   next to `datetime_start`; the server checks that wall time (the instant alone cannot show it:
 *   the browser has already moved 02:30 to 03:30). 422 `lesson_time_skipped_by_clock_change`.
 *   Template generation skips that single occurrence and reports it as a conflict.
 * - Autumn ('repeated' interval): allowed, saved at the first occurrence; the form shows a notice.
 * - "שעון קיץ" / "שעון חורף" follows the direction of the shift (offset up / down), not the month.
 */
import {
  addDays,
  findClockChangeAt,
  findClockChanges,
  isDateKey,
  resolveOrgTimeZone,
} from './local-time.js';

export const LESSON_TIME_SKIPPED_CODE = 'lesson_time_skipped_by_clock_change';
export const GENERATION_SKIPPED_BY_CLOCK_CHANGE_TYPE = 'clock_change_skipped_time';

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * 'שעון קיץ' when the clock moves forward (offset increases), 'שעון חורף' when it moves back.
 * @param {{ offsetBeforeMinutes: number, offsetAfterMinutes: number }} change
 */
export function clockChangeSeasonLabel(change) {
  return change.offsetAfterMinutes > change.offsetBeforeMinutes ? 'שעון קיץ' : 'שעון חורף';
}

/** @param {{ startTime: string, endTime: string }} change */
export function skippedTimeMessage(change) {
  return `השעה הזו לא קיימת בלילה הזה: השעון עובר מ-${change.startTime} ל-${change.endTime}.`;
}

/** @param {{ offsetBeforeMinutes: number, offsetAfterMinutes: number }} change */
export function repeatedTimeMessage(change) {
  return `השעה הזו חוזרת פעמיים בלילה הזה בגלל המעבר ל${clockChangeSeasonLabel(change)}. המפגש ייקבע לפעם הראשונה.`;
}

/** 'HH:mm' or null (seconds are dropped). @param {unknown} value */
function normalizeClock(value) {
  const trimmed = String(value ?? '').trim().slice(0, 5);
  return CLOCK_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * What a person should be told about a lesson that starts at this local wall time, or null when
 * the time exists exactly once.
 * @param {string} dateKey @param {string} clock 'HH:mm' @param {string} [timeZone]
 * @returns {null | { kind: 'skipped' | 'repeated', blocking: boolean, message: string,
 *   change: ReturnType<typeof findClockChanges>[number] }}
 */
export function describeLessonStartClockChange(dateKey, clock, timeZone = resolveOrgTimeZone()) {
  const normalizedClock = normalizeClock(clock);
  if (!isDateKey(dateKey) || !normalizedClock) return null;
  const change = findClockChangeAt(dateKey, normalizedClock, timeZone);
  if (!change) return null;
  if (change.kind === 'skipped') {
    return { kind: 'skipped', blocking: true, message: skippedTimeMessage(change), change };
  }
  return { kind: 'repeated', blocking: false, message: repeatedTimeMessage(change), change };
}

/**
 * The wall time a person chose for a lesson's start, as sent by the calendar next to
 * `datetime_start`; null when the request does not carry it (older clients, imports).
 * @param {any} body
 * @returns {{ dateKey: string, clock: string } | null}
 */
export function readRequestedLocalStart(body) {
  const dateKey = String(body?.start_local_date ?? '').trim();
  const clock = normalizeClock(body?.start_local_time);
  if (!isDateKey(dateKey) || !clock) return null;
  return { dateKey, clock };
}

/**
 * The 422 body when the requested local start is in a skipped interval, otherwise null.
 * @param {any} body @param {string} [timeZone]
 */
export function checkRequestedLessonStart(body, timeZone = resolveOrgTimeZone()) {
  const requested = readRequestedLocalStart(body);
  if (!requested) return null;
  const notice = describeLessonStartClockChange(requested.dateKey, requested.clock, timeZone);
  if (!notice?.blocking) return null;
  return {
    code: LESSON_TIME_SKIPPED_CODE,
    message: notice.message,
    clock_change: {
      date: notice.change.dateKey,
      kind: notice.change.kind,
      start_time: notice.change.startTime,
      end_time: notice.change.endTime,
    },
  };
}

/** The fields the calendar sends with `datetime_start`. @param {string} dateKey @param {string} clock */
export function lessonLocalStartFields(dateKey, clock) {
  const normalizedClock = normalizeClock(clock);
  if (!isDateKey(dateKey) || !normalizedClock) return {};
  return { start_local_date: dateKey, start_local_time: normalizedClock };
}

/**
 * The wall time a calendar drag lands on: the old local start moved by FullCalendar's wall-clock
 * delta (`{ days, milliseconds }`). The dropped Date cannot be used for this — in a skipped
 * interval the browser has already moved it past the gap.
 * @param {{ dateKey: string, clock: string }} start
 * @param {{ years?: number, months?: number, days?: number, milliseconds?: number }} delta
 * @returns {{ dateKey: string, clock: string } | null}
 */
export function wallTimeAfterDelta(start, delta) {
  const clock = normalizeClock(start?.clock);
  if (!isDateKey(start?.dateKey) || !clock || !delta) return null;
  if (Number(delta.years || 0) !== 0 || Number(delta.months || 0) !== 0) return null;
  const [hours, minutes] = clock.split(':').map(Number);
  const totalMinutes = (hours * 60) + minutes + Math.round(Number(delta.milliseconds || 0) / 60000);
  const dayShift = Math.floor(totalMinutes / 1440);
  const minuteOfDay = totalMinutes - (dayShift * 1440);
  const dateKey = addDays(start.dateKey, Number(delta.days || 0) + dayShift);
  if (!dateKey) return null;
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');
  return { dateKey, clock: `${hh}:${mm}` };
}

function sameChange(left, right) {
  return left.kind === right.kind
    && left.startTime === right.startTime
    && left.endTime === right.endTime
    && left.offsetBeforeMinutes === right.offsetBeforeMinutes
    && left.offsetAfterMinutes === right.offsetAfterMinutes;
}

/**
 * Calendar bands for the clock changes in `fromDateKey`..`toDateKey`, as wall-clock strings
 * without an offset ('YYYY-MM-DDTHH:mm:00'), which the time grid places on its own wall clock.
 * The grid runs in the viewer's browser zone, so a band is only returned when `viewerTimeZone`
 * has the very same change; otherwise the org's wall times would be drawn at the wrong hours.
 * @param {string} fromDateKey @param {string} toDateKey
 * @param {{ timeZone?: string, viewerTimeZone?: string }} [zones]
 */
export function buildClockChangeBands(fromDateKey, toDateKey, zones = {}) {
  const timeZone = zones.timeZone || resolveOrgTimeZone();
  const viewerTimeZone = zones.viewerTimeZone || timeZone;
  const changes = findClockChanges(fromDateKey, toDateKey, timeZone);
  if (changes.length === 0) return [];
  const viewerChanges = viewerTimeZone === timeZone
    ? changes
    : findClockChanges(fromDateKey, toDateKey, viewerTimeZone);
  return changes
    .filter((change) => viewerChanges.some((viewerChange) => viewerChange.dateKey === change.dateKey && sameChange(viewerChange, change)))
    .map((change) => {
      const endDateKey = change.endTime <= change.startTime ? addDays(change.dateKey, 1) : change.dateKey;
      const season = clockChangeSeasonLabel(change);
      return {
        id: `clock-change-${change.dateKey}-${change.kind}`,
        kind: change.kind,
        dateKey: change.dateKey,
        start: `${change.dateKey}T${change.startTime}:00`,
        end: `${endDateKey}T${change.endTime}:00`,
        label: change.kind === 'skipped'
          ? `מעבר ל${season}: השעה הזו מדולגת`
          : `מעבר ל${season}: השעה הזו חוזרת פעמיים`,
      };
    });
}
