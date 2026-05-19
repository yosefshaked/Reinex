export const DAY_OPTIONS = Object.freeze([
  { value: 'sunday', label: 'ראשון', fullLabel: 'יום ראשון', labelShort: 'א׳', jsDay: 0, order: 1 },
  { value: 'monday', label: 'שני', fullLabel: 'יום שני', labelShort: 'ב׳', jsDay: 1, order: 2 },
  { value: 'tuesday', label: 'שלישי', fullLabel: 'יום שלישי', labelShort: 'ג׳', jsDay: 2, order: 3 },
  { value: 'wednesday', label: 'רביעי', fullLabel: 'יום רביעי', labelShort: 'ד׳', jsDay: 3, order: 4 },
  { value: 'thursday', label: 'חמישי', fullLabel: 'יום חמישי', labelShort: 'ה׳', jsDay: 4, order: 5 },
  { value: 'friday', label: 'שישי', fullLabel: 'יום שישי', labelShort: 'ו׳', jsDay: 5, order: 6 },
  { value: 'saturday', label: 'שבת', fullLabel: 'יום שבת', labelShort: 'ש׳', jsDay: 6, order: 7 },
]);

export const DAY_NAMES = Object.freeze(
  Object.fromEntries(DAY_OPTIONS.map((option) => [option.value, option.fullLabel])),
);

const DAY_ALIASES = Object.freeze({
  sunday: ['sunday', 'sun', '0', '1', 'ראשון', 'יום ראשון'],
  monday: ['monday', 'mon', '2', 'שני', 'יום שני'],
  tuesday: ['tuesday', 'tue', '3', 'שלישי', 'יום שלישי'],
  wednesday: ['wednesday', 'wed', '4', 'רביעי', 'יום רביעי'],
  thursday: ['thursday', 'thu', '5', 'חמישי', 'יום חמישי'],
  friday: ['friday', 'fri', '6', 'שישי', 'יום שישי'],
  saturday: ['saturday', 'sat', '7', 'שבת', 'יום שבת'],
});

const DAY_INDEX = Object.freeze(
  Object.fromEntries(DAY_OPTIONS.map((option) => [option.value, option.jsDay])),
);

const INDEX_TO_TOKEN = Object.freeze(
  Object.fromEntries(DAY_OPTIONS.map((option) => [option.jsDay, option.value])),
);

export function normalizeDayToken(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= 0 && value <= 6) {
      return INDEX_TO_TOKEN[value] || null;
    }
    if (value >= 1 && value <= 7) {
      return INDEX_TO_TOKEN[value - 1] || null;
    }
    return null;
  }

  const text = String(value).trim().toLowerCase();
  if (!text) {
    return null;
  }

  if (DAY_INDEX[text] !== undefined) {
    return text;
  }

  const asInt = Number.parseInt(text, 10);
  if (Number.isInteger(asInt)) {
    if (asInt >= 0 && asInt <= 6) {
      return INDEX_TO_TOKEN[asInt] || null;
    }
    if (asInt >= 1 && asInt <= 7) {
      return INDEX_TO_TOKEN[asInt - 1] || null;
    }
  }

  for (const option of DAY_OPTIONS) {
    const aliases = DAY_ALIASES[option.value] || [];
    if (aliases.includes(text)) {
      return option.value;
    }
  }

  return null;
}

export function daySortValue(value) {
  const token = normalizeDayToken(value);
  if (!token) {
    return Number.POSITIVE_INFINITY;
  }
  const index = DAY_INDEX[token];
  return Number.isInteger(index) ? index + 1 : Number.POSITIVE_INFINITY;
}

export function dayLabel(value) {
  const token = normalizeDayToken(value);
  if (!token) {
    return '';
  }
  return DAY_NAMES[token] || '';
}

export function dayTokenForJsDay(dayIndex) {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return null;
  }
  return INDEX_TO_TOKEN[dayIndex] || null;
}
