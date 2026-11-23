// Step 1 of the "חופשה" settings dialog: the organisation default leave entitlement
// (leave_entitlement_policy, a dated setting). Pure helpers so node:test can import them; the rules live in
// api/_shared/leave-entitlement.js (re-exported by src/lib/leave-entitlement.js).
import {
  DEFAULT_FIXED_DAYS_BY_YEAR,
  LEAVE_ENTITLEMENT_POLICY_KEY,
  MAX_FIXED_TABLE_ROWS,
  normalizeLeaveEntitlementPolicy,
  validateLeaveEntitlementPolicyInput,
} from '../../../lib/leave-entitlement.js';

export { LEAVE_ENTITLEMENT_POLICY_KEY, MAX_FIXED_TABLE_ROWS };

// "legal" is the stored mode; the screen calls it "מומלץ" and never names the law.
export const ENTITLEMENT_RECOMMENDED_LABEL = 'מומלץ: לפי ותק וימי עבודה';

export const ENTITLEMENT_DEFAULT_OPTIONS = [
  { value: 'fixed', label: 'כמות קבועה', description: 'אתם קובעים כמה ימי חופשה מגיעים בכל שנת ותק.' },
  { value: 'legal', label: ENTITLEMENT_RECOMMENDED_LABEL, description: 'המערכת מחשבת לבד לפי הוותק וימי העבודה של כל עובד.' },
];

export const ENTITLEMENT_DISCLAIMER = 'מומלץ לקבוע לכל עובד את ימי החופשה לפי חוזה ההעסקה שלו ובהתייעצות עם רואה החשבון, כדי לוודא עמידה מלאה בזכויות החוקיות.';

export const ENTITLEMENT_PAST_DATE_WARNING = 'ההגדרה תחול גם על שנים שכבר עברו: ימי החופשה של כל שנה נקבעים לפי ההגדרה שבתוקף ב-31 בדצמבר שלה (בשנה הנוכחית: היום).';

/** The form state of a stored value: the mode and the table as editable strings. */
export function buildEntitlementDraft(storedValue) {
  const policy = normalizeLeaveEntitlementPolicy(storedValue);
  return { mode: policy.mode, rows: policy.fixed_days_by_year.map((value) => String(value)) };
}

/** The value sent to the settings API. "legal" keeps the table so switching back keeps it. */
export function buildEntitlementPayload(draft) {
  const rows = (draft?.rows || []).map((value) => (String(value).trim() === '' ? NaN : Number(value)));
  return { mode: draft?.mode === 'fixed' ? 'fixed' : 'legal', fixed_days_by_year: rows };
}

/** A Hebrew problem with the draft, or '' when it can be saved. */
export function validateEntitlementDraft(draft) {
  if (!draft) return 'יש לבחור אפשרות.';
  if (draft.mode !== 'fixed') return '';
  const result = validateLeaveEntitlementPolicyInput(buildEntitlementPayload(draft));
  return result.error ? 'בכל שורה יש להזין מספר ימים בין 0 ל-365 (אפשר חצאים).' : '';
}

/** Whether the draft differs from the version in force on the chosen date. */
export function isEntitlementDraftChanged(baselineValue, draft) {
  const baseline = normalizeLeaveEntitlementPolicy(baselineValue);
  const next = buildEntitlementPayload(draft);
  if (baseline.mode !== next.mode) return true;
  if (next.mode !== 'fixed') return false;
  return JSON.stringify(baseline.fixed_days_by_year) !== JSON.stringify(next.fixed_days_by_year);
}

/** "שנה 1", ..., and the last row "שנה 14 ואילך". */
export function seniorityRowLabel(index, count) {
  return index === count - 1 && count > 1 ? `שנה ${index + 1} ואילך` : `שנה ${index + 1}`;
}

/** One stored version in a few words, for the history list. */
export function describeEntitlementVersion(version) {
  const policy = normalizeLeaveEntitlementPolicy(version?.settings_value);
  if (policy.mode !== 'fixed') return ENTITLEMENT_RECOMMENDED_LABEL;
  const table = policy.fixed_days_by_year;
  const min = Math.min(...table);
  const max = Math.max(...table);
  return min === max ? `כמות קבועה · ${min} ימים` : `כמות קבועה · ${min}–${max} ימים`;
}

export function defaultFixedRows() {
  return DEFAULT_FIXED_DAYS_BY_YEAR.map((value) => String(value));
}
