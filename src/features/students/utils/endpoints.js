const ADMIN_ROLES = new Set(['admin', 'owner']);

export function normalizeMembershipRole(role) {
  if (typeof role !== 'string') {
    return 'member';
  }
  return role.trim().toLowerCase();
}

export function isAdminRole(role) {
  return ADMIN_ROLES.has(normalizeMembershipRole(role));
}
