import { authenticatedFetch } from '@/lib/api-client.js';

function normalizeAccount(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  return {
    id: record.id || null,
    email: record.email || '',
    displayName: record.display_name || '',
    firstName: record.first_name || '',
    lastName: record.last_name || '',
    identityNumber: record.identity_number || '',
    phone: record.phone || '',
    locale: record.locale || 'he',
    setupCompletedAt: record.setup_completed_at || null,
    accountStatus: record.account_status || 'active',
    deactivatedAt: record.deactivated_at || null,
    canSelfDeactivate: Boolean(record.can_self_deactivate),
    canSelfReactivate: Boolean(record.can_self_reactivate),
    needsSetup: Boolean(record.needs_setup),
  };
}

export async function fetchMyAccount(options = {}) {
  const response = await authenticatedFetch('me', {
    method: 'GET',
    ...options,
  });
  return normalizeAccount(response?.account);
}

export async function updateMyAccount(payload, options = {}) {
  const response = await authenticatedFetch('me', {
    method: 'PATCH',
    body: payload,
    ...options,
  });
  return normalizeAccount(response?.account);
}

export async function deactivateMyAccount(payload, options = {}) {
  const response = await authenticatedFetch('me/deactivate', {
    method: 'POST',
    body: payload,
    ...options,
  });
  return normalizeAccount(response?.account);
}

export async function reactivateMyAccount(options = {}) {
  const response = await authenticatedFetch('me/reactivate', {
    method: 'POST',
    ...options,
  });
  return normalizeAccount(response?.account);
}
