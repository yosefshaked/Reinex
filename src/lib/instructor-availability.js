import { DAY_OPTIONS, daySortValue, normalizeDayToken } from '@/lib/day-of-week.js';

export function normalizeClockTime(value) {
  const normalized = typeof value === 'string' ? value.trim() : String(value || '').trim();
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

export function getAvailabilityDayTokens(availabilityWindows) {
  if (!Array.isArray(availabilityWindows)) {
    return [];
  }

  return Array.from(new Set(
    availabilityWindows
      .map((window) => normalizeDayToken(window?.day))
      .filter(Boolean),
  )).sort((left, right) => daySortValue(left) - daySortValue(right));
}

export function getAvailabilitySummary(availabilityWindows) {
  const days = getAvailabilityDayTokens(availabilityWindows);
  if (days.length === 0) {
    return 'לא הוגדרה זמינות';
  }

  return days
    .map((day) => DAY_OPTIONS.find((option) => option.value === day)?.labelShort || day)
    .join(', ');
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

function formatClockTime(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function buildAvailabilityTimeSlots({
  availabilityWindows,
  day,
  durationMinutes,
  stepMinutes = 15,
}) {
  const safeDuration = Number(durationMinutes) || 0;
  const safeStep = Number(stepMinutes) || 15;
  if (!hasConfiguredAvailability(availabilityWindows) || safeDuration <= 0 || safeStep <= 0) {
    return [];
  }

  const dayWindows = getAvailabilityWindowsForDay(availabilityWindows, day);
  const slots = [];
  const seen = new Set();

  for (const window of dayWindows) {
    const startMinutes = timeToMinutes(window.start);
    const endMinutes = timeToMinutes(window.end);
    if (startMinutes == null || endMinutes == null) continue;

    for (let cursor = startMinutes; cursor + safeDuration <= endMinutes; cursor += safeStep) {
      const value = formatClockTime(cursor);
      if (!seen.has(value)) {
        seen.add(value);
        slots.push(value);
      }
    }
  }

  return slots.sort((left, right) => (timeToMinutes(left) || 0) - (timeToMinutes(right) || 0));
}
