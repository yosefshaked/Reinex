/**
 * Dates and time zones for the frontend: the same module the API uses, re-exported so the
 * browser and the server decide "which local day is this" identically. The implementation and
 * its rules live in api/_shared/local-time.js — read its header; do not copy it here.
 */
export * from '../../api/_shared/local-time.js';
