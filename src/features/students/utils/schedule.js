import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { DAY_NAMES as DAY_TOKEN_NAMES, normalizeDayToken } from '@/lib/day-of-week.js';

export const DAY_NAMES = DAY_TOKEN_NAMES;

/**
 * Normalize a day value into canonical token values (sunday..saturday).
 * Returns null when the value can't be normalized.
 */
export function normalizeDay(value) {
  return normalizeDayToken(value);
}

/** Return true if filterDay is empty or equals studentDay after normalization */
export function dayMatches(studentDay, filterDay) {
  const s = normalizeDay(studentDay);
  const f = normalizeDay(filterDay);
  if (!f) return true;
  return s === f;
}

/** Return true when the Hebrew day label for dayOfWeek includes the query substring */
export function includesDayQuery(dayOfWeek, query) {
  if (!query) return true;
  const label = DAY_NAMES[normalizeDay(dayOfWeek)] || '';
  return String(label).toLowerCase().includes(String(query).toLowerCase());
}

export function formatDefaultTime(value) {
  if (!value) {
    return '';
  }

  try {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return format(date, 'HH:mm', { locale: he });
    }
  } catch {
    // ignore parsing errors and fall back to string
  }

  if (typeof value === 'string') {
    return value.slice(0, 5);
  }

  return '';
}

export function describeSchedule(dayOfWeek, timeValue) {
  const dayLabel = DAY_NAMES[normalizeDay(dayOfWeek)] || 'יום לא מוגדר';
  const timeLabel = formatDefaultTime(timeValue);
  if (timeLabel) {
    return `${dayLabel} • ${timeLabel}`;
  }
  return dayLabel;
}
