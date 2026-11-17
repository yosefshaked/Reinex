// @ts-check
/* eslint-env node */
/**
 * Dated settings: organisation settings whose value must be read "as of a date", the way rates are.
 *
 * A setting that changes how money is computed (what pays an instructor, what a leave day is worth)
 * must not reach back into months that were computed under the old value. So such a setting is not
 * one value in "Settings"; it is a list of versions in "SettingsHistory", each in force from its
 * `effective_date` until the next version of the same key. The value in force for a lesson is the
 * latest version whose effective date is on or before the lesson's local date (`localDateKey` from
 * local-time.js), exactly like `resolveRateOnDate` in rate-history.js.
 *
 * One read path and one write path:
 * - read: `loadDatedSettingRows` once per request, then `resolveSettingOnDate` for each date
 *   (finance code reads through `loadFinancePolicies` in employee-finance.js, which does exactly that);
 * - write: `api/settings` only, through `saveDatedSettingVersions` (a version per key and date).
 * A dated key is never stored in "Settings": `loadSettingsMap` refuses it.
 *
 * Adding a dated key is one line in DATED_SETTING_KEYS plus a migration that moves its rows.
 */
import { normalizeString, withOrgScope } from './org-bff.js';
import { isDateKey, normalizeDateKey } from './local-time.js';

/**
 * The settings that are read as of a date. Each affects pay: what pays an instructor, what a leave
 * day is worth, and how many leave days an employee is owed (leave-entitlement.js).
 */
export const DATED_SETTING_KEYS = Object.freeze([
  'instructor_earnings_policy',
  'leave_pay_policy',
  'leave_entitlement_policy',
]);

const DATED_KEY_SET = new Set(DATED_SETTING_KEYS);

/**
 * The "since the beginning" date of a first version, the same date rates carried over from before
 * rate history start on (RateHistory backfill, `BACKFILL_DATE` in EmployeeRatesPanel.jsx).
 */
export const SINCE_THE_BEGINNING = '2000-01-01';

const VERSION_COLUMNS = 'id, key, effective_date, settings_value, notes, created_by, created_at';

export function isDatedSettingKey(key) {
  return DATED_KEY_SET.has(normalizeString(key));
}

/** A SettingsHistory row as the resolver reads it, or null when it is not a usable version. */
export function normalizeSettingVersion(row) {
  if (!row || typeof row !== 'object') return null;
  const key = normalizeString(row.key);
  const effectiveDate = normalizeDateKey(row.effective_date);
  if (!key || !isDateKey(effectiveDate)) return null;
  return {
    id: row.id || null,
    key,
    effective_date: effectiveDate,
    settings_value: row.settings_value ?? null,
    notes: row.notes ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at ?? null,
  };
}

/**
 * The version of `key` in force on `dateKey`: the latest one whose effective date is on or before
 * it, or null when the key has no version yet on that date (callers then use the default value).
 * Two versions on one date cannot exist (unique index); if they did, the later created wins.
 *
 * @param {any[]} rows
 * @param {string} key
 * @param {string} dateKey 'YYYY-MM-DD' in the org's zone
 */
export function resolveSettingOnDate(rows, key, dateKey) {
  const normalizedKey = normalizeString(key);
  const date = normalizeDateKey(dateKey);
  if (!normalizedKey || !isDateKey(date)) return null;
  let best = null;
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = normalizeSettingVersion(raw);
    if (!row || row.key !== normalizedKey || row.effective_date > date) continue;
    if (
      !best
      || row.effective_date > best.effective_date
      || (row.effective_date === best.effective_date && String(row.created_at || '') > String(best.created_at || ''))
    ) {
      best = row;
    }
  }
  return best;
}

/** Every version of `key`, newest effective date first: the history a settings screen shows. */
export function listSettingVersions(rows, key) {
  const normalizedKey = normalizeString(key);
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeSettingVersion)
    .filter((row) => row && row.key === normalizedKey)
    .sort((left, right) => right.effective_date.localeCompare(left.effective_date)
      || String(right.created_at || '').localeCompare(String(left.created_at || '')));
}

/**
 * Every version of the given dated keys for one organisation, read once per request.
 *
 * @param {any} client
 * @param {string} orgId
 * @param {readonly string[]} [keys]
 */
export async function loadDatedSettingRows(client, orgId, keys = DATED_SETTING_KEYS) {
  const normalizedOrgId = normalizeString(orgId);
  const wanted = Array.from(new Set((keys || []).map((key) => normalizeString(key)).filter(isDatedSettingKey)));
  if (!normalizedOrgId || wanted.length === 0) return [];
  const { data, error } = await withOrgScope(client, 'SettingsHistory', normalizedOrgId)
    .select(VERSION_COLUMNS)
    .in('key', wanted)
    .order('effective_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(normalizeSettingVersion).filter(Boolean);
}

/**
 * Checks the date of a version being written. Returns { value } (the date key) or { error }.
 * @param {unknown} effectiveDate
 */
export function validateSettingEffectiveDate(effectiveDate) {
  const date = normalizeString(effectiveDate);
  if (!date) return { error: 'missing_effective_date' };
  if (!isDateKey(date)) return { error: 'invalid_effective_date' };
  return { value: date };
}

/**
 * Writes versions of dated settings. A version on a date that already has one replaces it (the
 * unique index is org, key, date). Only `api/settings` calls this.
 *
 * @param {any} client
 * @param {string} orgId
 * @param {{ key: string, settings_value: any, effective_date: string, notes?: string | null }[]} versions
 * @param {string | null} userId
 */
export async function saveDatedSettingVersions(client, orgId, versions, userId) {
  const rows = (versions || []).map((version) => ({
    key: version.key,
    effective_date: version.effective_date,
    settings_value: version.settings_value ?? null,
    notes: normalizeString(version.notes) || null,
    created_by: userId || null,
    created_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return { error: null };
  const { error } = await withOrgScope(client, 'SettingsHistory', orgId)
    .upsert(rows, { onConflict: 'org_id,key,effective_date' });
  return { error: error || null };
}
