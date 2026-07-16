import { useOrg } from '@/org/OrgContext.jsx';

/**
 * Org-scoped replacement for the old hardcoded SESSION_RECORDS_ENABLED flag.
 * Reads organizations.permissions.session_reports_enabled (see permission_registry
 * seed in src/lib/setup-sql.js and initialize_org_permissions() for backfill).
 *
 * Two layers are involved:
 * - permission_registry.default_value ('session_reports_enabled') is the global default.
 * - organizations.permissions.session_reports_enabled is the effective per-org grant,
 *   which initialize_org_permissions() backfills into every org from the registry default
 *   whenever a new registry key appears, without overwriting an org's existing explicit value.
 */
export function useSessionReportsEnabled() {
  const { orgSettings } = useOrg();
  return isSessionReportsEnabledFromPermissions(orgSettings?.permissions);
}

/**
 * Plain (non-hook) permission check for callers that cannot use React hooks
 * (e.g. non-component modules). Callers must supply the permissions object
 * themselves (e.g. from useOrg().orgSettings.permissions or activeOrg.permissions).
 */
export function isSessionReportsEnabledFromPermissions(permissions) {
  return permissions?.session_reports_enabled === true;
}
