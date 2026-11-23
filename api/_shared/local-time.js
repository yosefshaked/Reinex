// @ts-check
/**
 * Dates and time zones — the one module every date decision in Reinex goes through.
 *
 * Isomorphic: no imports, no Node or browser APIs beyond `Intl` and `Date`, so the API imports it
 * directly and the frontend re-exports it from `src/lib/local-time.js`. Do not copy it.
 *
 * Rules
 * 1. An instant (a moment: `lesson_instances.datetime_start`, `created_at`, ...) is stored as
 *    timestamptz in UTC and travels as an ISO string. Never change that.
 * 2. A calendar date with no time (attendance day, leave day, rate effective date, valid_from, ...)
 *    is a 'YYYY-MM-DD' key ("date key"). It is never converted through a time zone: the
 *    date-only helpers below (`addDays`, `firstDayOfMonth`, `enumerateDateKeys`, ...) do pure
 *    calendar arithmetic.
 * 3. "Which local day / month / time is this instant" is answered only by `localDateKey`,
 *    `localMonthKey`, `localTime`, `localWeekday`, in the organisation's time zone
 *    (`resolveOrgTimeZone`). Never cut a date out of `toISOString()` — that is the UTC date, and a
 *    lesson at 00:30 Israel time would land on the previous day (and at month end, month).
 * 4. Range queries on instants go through `startOfLocalDayUtc` / `endOfLocalDayUtc` /
 *    `localDateRangeUtc` / `localMonthRangeUtc`, which resolve the real UTC offset on that date,
 *    so a 23-hour (spring) or 25-hour (autumn) day is exactly covered.
 * 5. A UTC date is legitimate only for technical stamps (file names, log ids, retention cut-offs):
 *    use `utcDateKey` so it is explicit. The ESLint rule in `eslint.config.js` rejects
 *    `.toISOString().slice(0, 10)`, `.split('T')[0]`, `.substring(0, 10)` and the zone literal
 *    outside this module.
 *
 * Wall-clock to instant (`localDateTimeToUtc`), DST decisions
 * - Non-existent local time (spring forward, e.g. Israel 27.03.2026 02:00 -> 03:00): the time is
 *   shifted forward by the gap, so 02:30 becomes 03:30 local (00:30Z).
 * - Repeated local time (autumn back, e.g. Israel 25.10.2026 02:00 -> 01:00): the FIRST
 *   occurrence is used (the earlier instant, still on summer time), so 01:30 becomes 22:30Z on
 *   24.10, not 23:30Z.
 *
 * Clock changes (`findClockChanges`, `classifyLocalTime`)
 * - Derived only from the IANA zone through `Intl`: the offset is compared across each day and the
 *   change located to the minute. Nothing is hard-coded to a country, a date or a 60-minute shift;
 *   a zone without changes returns none.
 * - 'skipped': a wall-clock interval that does not exist (offset increases). A person may not
 *   schedule a lesson that STARTS in it (422 `lesson_time_skipped_by_clock_change`); template
 *   generation skips that single occurrence and reports it.
 * - 'repeated': a wall-clock interval that happens twice (offset decreases). Allowed; the lesson
 *   is saved at the first occurrence and the form warns before saving.
 * - "Summer time" / "winter time" wording follows the direction of the shift, never the month.
 *
 * One time zone per organisation. There is no per-org time-zone setting today; every org resolves
 * to DEFAULT_ORG_TIME_ZONE through `resolveOrgTimeZone`. Adding a per-org setting later means
 * changing `resolveOrgTimeZone` only (and passing the org to it where it is known).
 */

export const DEFAULT_ORG_TIME_ZONE = 'Asia/Jerusalem';

/**
 * The IANA time zone an organisation's local dates are decided in.
 * Today every organisation is Israeli, so this returns DEFAULT_ORG_TIME_ZONE. When a per-org
 * setting is added, this takes the organisation (row or settings) and returns its zone.
 * @returns {string}
 */
export function resolveOrgTimeZone() {
  return DEFAULT_ORG_TIME_ZONE;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_INDEX = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

const partsFormatterCache = new Map();

function getPartsFormatter(timeZone) {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pad4(value) {
  return String(value).padStart(4, '0');
}

// ---------------------------------------------------------------------------------------------
// Date-only helpers: pure calendar arithmetic, never touch a time zone.
// ---------------------------------------------------------------------------------------------

/**
 * Parse a 'YYYY-MM-DD' key into numbers, or null when it is not a real calendar date.
 * @param {unknown} value
 * @returns {{ year: number, month: number, day: number } | null}
 */
export function parseDateKey(value) {
  if (typeof value !== 'string') return null;
  const match = DATE_KEY_PATTERN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(`${match[1]}-${match[2]}`)) {
    return null;
  }
  return { year, month, day };
}

/** @param {unknown} value @returns {value is string} */
export function isDateKey(value) {
  return parseDateKey(value) !== null;
}

/** @param {unknown} value @returns {value is string} */
export function isMonthKey(value) {
  if (typeof value !== 'string') return false;
  const match = MONTH_KEY_PATTERN.exec(value.trim());
  return Boolean(match) && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

/**
 * Build a date key from calendar numbers (month is 1-based). Overflow rolls over, as Date.UTC does.
 * @param {number} year @param {number} month @param {number} day
 */
export function dateKeyFromParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year, month - 1, day);
  return `${pad4(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * Normalise a value that is already a calendar date (a `date` column, a form field) to its
 * 'YYYY-MM-DD' key. Returns '' for anything that is not a date key — it never cuts a date out of a
 * timestamp. Use `localDateKey` when the value may be an instant.
 * @param {unknown} value
 */
export function normalizeDateKey(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return isDateKey(trimmed) ? trimmed : '';
}

/**
 * The date key of a browser/JS Date that represents a CALENDAR DAY picked in the UI (a date
 * picker, `new Date(y, m, d)`): read with the local getters, so the day the user clicked is the
 * day you get. Not for instants — use `localDateKey` for those.
 * @param {Date} date
 */
export function dateKeyFromCalendarDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${pad4(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * The date key of a JS Date whose UTC fields carry a CALENDAR DAY (spreadsheet cells, Excel
 * serials, `new Date(Date.UTC(y, m, d))`): no time zone is applied. Not for instants.
 * @param {Date} date
 */
export function dateKeyFromUtcCalendarDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${pad4(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * A JS Date at local midnight of a date key, for UI widgets (date pickers) that need a Date.
 * The inverse of `dateKeyFromCalendarDate`.
 * @param {string} dateKey
 */
export function calendarDateFromDateKey(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

/** @param {string} dateKey @param {number} days */
export function addDays(dateKey, days) {
  const parsed = parseDateKey(dateKey);
  if (!parsed || !Number.isFinite(days)) return '';
  return dateKeyFromParts(parsed.year, parsed.month, parsed.day + Math.trunc(days));
}

/**
 * Add whole months to a date key; the day is clamped to the target month's length (31.01 + 1 -> 28.02).
 * @param {string} dateKey @param {number} months
 */
export function addMonths(dateKey, months) {
  const parsed = parseDateKey(dateKey);
  if (!parsed || !Number.isFinite(months)) return '';
  const monthIndex = (parsed.year * 12) + (parsed.month - 1) + Math.trunc(months);
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const monthKey = `${pad4(year)}-${pad2(month)}`;
  return `${monthKey}-${pad2(Math.min(parsed.day, daysInMonth(monthKey)))}`;
}

/**
 * Compare two date keys (or two month keys): negative, 0 or positive. Keys sort as strings.
 * @param {string} left @param {string} right
 */
export function compareDateKeys(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Whole days from `fromKey` to `toKey` (positive when `toKey` is later). */
export function diffDays(fromKey, toKey) {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) return NaN;
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / DAY_MS,
  );
}

/** 'YYYY-MM' of a date key (no time zone involved). */
export function monthKeyOfDateKey(dateKey) {
  return isDateKey(dateKey) ? dateKey.trim().slice(0, 7) : '';
}

/** Number of days in a 'YYYY-MM' month. */
export function daysInMonth(monthKey) {
  const match = MONTH_KEY_PATTERN.exec(String(monthKey || '').trim());
  if (!match) return 0;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
}

/** First day ('YYYY-MM-01') of the month of a date key or a month key. */
export function firstDayOfMonth(dateOrMonthKey) {
  const monthKey = isMonthKey(dateOrMonthKey) ? dateOrMonthKey.trim() : monthKeyOfDateKey(dateOrMonthKey);
  return monthKey ? `${monthKey}-01` : '';
}

/** Last day of the month of a date key or a month key. */
export function lastDayOfMonth(dateOrMonthKey) {
  const monthKey = isMonthKey(dateOrMonthKey) ? dateOrMonthKey.trim() : monthKeyOfDateKey(dateOrMonthKey);
  return monthKey ? `${monthKey}-${pad2(daysInMonth(monthKey))}` : '';
}

/** Every date key from `startKey` to `endKey`, both included; [] when the range is empty or invalid. */
export function enumerateDateKeys(startKey, endKey) {
  if (!isDateKey(startKey) || !isDateKey(endKey) || startKey > endKey) return [];
  const keys = [];
  for (let cursor = startKey.trim(); cursor && cursor <= endKey; cursor = addDays(cursor, 1)) {
    keys.push(cursor);
  }
  return keys;
}

/** Weekday of a calendar date (0 = Sunday ... 6 = Saturday). Pure calendar, no time zone. */
export function weekdayOfDateKey(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

// ---------------------------------------------------------------------------------------------
// Instants in the organisation's zone.
// ---------------------------------------------------------------------------------------------

/**
 * Coerce an instant (Date, epoch ms, ISO string) to a valid Date, or null.
 * @param {unknown} value
 */
export function toInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(/** @type {any} */ (value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The wall-clock parts of an instant in a zone.
 * @param {unknown} instant
 * @param {string} [timeZone]
 */
export function localParts(instant, timeZone = resolveOrgTimeZone()) {
  const date = toInstant(instant);
  if (!date) return null;
  const map = {};
  for (const part of getPartsFormatter(timeZone).formatToParts(date)) {
    map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday] ?? null,
  };
}

/**
 * Minutes the zone is ahead of UTC at that instant (Israel: 120 in winter, 180 in summer).
 * @param {unknown} instant @param {string} [timeZone]
 */
export function utcOffsetMinutes(instant, timeZone = resolveOrgTimeZone()) {
  const date = toInstant(instant);
  const parts = localParts(date, timeZone);
  if (!date || !parts) return NaN;
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((wallAsUtc - (Math.floor(date.getTime() / 1000) * 1000)) / 60000);
}

/**
 * 'YYYY-MM-DD' of an instant in the zone. A value that is already a date key is returned as is
 * (a calendar date is never shifted through a zone). '' for empty/invalid input.
 * @param {unknown} value @param {string} [timeZone]
 */
export function localDateKey(value, timeZone = resolveOrgTimeZone()) {
  if (typeof value === 'string' && isDateKey(value)) return value.trim();
  const parts = localParts(value, timeZone);
  if (!parts) return '';
  return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** 'YYYY-MM' of an instant (or of a date key) in the zone. */
export function localMonthKey(value, timeZone = resolveOrgTimeZone()) {
  return localDateKey(value, timeZone).slice(0, 7);
}

/** 'HH:mm' (24h) wall-clock time of an instant in the zone; '' for invalid input. */
export function localTime(value, timeZone = resolveOrgTimeZone()) {
  const parts = localParts(value, timeZone);
  if (!parts) return '';
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Weekday of an instant in the zone (0 = Sunday ... 6 = Saturday), or null. */
export function localWeekday(value, timeZone = resolveOrgTimeZone()) {
  if (typeof value === 'string' && isDateKey(value)) return weekdayOfDateKey(value);
  return localParts(value, timeZone)?.weekday ?? null;
}

/** Today's date key in the zone. `now` is injectable for tests. */
export function todayKey(timeZone = resolveOrgTimeZone(), now = new Date()) {
  return localDateKey(now, timeZone);
}

/** This month's 'YYYY-MM' in the zone. */
export function currentMonthKey(timeZone = resolveOrgTimeZone(), now = new Date()) {
  return localMonthKey(now, timeZone);
}

function parseClock(value) {
  const match = CLOCK_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/**
 * The UTC instant (ISO string) of a local wall-clock time on a date in the zone.
 * Non-existent time (spring forward): shifted forward by the gap. Repeated time (autumn back):
 * the first occurrence. Returns null for an invalid date key or time.
 * @param {string} dateKey 'YYYY-MM-DD'
 * @param {string} clock 'HH:mm' or 'HH:mm:ss'
 * @param {string} [timeZone]
 */
export function localDateTimeToUtc(dateKey, clock, timeZone = resolveOrgTimeZone()) {
  const date = parseDateKey(dateKey);
  const time = parseClock(clock);
  if (!date || !time) return null;

  const wallAsUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second);
  // The offsets in force a day before and a day after cover any single transition near this time.
  const offsetBefore = utcOffsetMinutes(wallAsUtc - DAY_MS, timeZone);
  const offsetAfter = utcOffsetMinutes(wallAsUtc + DAY_MS, timeZone);
  const candidates = [...new Set([offsetBefore, offsetAfter, utcOffsetMinutes(wallAsUtc, timeZone)])]
    .map((offset) => wallAsUtc - (offset * 60000))
    .filter((instant) => {
      const parts = localParts(instant, timeZone);
      return parts
        && Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) === wallAsUtc;
    })
    .sort((left, right) => left - right);

  if (candidates.length > 0) {
    // One match normally; two in the repeated hour, where the earlier (first occurrence) wins.
    return new Date(candidates[0]).toISOString();
  }
  // Non-existent wall time: read it with the offset in force before the gap, which lands the same
  // distance after the gap (02:30 in a 02:00 -> 03:00 jump becomes 03:30).
  return new Date(wallAsUtc - (offsetBefore * 60000)).toISOString();
}

// ---------------------------------------------------------------------------------------------
// Clock changes (daylight saving and any other offset change), derived from the zone.
// ---------------------------------------------------------------------------------------------

const MINUTE_MS = 60000;

function wallKeyAndClock(wallAsUtcMs) {
  const date = new Date(wallAsUtcMs);
  return {
    dateKey: dateKeyFromUtcCalendarDate(date),
    clock: `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`,
  };
}

/**
 * Every offset change of the zone whose local date falls in `fromDateKey`..`toDateKey` (both
 * included), oldest first. Found by comparing the offset across each day and locating the change
 * to the minute, so shifts that are not 60 minutes and changes at local midnight are handled.
 * - 'skipped' (offset increases): wall times `startTime` (incl.) .. `endTime` (excl.) do not exist.
 * - 'repeated' (offset decreases): wall times `startTime` .. `endTime` happen twice.
 * `dateKey` is the local date the interval starts on; `endTime` may be '00:00' of the next day.
 * @param {string} fromDateKey @param {string} toDateKey @param {string} [timeZone]
 * @returns {Array<{ dateKey: string, kind: 'skipped' | 'repeated', startTime: string, endTime: string,
 *   offsetBeforeMinutes: number, offsetAfterMinutes: number }>}
 */
export function findClockChanges(fromDateKey, toDateKey, timeZone = resolveOrgTimeZone()) {
  const from = parseDateKey(fromDateKey);
  const to = parseDateKey(toDateKey);
  if (!from || !to || fromDateKey > toDateKey) return [];

  // Scan whole UTC days with a day of margin on each side: offsets are at most ±14h, so every
  // instant whose local date is in the range is covered.
  const scanStart = Date.UTC(from.year, from.month - 1, from.day) - DAY_MS;
  const scanEnd = Date.UTC(to.year, to.month - 1, to.day) + (2 * DAY_MS);
  const changes = [];
  let cursor = scanStart;
  let cursorOffset = utcOffsetMinutes(cursor, timeZone);
  while (cursor < scanEnd) {
    const next = cursor + DAY_MS;
    const nextOffset = utcOffsetMinutes(next, timeZone);
    if (nextOffset !== cursorOffset) {
      // Binary search for the first minute with the new offset.
      let low = cursor; // old offset
      let high = next; // new offset
      while (high - low > MINUTE_MS) {
        const mid = low + (Math.floor((high - low) / MINUTE_MS / 2) * MINUTE_MS);
        if (utcOffsetMinutes(mid, timeZone) === cursorOffset) low = mid;
        else high = mid;
      }
      const offsetBeforeMinutes = utcOffsetMinutes(high - MINUTE_MS, timeZone);
      const offsetAfterMinutes = utcOffsetMinutes(high, timeZone);
      if (offsetAfterMinutes !== offsetBeforeMinutes) {
        const wallOld = high + (offsetBeforeMinutes * MINUTE_MS);
        const wallNew = high + (offsetAfterMinutes * MINUTE_MS);
        const kind = offsetAfterMinutes > offsetBeforeMinutes ? 'skipped' : 'repeated';
        const start = wallKeyAndClock(Math.min(wallOld, wallNew));
        const end = wallKeyAndClock(Math.max(wallOld, wallNew));
        if (start.dateKey >= fromDateKey && start.dateKey <= toDateKey) {
          changes.push({
            dateKey: start.dateKey,
            kind,
            startTime: start.clock,
            endTime: end.clock,
            offsetBeforeMinutes,
            offsetAfterMinutes,
          });
        }
      }
    }
    cursor = next;
    cursorOffset = nextOffset;
  }
  return changes;
}

/**
 * The clock change whose interval contains this local wall time, or null.
 * @param {string} dateKey @param {string} clock 'HH:mm' @param {string} [timeZone]
 */
export function findClockChangeAt(dateKey, clock, timeZone = resolveOrgTimeZone()) {
  const date = parseDateKey(dateKey);
  const time = parseClock(clock);
  if (!date || !time) return null;
  const wall = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second);
  // An interval that starts the previous evening can reach past midnight into this date.
  for (const change of findClockChanges(addDays(dateKey, -1), dateKey, timeZone)) {
    const changeDate = parseDateKey(change.dateKey);
    const startTime = parseClock(change.startTime);
    if (!changeDate || !startTime) continue;
    const start = Date.UTC(changeDate.year, changeDate.month - 1, changeDate.day, startTime.hour, startTime.minute);
    const length = Math.abs(change.offsetAfterMinutes - change.offsetBeforeMinutes) * MINUTE_MS;
    if (wall >= start && wall < start + length) return change;
  }
  return null;
}

/**
 * Whether a local wall time exists once ('normal'), not at all ('skipped') or twice ('repeated').
 * Returns 'normal' for an invalid date or time (callers validate those separately).
 * @param {string} dateKey @param {string} clock 'HH:mm' @param {string} [timeZone]
 * @returns {'normal' | 'skipped' | 'repeated'}
 */
export function classifyLocalTime(dateKey, clock, timeZone = resolveOrgTimeZone()) {
  return findClockChangeAt(dateKey, clock, timeZone)?.kind || 'normal';
}

/** UTC instant (ISO) where the local day starts. */
export function startOfLocalDayUtc(dateKey, timeZone = resolveOrgTimeZone()) {
  return localDateTimeToUtc(dateKey, '00:00', timeZone);
}

/** UTC instant (ISO) where the local day ends — EXCLUSIVE: the start of the next local day. */
export function endOfLocalDayUtc(dateKey, timeZone = resolveOrgTimeZone()) {
  const nextDay = addDays(dateKey, 1);
  return nextDay ? startOfLocalDayUtc(nextDay, timeZone) : null;
}

/**
 * UTC bounds of the local days `startKey`..`endKey` (both included), for `.gte(startIso)`
 * `.lt(endExclusiveIso)` queries. `endIso` is the same exclusive bound (kept for older callers).
 * A reversed range is not rejected here: its bounds are simply empty (start after end).
 * @returns {{ startIso: string, endIso: string, endExclusiveIso: string } | null}
 */
export function localDateRangeUtc(startKey, endKey, timeZone = resolveOrgTimeZone()) {
  if (!isDateKey(startKey) || !isDateKey(endKey)) return null;
  const startIso = startOfLocalDayUtc(startKey, timeZone);
  const endExclusiveIso = endOfLocalDayUtc(endKey, timeZone);
  if (!startIso || !endExclusiveIso) return null;
  return { startIso, endIso: endExclusiveIso, endExclusiveIso };
}

/** UTC bounds of a local month ('YYYY-MM', or any date key in it). */
export function localMonthRangeUtc(monthKey, timeZone = resolveOrgTimeZone()) {
  const first = firstDayOfMonth(monthKey);
  const last = lastDayOfMonth(monthKey);
  if (!first || !last) return null;
  return localDateRangeUtc(first, last, timeZone);
}

// ---------------------------------------------------------------------------------------------
// Display.
// ---------------------------------------------------------------------------------------------

/**
 * Format an instant for people, in the org's zone (default Hebrew locale). Returns '' for an
 * invalid value so callers choose their own fallback.
 * @param {unknown} value
 * @param {Intl.DateTimeFormatOptions} [options]
 * @param {{ timeZone?: string, locale?: string }} [settings]
 */
export function formatInstant(value, options = { dateStyle: 'short', timeStyle: 'short' }, settings = {}) {
  const date = toInstant(value);
  if (!date) return '';
  const { timeZone = resolveOrgTimeZone(), locale = 'he-IL' } = settings;
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return '';
  }
}

/** 'DD/MM/YYYY HH:mm' of an instant in the zone; '' for invalid input. */
export function formatLocalDateTime(value, timeZone = resolveOrgTimeZone()) {
  const parts = localParts(value, timeZone);
  if (!parts) return '';
  return `${pad2(parts.day)}/${pad2(parts.month)}/${pad4(parts.year)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

// ---------------------------------------------------------------------------------------------
// Technical UTC stamps — only for file names, log ids and retention cut-offs, never a business date.
// ---------------------------------------------------------------------------------------------

/** The UTC calendar date of an instant. Technical use only (file names, ids, retention). */
export function utcDateKey(value = new Date()) {
  const date = toInstant(value);
  return date ? dateKeyFromUtcCalendarDate(date) : '';
}

/** 'YYYY-MM-DD-HH-mm-ss' in UTC, for file names. Technical use only. */
export function utcFileStamp(value = new Date()) {
  const date = toInstant(value);
  if (!date) return '';
  return `${utcDateKey(date)}-${pad2(date.getUTCHours())}-${pad2(date.getUTCMinutes())}-${pad2(date.getUTCSeconds())}`;
}
