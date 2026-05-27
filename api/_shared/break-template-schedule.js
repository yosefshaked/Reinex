/* eslint-env node */
/**
 * break-template-schedule.js
 *
 * Pure helpers for break-template generation scheduling.
 * Extracted to make the core predicates unit-testable without a DB.
 */

import { dayTokenForDate, normalizeDayToken } from './day-of-week.js';

/**
 * Returns true when a break template should produce a break instance on
 * the given calendar date.
 *
 * Rules (all must pass):
 *  1. The template's day_of_week matches the weekday of `date`.
 *  2. `date` is on or after valid_from (if set).
 *  3. `date` is on or before valid_until (if set).
 *
 * @param {{ day_of_week: string, valid_from?: string|null, valid_until?: string|null }} template
 * @param {string} date  ISO-8601 date string, e.g. "2026-06-01"
 * @returns {boolean}
 */
export function breakTemplateMatchesDate(template, date) {
  if (!template || !date) return false;
  const dayToken = dayTokenForDate(date);
  if (!dayToken) return false;
  if (normalizeDayToken(template.day_of_week) !== normalizeDayToken(dayToken)) return false;
  if (template.valid_from && date < template.valid_from) return false;
  if (template.valid_until && date > template.valid_until) return false;
  return true;
}

/**
 * Normalises a postgres `time` value ("HH:MM:SS" or "HH:MM") to the
 * "HH:MM" string expected by buildUtcIsoForTimezoneDateTime.
 *
 * @param {string|null|undefined} timeValue
 * @returns {string}  "HH:MM" or empty string on invalid input
 */
export function normalizeBreakTemplateTime(timeValue) {
  return String(timeValue || '').slice(0, 5);
}
