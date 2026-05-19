const ADMIN_ROLES = new Set(['admin', 'owner']);
const OFFICE_ROLES = new Set(['office']);

export function normalizeMembershipRole(role) {
  if (typeof role !== 'string') {
    return 'member';
  }
  return role.trim().toLowerCase();
}

export function isAdminRole(role) {
  return ADMIN_ROLES.has(normalizeMembershipRole(role));
}

export function isOfficeRole(role) {
  return OFFICE_ROLES.has(normalizeMembershipRole(role));
}

export function isAdminOrOffice(role) {
  const normalized = normalizeMembershipRole(role);
  return ADMIN_ROLES.has(normalized) || OFFICE_ROLES.has(normalized);
}
