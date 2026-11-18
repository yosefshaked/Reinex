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

/** The next version that has not started yet (effective date after `today`), or null. */
export function nextFutureVersion(versions, today) {
  let best = null;
  for (const version of Array.isArray(versions) ? versions : []) {
    if (!version?.effective_date || version.effective_date <= today) continue;
    if (!best || version.effective_date < best.effective_date) best = version;
  }
  return best;
}

/** "ישתנה ב-15.12.2026" for a setting that has a future version; '' when it has none. */
export function futureChangeNote(versions, today) {
  const next = nextFutureVersion(versions, today);
  return next ? `ישתנה ב-${formatDateKey(next.effective_date)}` : '';
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

/**
 * The warnings of a screen that saves several dated settings from one date (one "בתוקף מ-", one
 * save). `parts` is [{ key, label, versions, changed, pastDateWarning }]: only a part that will get a
 * new version (`changed`) warns, each with its own past-date wording; when there are several parts,
 * the warnings about another version name the part they belong to. Duplicates are dropped.
 */
export function buildDatedSettingsWarnings({ parts = [], effectiveDate, today }) {
  const list = (Array.isArray(parts) ? parts : []).filter(Boolean);
  const many = list.length > 1;
  const warnings = [];
  for (const part of list) {
    if (!part.changed) continue;
    const own = buildDatedSettingWarnings({
      versions: part.versions,
      effectiveDate,
      today,
      ...(part.pastDateWarning ? { pastDateWarning: part.pastDateWarning } : {}),
    });
    const pastWarning = part.pastDateWarning || PAST_DATE_WARNING;
    for (const warning of own) {
      const text = many && part.label && warning !== pastWarning ? `${part.label}: ${warning}` : warning;
      if (!warnings.includes(text)) warnings.push(text);
    }
  }
  return warnings;
}

/**
 * One history list for several dated settings, newest first: each row is { key, label, text,
 * version } where `text` is the part's `describeVersion(version)`. Rows of the same date keep the
 * order of `parts`.
 */
export function mergeVersionHistory(parts = []) {
  const rows = [];
  (Array.isArray(parts) ? parts : []).forEach((part, partIndex) => {
    for (const version of Array.isArray(part?.versions) ? part.versions : []) {
      if (!version?.effective_date) continue;
      rows.push({
        key: part.key || '',
        label: part.label || '',
        text: typeof part.describeVersion === 'function' ? part.describeVersion(version) : '',
        version,
        partIndex,
      });
    }
  });
  rows.sort((a, b) => {
    if (a.version.effective_date !== b.version.effective_date) return a.version.effective_date < b.version.effective_date ? 1 : -1;
    if (a.partIndex !== b.partIndex) return a.partIndex - b.partIndex;
    return String(b.version.created_at || '').localeCompare(String(a.version.created_at || ''));
  });
  return rows.map(({ key, label, text, version }) => ({ key, label, text, version }));
}
