// A dated setting on a settings screen: the date a new version is in force from, the warnings before
// saving it, and how its history is labelled. The server resolves the value for a date with
// resolveSettingOnDate (api/_shared/dated-settings.js); this module mirrors that rule for display.
// Keep it free of React and '@/...' path aliases so node:test can import it directly.
import { formatDateKey } from '../../../lib/date-key-format.js';

/** The date a first version carried over from before dated settings starts on (as for rates). */
export const SINCE_THE_BEGINNING = '2000-01-01';

/** The version in force on `dateKey`: the latest one whose effective date is on or before it. */
export function versionInForce(versions, dateKey) {
  if (!dateKey) return null;
  let best = null;
  for (const version of Array.isArray(versions) ? versions : []) {
    if (!version?.effective_date || version.effective_date > dateKey) continue;
    if (!best || version.effective_date > best.effective_date) best = version;
  }
  return best;
}

/** "מאז ההתחלה" for the carried-over first version, otherwise "מ-15.09.2026". */
export function versionFromLabel(version) {
  if (!version?.effective_date) return '';
  return version.effective_date <= SINCE_THE_BEGINNING ? 'מאז ההתחלה' : `מ-${formatDateKey(version.effective_date)}`;
}

const PAST_DATE_WARNING = 'ההגדרה תחול על ימים שכבר עברו. השכר על מפגשים וימי חופשה שכבר היו מהתאריך הזה יחושב מחדש לפיה.';

/**
 * What the office should know before saving a version from `effectiveDate`, in the words the rate
 * screen uses for a rate (EmployeeRatesPanel.jsx): a date in the past changes pay already computed,
 * a date before the current version only lasts until it, and a date that has a version replaces it.
 * A setting whose past date reaches back differently passes its own words (`pastDateWarning`).
 */
export function buildDatedSettingWarnings({ versions = [], effectiveDate, today, pastDateWarning = PAST_DATE_WARNING }) {
  const warnings = [];
  if (!effectiveDate) return warnings;
  const list = Array.isArray(versions) ? versions : [];
  const current = versionInForce(list, today);
  const existingOnDate = list.find((version) => version.effective_date === effectiveDate) || null;
  if (effectiveDate < today) {
    warnings.push(pastDateWarning);
  }
  if (current && effectiveDate < current.effective_date) {
    warnings.push(`ההגדרה תיכנס לפני ההגדרה הנוכחית (${versionFromLabel(current)}) ותהיה בתוקף רק עד אליה.`);
  }
  if (existingOnDate) {
    warnings.push('כבר קיימת הגדרה מהתאריך הזה. השמירה תחליף אותה.');
  }
  return warnings;
}
