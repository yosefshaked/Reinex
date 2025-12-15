// Deprecated legacy selectors module.
// This file has been intentionally reduced to stubs. The legacy leave/payroll/WorkSessions
// logic has been retired in favor of SessionRecords-based flows.
// If you find yourself needing similar selectors, reintroduce them under a new module tied
// to SessionRecords, or implement them within the relevant feature slice.

function deprecated(name) {
  const err = new Error(
    `selectors.${name} is deprecated and has been removed. See AGENTS.md (Legacy: WorkSessions vs SessionRecords).`
  );
  // In production, avoid noisy stack traces; still fail fast if called.
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.process &&
    globalThis.process.env &&
    globalThis.process.env.NODE_ENV === 'production'
  ) {
    err.stack = undefined;
  }
  throw err;
}

export function selectHourlyHours() { return deprecated('selectHourlyHours'); }
export function selectMeetingHours() { return deprecated('selectMeetingHours'); }
export function selectGlobalHours() { return deprecated('selectGlobalHours'); }
export function selectTotalHours() { return deprecated('selectTotalHours'); }
export function selectHolidayForDate() { return deprecated('selectHolidayForDate'); }
export function selectLeaveRemaining() { return deprecated('selectLeaveRemaining'); }
export function selectLeaveDayValue() { return deprecated('selectLeaveDayValue'); }

export const __DEPRECATED_SELECTORS__ = true;
