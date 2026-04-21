/* eslint-env node */
import { normalizeString } from './org-bff.js';

function trimToNull(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

export function splitDisplayName(displayName) {
  const normalized = normalizeString(displayName);
  if (!normalized) {
    return { firstName: null, lastName: null };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: null, lastName: null };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export function extractAuthDisplayName(authUser) {
  const metadata = authUser?.user_metadata ?? {};
  const candidates = [
    metadata.full_name,
    metadata.fullName,
    metadata.name,
    [metadata.first_name, metadata.last_name].filter(Boolean).join(' '),
    [metadata.given_name, metadata.family_name].filter(Boolean).join(' '),
    metadata.preferred_username,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

export function getAuthNameParts(authUser) {
  const metadata = authUser?.user_metadata ?? {};
  const directFirst = trimToNull(metadata.first_name ?? metadata.given_name);
  const directLast = trimToNull(metadata.last_name ?? metadata.family_name);
  if (directFirst || directLast) {
    return {
      firstName: directFirst,
      lastName: directLast,
    };
  }
  return splitDisplayName(extractAuthDisplayName(authUser));
}

export function buildAccountDisplayName({ profile = null, authUser = null, email = null } = {}) {
  const firstName = trimToNull(profile?.first_name);
  const lastName = trimToNull(profile?.last_name);
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (combined) {
    return combined;
  }

  const authDisplayName = extractAuthDisplayName(authUser);
  if (authDisplayName) {
    return authDisplayName;
  }

  const normalizedEmail = trimToNull(email ?? authUser?.email);
  return normalizedEmail || '';
}

export function isAccountSetupComplete(profile) {
  if (!profile || typeof profile !== 'object') {
    return false;
  }
  return Boolean(
    trimToNull(profile.first_name)
    && trimToNull(profile.last_name)
    && trimToNull(profile.identity_number)
    && trimToNull(profile.phone)
    && profile.setup_completed_at,
  );
}

export function buildAccountUserMetadata({
  firstName,
  lastName,
  phone,
  existingMetadata = null,
  setupCompleted = false,
}) {
  const metadata = existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)
    ? { ...existingMetadata }
    : {};

  const normalizedFirst = trimToNull(firstName);
  const normalizedLast = trimToNull(lastName);
  const normalizedPhone = trimToNull(phone);
  const fullName = [normalizedFirst, normalizedLast].filter(Boolean).join(' ').trim() || null;

  if (normalizedFirst) {
    metadata.first_name = normalizedFirst;
    metadata.given_name = normalizedFirst;
  } else {
    delete metadata.first_name;
    delete metadata.given_name;
  }

  if (normalizedLast) {
    metadata.last_name = normalizedLast;
    metadata.family_name = normalizedLast;
  } else {
    delete metadata.last_name;
    delete metadata.family_name;
  }

  if (fullName) {
    metadata.full_name = fullName;
    metadata.fullName = fullName;
  } else {
    delete metadata.full_name;
    delete metadata.fullName;
  }

  if (normalizedPhone) {
    metadata.phone = normalizedPhone;
  } else {
    delete metadata.phone;
  }

  metadata.profile_setup_completed = Boolean(setupCompleted);

  return metadata;
}

export async function ensureAccountProfileRow(supabase, authUser) {
  const userId = trimToNull(authUser?.id);
  if (!userId) {
    throw new Error('missing_auth_user_id');
  }

  const nameParts = getAuthNameParts(authUser);
  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .eq('id', userId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (!existing) {
    const { error } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        first_name: nameParts.firstName,
        last_name: nameParts.lastName,
        locale: 'he',
        updated_at: new Date().toISOString(),
      });

    if (error) {
      throw error;
    }
  } else if ((!existing.first_name && nameParts.firstName) || (!existing.last_name && nameParts.lastName)) {
    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: existing.first_name || nameParts.firstName,
        last_name: existing.last_name || nameParts.lastName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      throw error;
    }
  }

  const { data, error: loadError } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, identity_number, phone, locale, account_status, setup_completed_at, deactivated_at, is_system_admin, can_create_organizations, max_owned_organizations, metadata, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle();

  if (loadError) {
    throw loadError;
  }

  return data || null;
}
