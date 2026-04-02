export const CALENDAR_WEEK_START = 0; // Sunday

export function toLocalDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDateString(dateString) {
  if (typeof dateString !== 'string') return null;
  const trimmed = dateString.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== monthIndex
    || date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function coerceToLocalDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      12,
      0,
      0,
      0,
    );
  }
  if (typeof value === 'string') {
    const parsedLocalDate = parseLocalDateString(value);
    if (parsedLocalDate) return parsedLocalDate;
    const parsedDateTime = new Date(value);
    if (!Number.isNaN(parsedDateTime.getTime())) {
      return new Date(
        parsedDateTime.getFullYear(),
        parsedDateTime.getMonth(),
        parsedDateTime.getDate(),
        12,
        0,
        0,
        0,
      );
    }
  }
  return null;
}

export function addLocalDays(value, days) {
  const date = coerceToLocalDate(value);
  if (!date || !Number.isFinite(Number(days))) return null;
  date.setDate(date.getDate() + Number(days));
  return date;
}

export function getWeekStartDate(value, weekStartsOn = CALENDAR_WEEK_START) {
  const date = coerceToLocalDate(value);
  if (!date) return null;
  const normalizedWeekStart = Number.isInteger(weekStartsOn) ? ((weekStartsOn % 7) + 7) % 7 : CALENDAR_WEEK_START;
  const diff = (date.getDay() - normalizedWeekStart + 7) % 7;
  date.setDate(date.getDate() - diff);
  return date;
}

export function getWeekRangeDateStrings(value, weekStartsOn = CALENDAR_WEEK_START) {
  const start = getWeekStartDate(value, weekStartsOn);
  if (!start) {
    return { start: null, end: null };
  }
  const end = addLocalDays(start, 6);
  return {
    start: toLocalDateString(start),
    end: toLocalDateString(end),
  };
}

export function getTodayLocalDateString() {
  return toLocalDateString(new Date());
}
