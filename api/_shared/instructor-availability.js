import { daySortValue, normalizeDayToken } from './day-of-week.js';
import { normalizeString } from './org-bff.js';

export const DEFAULT_SCHEDULING_TIMEZONE = 'Asia/Jerusalem';

function getTimeZonePartMap(date, timeZone = DEFAULT_SCHEDULING_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getTimeZoneOffsetMinutes(date, timeZone = DEFAULT_SCHEDULING_TIMEZONE) {
  const partMap = getTimeZonePartMap(date, timeZone);
  const utcTimestampForTimeZoneClock = Date.UTC(
    Number(partMap.year),
    Number(partMap.month) - 1,
    Number(partMap.day),
    Number(partMap.hour),
    Number(partMap.minute),
    Number(partMap.second),
    0,
  );

  return Math.round((utcTimestampForTimeZoneClock - date.getTime()) / 60000);
}

function parseYmdDateString(dateString) {
  const normalized = normalizeString(dateString);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
  ) {
    return null;
  }

  return { year, month, day };
}

export function normalizeClockTime(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return '';
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function timeToMinutes(value) {
  const normalized = normalizeClockTime(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(':').map(Number);
  return (hours * 60) + minutes;
}

export function normalizeAvailabilityWindows(rawWindows) {
  if (rawWindows === undefined || rawWindows === null) {
    return { valid: true, value: [] };
  }
  if (!Array.isArray(rawWindows)) {
    return { valid: false, value: [] };
  }

  const normalized = [];
  for (const window of rawWindows) {
    const day = normalizeDayToken(window?.day);
    const start = normalizeClockTime(window?.start);
    const end = normalizeClockTime(window?.end);
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);

    if (!day || !start || !end || startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
      return { valid: false, value: [] };
    }

    normalized.push({ day, start, end });
  }

  normalized.sort((left, right) => {
    const dayDiff = daySortValue(left.day) - daySortValue(right.day);
    if (dayDiff !== 0) return dayDiff;
    return left.start.localeCompare(right.start);
  });

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (previous.day !== current.day) continue;
    const previousEndMinutes = timeToMinutes(previous.end);
    const currentStartMinutes = timeToMinutes(current.start);
    if (previousEndMinutes != null && currentStartMinutes != null && currentStartMinutes < previousEndMinutes) {
      return { valid: false, value: [] };
    }
  }

  return { valid: true, value: normalized };
}

export function hasConfiguredAvailability(availabilityWindows) {
  return Array.isArray(availabilityWindows) && availabilityWindows.length > 0;
}

export function isWithinAvailabilityWindows({ availabilityWindows, day, startTime, durationMinutes }) {
  const normalizedDay = normalizeDayToken(day);
  const startMinutes = timeToMinutes(startTime);
  const safeDuration = Number(durationMinutes) || 0;
  if (!normalizedDay || startMinutes == null || safeDuration <= 0 || !hasConfiguredAvailability(availabilityWindows)) {
    return false;
  }

  const endMinutes = startMinutes + safeDuration;
  return availabilityWindows.some((window) => {
    if (normalizeDayToken(window?.day) !== normalizedDay) return false;
    const windowStart = timeToMinutes(window?.start);
    const windowEnd = timeToMinutes(window?.end);
    if (windowStart == null || windowEnd == null) return false;
    return startMinutes >= windowStart && endMinutes <= windowEnd;
  });
}

export function getAvailabilityWindowsForDay(availabilityWindows, day) {
  const normalizedDay = normalizeDayToken(day);
  if (!normalizedDay || !Array.isArray(availabilityWindows)) return [];
  return availabilityWindows
    .filter((window) => normalizeDayToken(window?.day) === normalizedDay)
    .map((window) => ({
      day: normalizedDay,
      start: normalizeClockTime(window?.start),
      end: normalizeClockTime(window?.end),
    }))
    .filter((window) => window.start && window.end);
}

export function extractScheduleSlotFromIso(datetimeValue, timeZone = DEFAULT_SCHEDULING_TIMEZONE) {
  const date = new Date(datetimeValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = normalizeDayToken(partMap.weekday);
  const startTime = normalizeClockTime(`${partMap.hour || ''}:${partMap.minute || ''}`);

  if (!day || !startTime) {
    return null;
  }

  return { day, startTime };
}

export function getCurrentDateInTimezone(timeZone = DEFAULT_SCHEDULING_TIMEZONE) {
  const partMap = getTimeZonePartMap(new Date(), timeZone);
  const year = partMap.year;
  const month = partMap.month;
  const day = partMap.day;
  if (!year || !month || !day) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

export function getDateKeyInTimezone(datetimeValue, timeZone = DEFAULT_SCHEDULING_TIMEZONE) {
  const date = new Date(datetimeValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const partMap = getTimeZonePartMap(date, timeZone);
  const year = partMap.year;
  const month = partMap.month;
  const day = partMap.day;
  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

export function buildUtcIsoForTimezoneDateTime(dateString, timeString, timeZone = DEFAULT_SCHEDULING_TIMEZONE) {
  const parsedDate = parseYmdDateString(dateString);
  const normalizedTime = normalizeClockTime(timeString);
  if (!parsedDate || !normalizedTime) {
    return null;
  }

  const [hours, minutes] = normalizedTime.split(':').map(Number);
  const naiveUtcTimestamp = Date.UTC(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    hours,
    minutes,
    0,
    0,
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(naiveUtcTimestamp), timeZone);
  return new Date(naiveUtcTimestamp - (offsetMinutes * 60 * 1000)).toISOString();
}

export function buildUtcBoundsForTimezoneDateRange(startDateString, endDateString, timeZone = DEFAULT_SCHEDULING_TIMEZONE) {
  const rangeStartIso = buildUtcIsoForTimezoneDateTime(startDateString, '00:00', timeZone);
  const parsedEndDate = parseYmdDateString(endDateString);
  if (!rangeStartIso || !parsedEndDate) {
    return null;
  }

  const nextDayUtc = new Date(Date.UTC(parsedEndDate.year, parsedEndDate.month - 1, parsedEndDate.day, 0, 0, 0, 0));
  nextDayUtc.setUTCDate(nextDayUtc.getUTCDate() + 1);
  const nextDayParts = getTimeZonePartMap(nextDayUtc, 'UTC');
  const rangeEndExclusiveIso = buildUtcIsoForTimezoneDateTime(
    `${nextDayParts.year}-${nextDayParts.month}-${nextDayParts.day}`,
    '00:00',
    timeZone,
  );

  if (!rangeEndExclusiveIso) {
    return null;
  }

  return {
    startIso: rangeStartIso,
    endIso: rangeEndExclusiveIso,
    endExclusiveIso: rangeEndExclusiveIso,
  };
}
