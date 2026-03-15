const DAY_TOKENS = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

const DAY_ALIASES = Object.freeze({
  sunday: ['sunday', 'sun', '0', '1', 'ראשון', 'יום ראשון'],
  monday: ['monday', 'mon', '2', 'שני', 'יום שני'],
  tuesday: ['tuesday', 'tue', '3', 'שלישי', 'יום שלישי'],
  wednesday: ['wednesday', 'wed', '4', 'רביעי', 'יום רביעי'],
  thursday: ['thursday', 'thu', '5', 'חמישי', 'יום חמישי'],
  friday: ['friday', 'fri', '6', 'שישי', 'יום שישי'],
  saturday: ['saturday', 'sat', '7', 'שבת', 'יום שבת'],
});

const TOKEN_TO_INDEX = Object.freeze({
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
});

const INDEX_TO_TOKEN = Object.freeze({
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
});

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

  if (DAY_TOKENS.includes(text)) {
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

  for (const token of DAY_TOKENS) {
    const aliases = DAY_ALIASES[token] || [];
    if (aliases.includes(text)) {
      return token;
    }
  }

  return null;
}

export function daySortValue(value) {
  const token = normalizeDayToken(value);
  if (!token) {
    return Number.POSITIVE_INFINITY;
  }
  const index = TOKEN_TO_INDEX[token];
  return Number.isInteger(index) ? index + 1 : Number.POSITIVE_INFINITY;
}

export function dayTokenForJsDay(dayIndex) {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return null;
  }
  return INDEX_TO_TOKEN[dayIndex] || null;
}

export function dayTokenForDate(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return dayTokenForJsDay(date.getUTCDay());
}
