// The "חופשה" settings dialog: one stepped flow over two dated settings, saved from one date.
// Step 1 is how many leave days a year gives (leave_entitlement_policy), step 2 what a leave day is
// paid (leave_pay_policy). Saving writes a version only of the keys that actually change.
// Keep it free of React and '@/...' path aliases so node:test can import it directly.
import {
  LEAVE_ENTITLEMENT_POLICY_KEY,
  buildEntitlementDraft,
  buildEntitlementPayload,
  describeEntitlementVersion,
  isEntitlementDraftChanged,
  validateEntitlementDraft,
} from './leave-entitlement-settings.js';
import {
  LEAVE_PAY_POLICY_KEY,
  buildLeavePayPolicyPayload,
  getEffectiveDefaultMethod,
  getLeavePayMethodLabel,
  isLeavePayDraftChanged,
  readLeavePayPolicy,
  validateLeavePayDraft,
} from './leave-pay-policy.js';

export const LEAVE_SETTING_LABELS = Object.freeze({
  [LEAVE_ENTITLEMENT_POLICY_KEY]: 'ימי חופשה',
  [LEAVE_PAY_POLICY_KEY]: 'תשלום',
});

/** One stored leave-pay version in a few words, for the history list. */
export function describeLeavePayVersion(version) {
  const policy = readLeavePayPolicy(version?.settings_value);
  return `${getLeavePayMethodLabel(getEffectiveDefaultMethod(policy))} · ${policy.lookback_months} חודשים`;
}

export { describeEntitlementVersion };

/**
 * Step 1's starting state. An organisation that never chose (no version in force today) starts with
 * nothing chosen, so step 2 waits for the choice; the table is prefilled either way.
 */
export function buildEntitlementStepDraft(storedValue, hasVersion) {
  const draft = buildEntitlementDraft(storedValue);
  return hasVersion ? draft : { ...draft, mode: '' };
}

/**
 * Whether step 1 will get a new version. With no version in force on the chosen date, any choice is
 * saved, so the choice is kept even when it matches what the system already did.
 */
export function isEntitlementStepChanged({ baseline, draft, hasVersionOnDate }) {
  if (!draft?.mode) return false;
  if (!hasVersionOnDate) return true;
  return isEntitlementDraftChanged(baseline, draft);
}

/** The first problem with the two steps, in Hebrew, or '' when they can be saved. */
export function validateLeaveSettingsDraft({ entitlementDraft, payDraft }) {
  if (!entitlementDraft?.mode) return 'יש לבחור כמה ימי חופשה מגיעים בשנה.';
  return validateEntitlementDraft(entitlementDraft) || validateLeavePayDraft(payDraft);
}

/**
 * The versions one save writes, all from the same date: [{ key, value }] for each key that changed
 * (step 1 first). An unchanged key gets no new version.
 */
export function buildLeaveSettingsVersions({ entitlement, pay }) {
  const versions = [];
  if (isEntitlementStepChanged(entitlement)) {
    versions.push({ key: LEAVE_ENTITLEMENT_POLICY_KEY, value: buildEntitlementPayload(entitlement.draft) });
  }
  if (pay?.draft && isLeavePayDraftChanged(pay.baseline, pay.draft)) {
    versions.push({ key: LEAVE_PAY_POLICY_KEY, value: buildLeavePayPolicyPayload(pay.baseline, pay.draft) });
  }
  return versions;
}
