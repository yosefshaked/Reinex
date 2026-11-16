// The organisation's default leave-pay method (Settings key "leave_pay_policy"), for the settings block.
// The server reads it with normalizeLeavePayPolicy and checks writes with validateLeavePayPolicyInput
// (api/_shared/employee-finance.js); this module mirrors those rules for display and the edit form.
// Keep it free of React and '@/...' path aliases so node:test can import it directly.

export const LEAVE_PAY_POLICY_KEY = 'leave_pay_policy';

export const LEAVE_PAY_POLICY_DEFAULTS = Object.freeze({
  default_method: 'legal',
  lookback_months: 3,
  legal_allow_12m_if_better: true,
  fixed_rate_default: 0,
});

export const LOOKBACK_MONTHS_MIN = 1;
export const LOOKBACK_MONTHS_MAX = 12;

/** The methods an organisation default can use. The fixed value is set per employee only. */
export const LEAVE_PAY_DEFAULT_METHODS = Object.freeze([
  { value: 'legal', label: 'ממוצע מומלץ' },
  { value: 'avg_hourly_x_avg_day_hours', label: 'ממוצע היסטורי' },
]);

const KNOWN_METHODS = new Set(['legal', 'avg_hourly_x_avg_day_hours', 'fixed_rate']);

function parseValue(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/** The stored policy as the server reads it: unknown or missing values fall back to the defaults. */
export function readLeavePayPolicy(raw) {
  const parsed = parseValue(raw);
  const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : LEAVE_PAY_POLICY_DEFAULTS;
  const method = String(source.default_method ?? '').trim().toLowerCase();
  const months = Number(source.lookback_months);
  const fixed = Number(source.fixed_rate_default);
  return {
    default_method: KNOWN_METHODS.has(method) ? method : LEAVE_PAY_POLICY_DEFAULTS.default_method,
    lookback_months: Number.isFinite(months) && months > 0 ? Math.round(months) : LEAVE_PAY_POLICY_DEFAULTS.lookback_months,
    legal_allow_12m_if_better: Boolean(source.legal_allow_12m_if_better),
    fixed_rate_default: Number.isFinite(fixed) && fixed >= 0 ? fixed : 0,
  };
}

export function getLeavePayMethodLabel(method) {
  if (method === 'fixed_rate') return 'ערך קבוע ליום';
  return LEAVE_PAY_DEFAULT_METHODS.find((option) => option.value === method)?.label || 'ממוצע מומלץ';
}

function describePeriod(months) {
  return months === 1 ? 'בחודש האחרון' : `ב-${months} החודשים האחרונים`;
}

/**
 * The method the screen shows for a stored policy. "legal" with the 12-month comparison off
 * (old data) calculates exactly like the historic average, so it is shown as that.
 */
export function getEffectiveDefaultMethod(policy) {
  const current = readLeavePayPolicy(policy);
  if (current.default_method === 'legal' && !current.legal_allow_12m_if_better) return 'avg_hourly_x_avg_day_hours';
  return current.default_method;
}

/** What a leave day is worth under a method, in words, for the number of months given. */
export function describeLeavePayMethod(method, { lookbackMonths } = {}) {
  const months = Number(lookbackMonths) > 0 ? Math.round(Number(lookbackMonths)) : LEAVE_PAY_POLICY_DEFAULTS.lookback_months;
  const period = describePeriod(months);
  if (method === 'legal') {
    return `השכר היומי הממוצע בימים שעבד/ה ${period}, או ב-12 החודשים האחרונים אם שם הממוצע גבוה יותר.`;
  }
  if (method === 'avg_hourly_x_avg_day_hours') {
    return `השכר היומי הממוצע בימים שעבד/ה ${period} בלבד.`;
  }
  if (method === 'fixed_rate') {
    return 'סכום קבוע ליום חופשה. ברירת מחדל זו נקבעה בעבר ואינה זמינה כאן; בחירת שיטה אחרת תחליף אותה.';
  }
  return '';
}

/** The edit form's starting values. A stored "fixed_rate" default starts with no method chosen. */
export function buildLeavePayDraft(policy) {
  const current = readLeavePayPolicy(policy);
  const method = getEffectiveDefaultMethod(current);
  return {
    method: LEAVE_PAY_DEFAULT_METHODS.some((option) => option.value === method) ? method : '',
    lookbackMonths: String(current.lookback_months),
  };
}

/** The first problem in the draft, in Hebrew, or '' when it can be saved. */
export function validateLeavePayDraft(draft) {
  if (!LEAVE_PAY_DEFAULT_METHODS.some((option) => option.value === draft?.method)) {
    return 'יש לבחור שיטה.';
  }
  const raw = String(draft?.lookbackMonths ?? '').trim();
  const months = Number(raw);
  if (!raw || !Number.isInteger(months) || months < LOOKBACK_MONTHS_MIN || months > LOOKBACK_MONTHS_MAX) {
    return `מספר החודשים צריך להיות מספר שלם בין ${LOOKBACK_MONTHS_MIN} ל-${LOOKBACK_MONTHS_MAX}.`;
  }
  return '';
}

/**
 * The value to store: the stored policy with the draft's method and months. The 12-month
 * comparison is always saved on ("legal" is the legal average, the historic method ignores it).
 * Fields this block does not edit (fixed_rate_default) are kept as they are.
 */
export function buildLeavePayPolicyPayload(stored, draft) {
  const current = readLeavePayPolicy(stored);
  return {
    ...current,
    default_method: draft.method,
    lookback_months: Number(String(draft.lookbackMonths).trim()),
    legal_allow_12m_if_better: true,
  };
}

/** Whether saving the draft would change what the screen shows for the stored policy. */
export function isLeavePayDraftChanged(stored, draft) {
  const current = readLeavePayPolicy(stored);
  if (draft?.method !== getEffectiveDefaultMethod(current)) return true;
  return Number(String(draft?.lookbackMonths ?? '').trim()) !== current.lookback_months;
}
