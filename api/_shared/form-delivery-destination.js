import {
  UUID_PATTERN,
  normalizeString,
  withOrgScope,
} from './org-bff.js';

export function normalizeDeliveryPhone(value) {
  return String(value || '').replace(/[^\d]/g, '').trim();
}

export function normalizeDeliveryEmail(value) {
  return normalizeString(value).toLowerCase();
}

async function loadClientProfile(client, orgId, clientProfileId) {
  const { data, error } = await withOrgScope(client, 'client_profiles', orgId)
    .select('id, phone, email')
    .eq('id', clientProfileId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function loadPrimaryGuardian(client, orgId, clientProfileId) {
  const { data: guardianLink, error: guardianLinkError } = await withOrgScope(client, 'client_guardians', orgId)
    .select('guardian_id, is_primary, created_at')
    .eq('client_profile_id', clientProfileId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (guardianLinkError) throw guardianLinkError;
  if (!guardianLink?.guardian_id) return null;

  const { data: guardian, error: guardianError } = await withOrgScope(client, 'guardians', orgId)
    .select('id, phone, email')
    .eq('id', guardianLink.guardian_id)
    .maybeSingle();

  if (guardianError) throw guardianError;
  return guardian || null;
}

export async function resolveClientProfileDeliveryDestination(client, orgId, clientProfileId, deliveryMethod, options = {}) {
  if (!UUID_PATTERN.test(String(clientProfileId || ''))) {
    return { destination: '', clientProfile: null, guardian: null, source: '' };
  }

  const method = normalizeString(deliveryMethod).toLowerCase();
  if (method !== 'whatsapp' && method !== 'email') {
    return { destination: '', clientProfile: null, guardian: null, source: '' };
  }

  const preferredPhone = normalizeDeliveryPhone(options.preferredPhone);
  const preferredEmail = normalizeDeliveryEmail(options.preferredEmail);

  if (method === 'whatsapp' && preferredPhone) {
    return { destination: preferredPhone, clientProfile: options.clientProfile || null, guardian: null, source: 'request' };
  }
  if (method === 'email' && preferredEmail) {
    return { destination: preferredEmail, clientProfile: options.clientProfile || null, guardian: null, source: 'request' };
  }

  const clientProfile = options.clientProfile || await loadClientProfile(client, orgId, clientProfileId);
  const profileDestination = method === 'whatsapp'
    ? normalizeDeliveryPhone(clientProfile?.phone)
    : normalizeDeliveryEmail(clientProfile?.email);

  if (profileDestination) {
    return { destination: profileDestination, clientProfile, guardian: null, source: 'client_profile' };
  }

  const guardian = await loadPrimaryGuardian(client, orgId, clientProfileId);
  const guardianDestination = method === 'whatsapp'
    ? normalizeDeliveryPhone(guardian?.phone)
    : normalizeDeliveryEmail(guardian?.email);

  return {
    destination: guardianDestination,
    clientProfile,
    guardian,
    source: guardianDestination ? 'primary_guardian' : '',
  };
}
