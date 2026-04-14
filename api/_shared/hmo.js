// @ts-check
/* eslint-env node */
import { normalizeString } from './org-bff.js';
import { coerceAgorot } from './currency.js';

export const HMO_PAYMENT_MODES = new Set([
  'fully_paid_by_hmo',
  'partially_paid_by_hmo',
  'fully_paid_by_customer',
]);

export const HMO_AUTHORIZATION_STATUSES = new Set([
  'active',
  'cancelled',
  'completed',
  'expired',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAuthorizationStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  return HMO_AUTHORIZATION_STATUSES.has(normalized) ? normalized : 'active';
}

function toDateKey(value) {
  const normalized = normalizeString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeTrackRow(row) {
  return {
    ...row,
    service_id: normalizeString(row?.service_id) || '',
    payment_mode: normalizeString(row?.payment_mode) || 'partially_paid_by_hmo',
    default_customer_charge_amount: coerceAgorot(row?.default_customer_charge_amount),
    default_insurer_claim_amount: coerceAgorot(row?.default_insurer_claim_amount),
    default_workflow_notes: normalizeString(row?.default_workflow_notes) || '',
    is_active: row?.is_active !== false,
    metadata: isPlainObject(row?.metadata) ? row.metadata : {},
  };
}

async function selectHmoProviders(tenantClient, { ids = [], activeOnly = false } = {}) {
  let query = tenantClient
    .from('hmo_providers')
    .select('id, name, is_active, metadata, created_at, updated_at')
    .order('name', { ascending: true });

  const normalizedIds = Array.from(new Set((ids || []).map((value) => normalizeString(value)).filter(Boolean)));
  if (activeOnly) {
    query = query.eq('is_active', true);
  }
  if (normalizedIds.length > 0) {
    query = query.in('id', normalizedIds);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  return (data || []).map((row) => ({
    ...row,
    is_active: row?.is_active !== false,
    metadata: isPlainObject(row?.metadata) ? row.metadata : {},
  }));
}

async function selectHmoTracks(tenantClient, { providerIds = [], trackIds = [], activeOnly = false } = {}) {
  let query = tenantClient
    .from('hmo_provider_tracks')
    .select('id, provider_id, service_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_workflow_notes, is_active, metadata, created_at, updated_at')
    .order('name', { ascending: true });

  const normalizedProviderIds = Array.from(new Set((providerIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  const normalizedTrackIds = Array.from(new Set((trackIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  if (activeOnly) {
    query = query.eq('is_active', true);
  }
  if (normalizedProviderIds.length > 0) {
    query = query.in('provider_id', normalizedProviderIds);
  }
  if (normalizedTrackIds.length > 0) {
    query = query.in('id', normalizedTrackIds);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  return (data || []).map(normalizeTrackRow);
}

export async function loadHmoProviderMap(tenantClient, providerIds = []) {
  const rows = await selectHmoProviders(tenantClient, { ids: providerIds });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadHmoTrackMap(tenantClient, trackIds = []) {
  const rows = await selectHmoTracks(tenantClient, { trackIds });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadHmoProviders(tenantClient, { activeOnly = false } = {}) {
  const providers = await selectHmoProviders(tenantClient, { activeOnly });
  const tracks = await selectHmoTracks(tenantClient, {
    providerIds: providers.map((row) => row.id),
    activeOnly,
  });

  const tracksByProvider = new Map();
  for (const track of tracks) {
    if (!tracksByProvider.has(track.provider_id)) {
      tracksByProvider.set(track.provider_id, []);
    }
    tracksByProvider.get(track.provider_id).push(track);
  }

  return providers.map((provider) => ({
    ...provider,
    tracks: tracksByProvider.get(provider.id) || [],
  }));
}

export async function loadHmoAuthorizations(tenantClient, {
  authorizationIds = [],
  studentId = '',
  serviceId = '',
  activeOnly = false,
} = {}) {
  let query = tenantClient
    .from('hmo_authorizations')
    .select(`
      id,
      student_id,
      service_id,
      provider_id,
      provider_track_id,
      authorization_reference,
      authorized_lessons,
      valid_from,
      expires_at,
      reminder_date,
      contracted_rate_amount,
      status,
      notes,
      metadata,
      created_at,
      updated_at
    `)
    .order('created_at', { ascending: false });

  const ids = Array.from(new Set((authorizationIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  if (ids.length > 0) {
    query = query.in('id', ids);
  }
  if (normalizeString(studentId)) {
    query = query.eq('student_id', studentId);
  }
  if (normalizeString(serviceId)) {
    query = query.eq('service_id', serviceId);
  }
  if (activeOnly) {
    query = query.eq('status', 'active');
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  const authorizations = data || [];
  if (authorizations.length === 0) {
    return [];
  }

  const providerMap = await loadHmoProviderMap(tenantClient, authorizations.map((row) => row.provider_id));
  const trackMap = await loadHmoTrackMap(tenantClient, authorizations.map((row) => row.provider_track_id));

  return authorizations.map((row) => {
    const provider = providerMap.get(row.provider_id) || null;
    const providerTrack = trackMap.get(row.provider_track_id) || null;
    const contractedRateAmount = row?.contracted_rate_amount == null
      ? coerceAgorot(providerTrack?.default_insurer_claim_amount)
      : coerceAgorot(row.contracted_rate_amount);
    return {
      ...row,
      authorized_lessons: Math.max(0, Math.round(Number(row.authorized_lessons) || 0)),
      contracted_rate_amount: contractedRateAmount,
      status: normalizeAuthorizationStatus(row.status),
      provider,
      provider_track: providerTrack,
      metadata: isPlainObject(row?.metadata) ? row.metadata : {},
    };
  });
}

export async function resolveActiveAuthorizationForStudentService(tenantClient, {
  studentId,
  serviceId,
  lessonDate = '',
} = {}) {
  const normalizedStudentId = normalizeString(studentId);
  const normalizedServiceId = normalizeString(serviceId);
  if (!normalizedStudentId || !normalizedServiceId) {
    return null;
  }

  const targetDate = toDateKey(lessonDate);
  const authorizations = await loadHmoAuthorizations(tenantClient, {
    studentId: normalizedStudentId,
    serviceId: normalizedServiceId,
    activeOnly: true,
  });

  const matching = authorizations
    .filter((row) => {
      const validFrom = toDateKey(row.valid_from);
      const expiresAt = toDateKey(row.expires_at);
      if (targetDate && validFrom && validFrom > targetDate) {
        return false;
      }
      if (targetDate && expiresAt && expiresAt < targetDate) {
        return false;
      }
      return true;
    })
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));

  return matching[0] || null;
}
