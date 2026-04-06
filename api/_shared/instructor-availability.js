import { daySortValue, normalizeDayToken } from './day-of-week.js';
import { normalizeString } from './org-bff.js';

export const DEFAULT_SCHEDULING_TIMEZONE = 'Asia/Jerusalem';

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
