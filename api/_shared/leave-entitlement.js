// @ts-check
/**
 * Annual leave entitlement: how many leave days an employee is owed for one calendar year.
 *
 * Pure and isomorphic (no database, no React): the API computes with it and the frontend imports it
 * through the re-export src/lib/leave-entitlement.js. Nothing computed here is stored.
 *
 * Three sources, in this order:
 *   1. a manual yearly number on the employee (`Employees.annual_leave_days`; null = the org default);
 *   2. the organisation default `leave_entitlement_policy` (a dated setting, dated-settings.js):
 *      - mode "fixed": the organisation's own table, days per seniority year;
 *      - mode "legal": the Annual Leave Law, below.
 *
 * The law (Israel, Annual Leave Law 1951, amended from 01.01.2017), as summarised by Kol Zchut:
 *   https://www.kolzchut.org.il/he/חישוב_מספר_ימי_החופשה_השנתית
 *   5-day week: https://www.kolzchut.org.il/he/חישוב_מספר_ימי_החופשה_השנתית_לעובדים_במקומות_עבודה_שבהם_מונהג_שבוע_עבודה_בן_5_ימים
 *   6-day week: https://www.kolzchut.org.il/he/חישוב_מספר_ימי_החופשה_השנתית_לעובדים_במקומות_עבודה_שבהם_מונהג_שבוע_עבודה_בן_6_ימים
 * (tables fetched 2026-11-16; the 5-day table is the one for workplaces without the extension order).
 *   - Entitlement is per calendar year (1 January - 31 December). Seniority year = calendar year -
 *     year employment started + 1 (calendar years touched).
 *   - Gross days (weekly rest days included): years 1-5: 16, 6: 18, 7: 21, then one more a year up to
 *     28 from year 14.
 *   - Employed the whole year: 200 days worked or more -> full; fewer -> days / 200 x gross.
 *     Employed part of the year (started or left during it): 240 or more -> full; fewer -> days / 240 x gross.
 *     Paid sick days count as days worked (the system records no sick leave, so callers pass 0).
 *   - The days earned so far are the full year's working days x days counted / threshold, kept to 2
 *     decimals (the law rounds down; the owner chose to show them exactly, 2026-11-17).
 *   - Hourly / daily workers are covered only after 75 consecutive days of employment.
 *
 * Gross -> net (working days off): every 7 gross days are one week, i.e. 5 (or 6) working days;
 * the days left over are working days up to 5 (or 6), because a leave period starts on a working day
 * and its rest days fall at its end:
 *     net = W x floor(gross / 7) + min(gross mod 7, W)      (W = working days a week)
 * This reproduces both Kol Zchut tables year by year and every worked example on the pages
 * (17 -> 13, 16 -> 12, 8 -> 6, 7 -> 5 on a 5-day week; 7 -> 6, 9 -> 8, 28 -> 24 on a 6-day week).
 *
 * Decisions where the law leaves room (owner, 2026-11-16; see agents-docs/50):
 *   - A day with any counted lesson or any recorded work minutes is one full day worked.
 *   - The work week is the employee's own defined working days: exactly 6 -> the 6-day table,
 *     anything else (none defined included) -> the 5-day table.
 *   - The 75-day threshold is applied to every employee (the system does not know who is paid by the
 *     hour), counted as calendar days from the start date to today.
 *   - The system has no employment end date, so "part of the year" means "started during it".
 *   - The org setting version that applies to a calendar year is the one in force on 31 December of
 *     that year, or today for the current year (`entitlementPolicyDateForYear`): a version saved from
 *     any date of a year decides that whole year.
 *   - The current year is computed live from the days worked so far, so it grows during the year.
 */
import { diffDays, isDateKey, normalizeDateKey } from './local-time.js';

export const LEAVE_ENTITLEMENT_POLICY_KEY = 'leave_entitlement_policy';

export const ENTITLEMENT_MODES = Object.freeze(['legal', 'fixed']);

/** Gross leave days (weekly rest days included) by seniority year; the last entry is "and onwards". */
export const LEGAL_GROSS_DAYS_BY_YEAR = Object.freeze([16, 16, 16, 16, 16, 18, 21, 22, 23, 24, 25, 26, 27, 28]);

/** Working days off on a 5-day week (Kol Zchut, 5-day page, table without the extension order). */
export const LEGAL_NET_DAYS_5_DAY_WEEK = Object.freeze([12, 12, 12, 12, 12, 14, 15, 16, 17, 18, 19, 20, 20, 20]);

/** Working days off on a 6-day week (Kol Zchut, 6-day page). */
export const LEGAL_NET_DAYS_6_DAY_WEEK = Object.freeze([14, 14, 14, 14, 14, 16, 18, 19, 20, 21, 22, 23, 24, 24]);

/** The "כמות קבועה" table offered when the organisation first picks it: the 5-day net table. */
export const DEFAULT_FIXED_DAYS_BY_YEAR = Object.freeze([...LEGAL_NET_DAYS_5_DAY_WEEK]);

export const FULL_YEAR_THRESHOLD_DAYS = 200;
export const PART_YEAR_THRESHOLD_DAYS = 240;
export const MIN_EMPLOYMENT_DAYS = 75;

export const MAX_FIXED_TABLE_ROWS = 40;
export const MAX_DAYS_PER_YEAR = 365;

export const DEFAULT_LEAVE_ENTITLEMENT_POLICY = Object.freeze({
  mode: 'legal',
  fixed_days_by_year: DEFAULT_FIXED_DAYS_BY_YEAR,
});

function parseJsonValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** A table's value for a seniority year; years past the end take the last row ("and onwards"). */
export function tableValue(table, seniorityYear) {
  const list = Array.isArray(table) ? table : [];
  if (!list.length || !Number.isInteger(seniorityYear) || seniorityYear < 1) return null;
  return list[Math.min(seniorityYear, list.length) - 1];
}

/** 6 when exactly six working days are defined for the employee, otherwise 5. */
export function workWeekDays(workingDays) {
  const source = isPlainObject(workingDays) && Array.isArray(workingDays.days) ? workingDays.days : workingDays;
  const days = new Set((Array.isArray(source) ? source : [])
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  return days.size === 6 ? 6 : 5;
}

/** Seniority year of `year` for an employee who started on `startDate` (calendar years touched). */
export function seniorityYearIn(startDate, year) {
  const start = normalizeDateKey(startDate);
  if (!isDateKey(start) || !Number.isInteger(year)) return null;
  const seniority = year - Number(start.slice(0, 4)) + 1;
  return seniority >= 1 ? seniority : null;
}

/**
 * Working days off contained in `gross` consecutive leave days (see the header). A table
 * conversion: whole numbers of gross days give the whole numbers of the law's tables, and a part of
 * a day (the days earned so far in a year) converts proportionally, never rounded down here.
 */
export function grossToNet(gross, weekDays = 5) {
  const days = Math.max(0, Number(gross) || 0);
  const week = weekDays === 6 ? 6 : 5;
  const weeks = Math.floor(days / 7);
  return week * weeks + Math.min(days - 7 * weeks, week);
}

/** Full-year entitlement by law for a seniority year: { gross, net }. */
export function legalYearEntitlement(seniorityYear, weekDays = 5) {
  const gross = tableValue(LEGAL_GROSS_DAYS_BY_YEAR, seniorityYear);
  if (gross == null) return null;
  const net = tableValue(weekDays === 6 ? LEGAL_NET_DAYS_6_DAY_WEEK : LEGAL_NET_DAYS_5_DAY_WEEK, seniorityYear);
  return { gross, net };
}

function readFixedTable(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const table = raw.map((value) => Number(value));
  return table.every((value) => Number.isFinite(value) && value >= 0) ? table : null;
}

/** The stored setting as the calculation reads it; anything unreadable is the default (the law). */
export function normalizeLeaveEntitlementPolicy(raw) {
  const parsed = parseJsonValue(raw);
  const source = isPlainObject(parsed) ? parsed : {};
  const mode = ENTITLEMENT_MODES.includes(source.mode) ? source.mode : DEFAULT_LEAVE_ENTITLEMENT_POLICY.mode;
  return {
    mode,
    fixed_days_by_year: readFixedTable(source.fixed_days_by_year) || [...DEFAULT_FIXED_DAYS_BY_YEAR],
  };
}

/**
 * Checks a leave_entitlement_policy written through the settings API. Returns { value } or { error }.
 * "fixed" needs a table of 1-40 rows, each a whole or half number of days from 0 to 365.
 */
export function validateLeaveEntitlementPolicyInput(raw) {
  const parsed = parseJsonValue(raw);
  if (!isPlainObject(parsed)) return { error: 'invalid_leave_entitlement_policy' };
  if (!ENTITLEMENT_MODES.includes(parsed.mode)) return { error: 'invalid_leave_entitlement_mode' };
  let table = [...DEFAULT_FIXED_DAYS_BY_YEAR];
  if (parsed.fixed_days_by_year !== undefined || parsed.mode === 'fixed') {
    const rows = parsed.fixed_days_by_year;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_FIXED_TABLE_ROWS) {
      return { error: 'invalid_leave_entitlement_table' };
    }
    const values = rows.map((value) => (value === null || value === '' ? NaN : Number(value)));
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > MAX_DAYS_PER_YEAR || !Number.isInteger(value * 2))) {
      return { error: 'invalid_leave_entitlement_table' };
    }
    table = values;
  }
  return { value: { mode: parsed.mode, fixed_days_by_year: table } };
}

/**
 * The date whose org setting version decides a calendar year: 31 December of that year, or today
 * when the year has not ended (the current year, or a future one).
 */
export function entitlementPolicyDateForYear(year, today) {
  const yearEnd = `${year}-12-31`;
  const todayDate = normalizeDateKey(today);
  return isDateKey(todayDate) && todayDate < yearEnd ? todayDate : yearEnd;
}

/** The employee's manual yearly number, or null when the organisation default applies. */
export function manualLeaveDays(employee) {
  const raw = employee?.annual_leave_days;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

/**
 * A yearly number for an employee who started during the year: the share of the year from the start
 * date, by calendar days (how a manual quota was always pro-rated). Whole year otherwise.
 */
function prorateByCalendarDays(days, startDate, year) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (!isDateKey(startDate) || startDate <= yearStart || startDate > yearEnd) {
    return { days, prorated: false };
  }
  const yearLength = diffDays(yearStart, yearEnd) + 1;
  const remaining = diffDays(startDate, yearEnd) + 1;
  return { days: round((days * remaining) / yearLength), prorated: true };
}

/**
 * Does computing this year need the count of days worked? Only the law does, and only when it can be
 * computed at all: callers skip loading a year of lessons otherwise.
 */
export function needsDaysWorked({ employee, policy, year, today }) {
  if (manualLeaveDays(employee) != null) return false;
  if (normalizeLeaveEntitlementPolicy(policy).mode !== 'legal') return false;
  const preview = computeLeaveEntitlement({ employee, policy, year, today, daysWorked: 0 });
  return preview.status === 'ok';
}

/** The range of days whose work counts for `year`: 1 January (or the start date) to the as-of date. */
export function daysWorkedRange({ employee, year, today }) {
  const yearStart = `${year}-01-01`;
  const start = normalizeDateKey(employee?.start_date);
  const from = isDateKey(start) && start > yearStart ? start : yearStart;
  const to = entitlementPolicyDateForYear(year, today);
  return from <= to ? { startDate: from, endDate: to } : null;
}

/**
 * The entitlement for one employee and calendar year.
 *
 * @param {{
 *   employee: { start_date?: string | null, working_days?: any, annual_leave_days?: any } | null,
 *   policy?: any,
 *   year: number,
 *   today: string,
 *   daysWorked?: number,
 *   paidSickDays?: number,
 *   policyEffectiveDate?: string | null,
 * }} params
 */
export function computeLeaveEntitlement({ employee, policy = null, year, today, daysWorked = 0, paidSickDays = 0, policyEffectiveDate = null }) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const asOf = entitlementPolicyDateForYear(year, today);
  const startDate = normalizeDateKey(employee?.start_date);
  const hasStart = isDateKey(startDate);
  const weekDays = workWeekDays(employee?.working_days);
  const seniority = hasStart ? seniorityYearIn(startDate, year) : null;
  const manual = manualLeaveDays(employee);
  const normalizedPolicy = normalizeLeaveEntitlementPolicy(policy);
  const source = manual != null ? 'manual' : normalizedPolicy.mode;

  const base = {
    year,
    source,
    status: 'ok',
    reason: null,
    days: null,
    full_year_days: null,
    start_date: hasStart ? startDate : null,
    seniority_year: seniority,
    work_week_days: weekDays,
    in_progress: asOf < yearEnd,
    as_of: asOf,
    prorated: false,
    policy_effective_date: source === 'manual' ? null : (policyEffectiveDate || null),
  };

  if (hasStart && startDate > yearEnd) {
    return { ...base, status: 'not_employed', reason: 'started_after_year', days: 0 };
  }

  if (source === 'manual') {
    const share = prorateByCalendarDays(manual, startDate, year);
    return { ...base, full_year_days: manual, days: share.days, prorated: share.prorated };
  }

  if (!hasStart) {
    return { ...base, status: 'manual_needed', reason: 'no_start_date' };
  }

  if (source === 'fixed') {
    const full = tableValue(normalizedPolicy.fixed_days_by_year, seniority);
    const share = prorateByCalendarDays(full, startDate, year);
    return { ...base, full_year_days: full, days: share.days, prorated: share.prorated };
  }

  // The law.
  const todayDate = normalizeDateKey(today);
  const employedDays = isDateKey(todayDate) ? diffDays(startDate, todayDate) + 1 : 0;
  if (employedDays < MIN_EMPLOYMENT_DAYS) {
    return { ...base, status: 'manual_needed', reason: 'before_75_days', employed_days: Math.max(0, employedDays) };
  }

  const employedWholeYear = startDate <= yearStart;
  const worked = Math.max(0, Math.floor(Number(daysWorked) || 0));
  const sick = Math.max(0, Math.floor(Number(paidSickDays) || 0));
  const share = legalShareOfYear({ seniorityYear: /** @type {number} */ (seniority), weekDays, employedWholeYear, daysCounted: worked + sick });

  return {
    ...base,
    days: share.net,
    full_year_days: share.full_net,
    gross_full: share.gross_full,
    gross_earned: share.gross_earned,
    employed_whole_year: employedWholeYear,
    threshold_days: share.threshold_days,
    days_worked: worked,
    paid_sick_days: sick,
    reached_full: share.reached_full,
    days_to_next_leave_day: asOf < yearEnd && !share.reached_full
      ? daysToNextLeaveDay({ seniorityYear: /** @type {number} */ (seniority), weekDays, employedWholeYear, daysCounted: worked + sick })
      : null,
  };
}

/**
 * How many more counted work days it takes for the entitlement to reach the NEXT WHOLE NUMBER
 * (floor(current) + 1), or the full year when that comes first (200 / 240 days). It counts down as
 * days are worked: 0.36 of a 12-day year -> 1 needs 17 counted days, so 11 more. Found with the same calculation
 * that gives the days (legalShareOfYear), so the two always agree. Null once the year is full.
 *
 * @param {{ seniorityYear: number, weekDays: number, employedWholeYear: boolean, daysCounted: number }} params
 */
export function daysToNextLeaveDay({ seniorityYear, weekDays, employedWholeYear, daysCounted }) {
  const counted = Math.max(0, Math.floor(Number(daysCounted) || 0));
  const now = legalShareOfYear({ seniorityYear, weekDays, employedWholeYear, daysCounted: counted });
  if (now.reached_full) return null;
  const target = Math.floor(now.net + 1e-9) + 1;
  for (let more = 1; counted + more <= now.threshold_days; more += 1) {
    const next = legalShareOfYear({ seniorityYear, weekDays, employedWholeYear, daysCounted: counted + more });
    if (next.reached_full || next.net >= target - 1e-9) return more;
  }
  return null;
}

/**
 * The legal share of a year: full from 200 days worked (whole year) or 240 (part of the year);
 * below that the full year's working days x days counted / threshold (2 decimals, not rounded down).
 *
 * @param {{ seniorityYear: number, weekDays: number, employedWholeYear: boolean, daysCounted: number }} params
 */
export function legalShareOfYear({ seniorityYear, weekDays, employedWholeYear, daysCounted }) {
  const full = /** @type {{ gross: number, net: number }} */ (legalYearEntitlement(seniorityYear, weekDays));
  const threshold = employedWholeYear ? FULL_YEAR_THRESHOLD_DAYS : PART_YEAR_THRESHOLD_DAYS;
  const counted = Math.max(0, Math.floor(Number(daysCounted) || 0));
  const reachedFull = counted >= threshold;
  // The days earned are the share of the full year's working days (the figure "בשנה מלאה מגיעים"
  // says), not rounded down: 3 of 200 days of a 12-day year is 0.18. gross_earned is the same share
  // of the gross days, for information.
  const grossEarned = reachedFull ? full.gross : round((counted * full.gross) / threshold, 2);
  return {
    threshold_days: threshold,
    gross_full: full.gross,
    full_net: full.net,
    gross_earned: grossEarned,
    reached_full: reachedFull,
    net: reachedFull ? full.net : Math.min(full.net, round((counted * full.net) / threshold, 2)),
  };
}
