/**
 * Clock changes (daylight saving) for lessons in the frontend: the same rules the API uses,
 * re-exported so the calendar and the server decide identically. The implementation lives in
 * api/_shared/clock-change-rules.js — read its header; do not copy it here.
 */
export * from '../../api/_shared/clock-change-rules.js';
