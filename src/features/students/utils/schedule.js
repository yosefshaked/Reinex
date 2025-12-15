import { format } from 'date-fns';
import { he } from 'date-fns/locale';

export const DAY_NAMES = Object.freeze({
  1: 'יום ראשון',
  2: 'יום שני',
  3: 'יום שלישי',
  4: 'יום רביעי',
  5: 'יום חמישי',
  6: 'יום שישי',
  7: 'יום שבת',
});

// Aliases to normalize free-text inputs to numeric day values (1-7)
const HEBREW_DAY_ALIASES = Object.freeze({
  1: ['יום ראשון', 'ראשון'],
  2: ['יום שני', 'שני'],
  3: ['יום שלישי', 'שלישי'],
  4: ['יום רביעי', 'רביעי'],
  5: ['יום חמישי', 'חמישי'],
  6: ['יום שישי', 'שישי'],
  7: ['יום שבת', 'שבת'],
});

/**
 * Normalize a day value (number 1-7 or hebrew label) into a numeric 1-7.
 * Returns null when the value can't be normalized.
 */
export function normalizeDay(value) {
  if (value === null || typeof value === 'undefined') return null;
  // Numbers pass-through when in range
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n;
  // Strings: try parse int or match aliases
  const s = String(value).trim();
  const asInt = Number.parseInt(s, 10);
  if (Number.isInteger(asInt) && asInt >= 1 && asInt <= 7) return asInt;
  const lower = s.toLowerCase();
  for (const [num, aliases] of Object.entries(HEBREW_DAY_ALIASES)) {
    for (const alias of aliases) {
      if (lower === alias.toLowerCase()) return Number(num);
    }
  }
  // Loose contains: allow queries like 'יום שני' within longer strings
  for (const [num, aliases] of Object.entries(HEBREW_DAY_ALIASES)) {
    for (const alias of aliases) {
      if (lower.includes(alias.toLowerCase())) return Number(num);
    }
  }
  return null;
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
  const dayLabel = DAY_NAMES[dayOfWeek] || 'יום לא מוגדר';
  const timeLabel = formatDefaultTime(timeValue);
  if (timeLabel) {
    return `${dayLabel} • ${timeLabel}`;
  }
  return dayLabel;
}
