/**
 * Annual leave entitlement for the frontend: the same pure module the API computes with, re-exported
 * so the settings screen and the balance line use the very same tables and rules. The implementation
 * and its sources live in api/_shared/leave-entitlement.js — read its header; do not copy it here.
 */
export * from '../../api/_shared/leave-entitlement.js';
