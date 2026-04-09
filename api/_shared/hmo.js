// @ts-check
/* eslint-env node */
import { createHash, randomUUID } from 'node:crypto';
import { normalizeString } from './org-bff.js';
import { coerceAgorot, toShekel } from './currency.js';

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


function toDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

function toTimestampOrNull(value) {
  const dateKey = toDateKey(value);
  return dateKey ? `${dateKey}T00:00:00.000Z` : null;
}

function normalizePaymentMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  return HMO_PAYMENT_MODES.has(normalized) ? normalized : 'partially_paid_by_hmo';
}

function normalizeAuthorizationStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  return HMO_AUTHORIZATION_STATUSES.has(normalized) ? normalized : 'active';
}

/**
 * Generates a deterministic UUID from a seed string using MD5.
 * ⚠️  Do NOT switch to SHA-256 — existing rows in hmo_providers and
 *     hmo_tracks reference these IDs.  Changing the hash would create
 *     orphaned duplicates on the next legacy-data upsert.
 */
function buildDeterministicUuid(seed) {
  const hex = createHash('md5').update(String(seed || '')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function buildLegacyTrackName({ paymentMode, customerChargeAmount, insurerClaimAmount }) {
  const modeLabel = paymentMode === 'fully_paid_by_hmo'
    ? 'ממומן מלא'
    : paymentMode === 'fully_paid_by_customer'
      ? 'לקוח משלם'
      : 'מימון חלקי';
  return `מסלול שהוסב • ${modeLabel} • לקוח ${toShekel(customerChargeAmount)} • קופה ${toShekel(insurerClaimAmount)}`;
}

function buildLegacyTrackFingerprint({ providerId, serviceId, paymentMode, customerChargeAmount, insurerClaimAmount, workflowNotes }) {
  return [
    normalizeString(providerId),
    normalizeString(serviceId),
    normalizePaymentMode(paymentMode),
    coerceAgorot(customerChargeAmount),
    coerceAgorot(insurerClaimAmount),
    normalizeString(workflowNotes),
  ].join('|');
}

function normalizeTrackRow(row) {
  return {
    ...row,
    service_id: normalizeString(row?.service_id) || '',
    payment_mode: normalizePaymentMode(row?.payment_mode),
    default_customer_charge_amount: coerceAgorot(row?.default_customer_charge_amount),
    default_insurer_claim_amount: coerceAgorot(row?.default_insurer_claim_amount),
    default_workflow_notes: normalizeString(row?.default_workflow_notes) || '',
    is_active: row?.is_active !== false,
    metadata: isPlainObject(row?.metadata) ? row.metadata : {},
  };
}

async function selectHmoProviders(tenantClient, { ids = [], activeOnly = false } = {}) {
  const normalizedIds = Array.from(new Set((ids || []).map((id) => normalizeString(id)).filter(Boolean)));
  const selectVariants = [
    'id, name, is_active, metadata, created_at, updated_at',
    'id, name, is_active',
  ];

  let lastError = null;
  for (const selectClause of selectVariants) {
    let query = tenantClient
      .from('hmo_providers')
      .select(selectClause)
      .order('name', { ascending: true });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }
    if (normalizedIds.length > 0) {
      query = query.in('id', normalizedIds);
    }

    const { data, error } = await query;
    if (!error) {
      return (data || []).map((row) => ({
        ...row,
        is_active: row?.is_active !== false,
        metadata: isPlainObject(row?.metadata) ? row.metadata : {},
        created_at: row?.created_at || null,
        updated_at: row?.updated_at || null,
      }));
    }
    if (!['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code || '')) {
      throw error;
    }
    lastError = error;
  }

  if (lastError?.code === '42P01') {
    return [];
  }
  throw lastError;
}

async function selectHmoTracks(tenantClient, { providerIds = [], trackIds = [], activeOnly = false } = {}) {
  const normalizedProviderIds = Array.from(new Set((providerIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  const normalizedTrackIds = Array.from(new Set((trackIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  const selectVariants = [
    'id, provider_id, service_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_workflow_notes, is_active, metadata, created_at, updated_at',
    'id, provider_id, service_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_workflow_notes, is_active',
  ];

  let lastError = null;
  for (const selectClause of selectVariants) {
    let query = tenantClient
      .from('hmo_provider_tracks')
      .select(selectClause)
      .order('name', { ascending: true });

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
    if (!error) {
      return (data || []).map((row) => normalizeTrackRow(row));
    }
    if (!['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code || '')) {
      throw error;
    }
    lastError = error;
  }

  if (lastError?.code === '42P01') {
    return [];
  }
  throw lastError;
}

export function resolveAuthorizationFinancials(authorization = null) {
  const track = authorization?.provider_track || authorization?.hmo_provider_track || null;
  return {
    payment_mode: normalizePaymentMode(authorization?.payment_mode_override || track?.payment_mode),
    customer_charge_amount: coerceAgorot(
      authorization?.customer_charge_amount_override ?? track?.default_customer_charge_amount,
    ),
    insurer_claim_amount: coerceAgorot(
      authorization?.insurer_claim_amount_override ?? track?.default_insurer_claim_amount,
    ),
    workflow_notes: normalizeString(
      authorization?.workflow_notes_override ?? track?.default_workflow_notes ?? '',
    ),
  };
}

export async function loadHmoProviders(tenantClient, { activeOnly = false } = {}) {
  const providers = await selectHmoProviders(tenantClient, { activeOnly });
  const providerIds = providers.map((row) => row.id);
  const tracks = providerIds.length > 0
    ? await selectHmoTracks(tenantClient, { providerIds, activeOnly })
    : [];

  const inUseTrackIds = new Set();
  if (tracks.length > 0) {
    const trackIds = tracks.map((t) => t.id);
    const [authResult, commitmentResult] = await Promise.all([
      tenantClient.from('hmo_authorizations').select('provider_track_id').in('provider_track_id', trackIds),
      tenantClient.from('commitments').select('hmo_provider_track_id').in('hmo_provider_track_id', trackIds),
    ]);
    for (const row of (authResult.data || [])) {
      if (row.provider_track_id) inUseTrackIds.add(row.provider_track_id);
    }
    for (const row of (commitmentResult.data || [])) {
      if (row.hmo_provider_track_id) inUseTrackIds.add(row.hmo_provider_track_id);
    }
  }

  const tracksByProvider = new Map();
  for (const track of tracks) {
    if (!tracksByProvider.has(track.provider_id)) {
      tracksByProvider.set(track.provider_id, []);
    }
    tracksByProvider.get(track.provider_id).push({ ...track, in_use: inUseTrackIds.has(track.id) });
  }

  return (providers || []).map((provider) => ({
    ...provider,
    tracks: tracksByProvider.get(provider.id) || [],
  }));
}

export async function loadHmoProviderMap(tenantClient, providerIds = []) {
  const ids = Array.from(new Set((providerIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await selectHmoProviders(tenantClient, { ids });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadHmoTrackMap(tenantClient, trackIds = []) {
  const ids = Array.from(new Set((trackIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await selectHmoTracks(tenantClient, { trackIds: ids });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadHmoAuthorizations(tenantClient, {
  authorizationIds = [],
  studentId = '',
  serviceId = '',
  activeOnly = false,
} = {}) {
  let query = tenantClient
    .from('hmo_authorizations')
    .select('id, student_id, service_id, provider_id, provider_track_id, authorization_reference, authorized_lessons, valid_from, expires_at, reminder_date, customer_charge_amount_override, insurer_claim_amount_override, workflow_notes_override, status, notes, metadata, created_at, updated_at')
    .order('created_at', { ascending: false });

  const ids = Array.from(new Set((authorizationIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length > 0) {
    query = query.in('id', ids);
  }
  if (studentId) {
    query = query.eq('student_id', studentId);
  }
  if (serviceId) {
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
    const resolved = resolveAuthorizationFinancials({
      ...row,
      provider,
      provider_track: providerTrack,
    });
    return {
      ...row,
      authorized_lessons: Math.max(0, Math.round(Number(row.authorized_lessons) || 0)),
      status: normalizeAuthorizationStatus(row.status),
      customer_charge_amount_override: row.customer_charge_amount_override == null ? null : coerceAgorot(row.customer_charge_amount_override),
      insurer_claim_amount_override: row.insurer_claim_amount_override == null ? null : coerceAgorot(row.insurer_claim_amount_override),
      provider,
      provider_track: providerTrack,
      resolved_payment_mode: resolved.payment_mode,
      resolved_customer_charge_amount: resolved.customer_charge_amount,
      resolved_insurer_claim_amount: resolved.insurer_claim_amount,
      resolved_workflow_notes: resolved.workflow_notes,
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
  const targetDate = toDateKey(lessonDate);
  if (!normalizedStudentId || !normalizedServiceId) {
    return null;
  }

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

export async function ensureProviderFromLegacyName(tenantClient, providerName) {
  const normalizedName = normalizeString(providerName);
  if (!normalizedName) {
    return null;
  }

  const { data: existing, error: existingError } = await tenantClient
    .from('hmo_providers')
    .select('id, name, is_active, metadata, created_at, updated_at')
    .ilike('name', normalizedName)
    .limit(1)
    .maybeSingle();

  if (existingError && existingError.code !== '42P01') {
    throw existingError;
  }
  if (existing) {
    return {
      ...existing,
      is_active: existing.is_active !== false,
      metadata: isPlainObject(existing.metadata) ? existing.metadata : {},
    };
  }

  const payload = {
    id: buildDeterministicUuid(`legacy-hmo-provider:${normalizedName.toLowerCase()}`),
    name: normalizedName,
    is_active: true,
    metadata: { legacy_source: 'hmo_commitment_metadata' },
  };

  const { data, error } = await tenantClient
    .from('hmo_providers')
    .upsert(payload, { onConflict: 'id' })
    .select('id, name, is_active, metadata, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    ...data,
    is_active: data?.is_active !== false,
    metadata: isPlainObject(data?.metadata) ? data.metadata : {},
  };
}

export async function ensureTrackFromLegacyConfig(tenantClient, {
  providerId,
  serviceId,
  paymentMode,
  customerChargeAmount,
  insurerClaimAmount,
  workflowNotes = '',
} = {}) {
  const normalizedProviderId = normalizeString(providerId);
  if (!normalizedProviderId) {
    return null;
  }

  const normalizedPaymentMode = normalizePaymentMode(paymentMode);
  const resolvedCustomerCharge = coerceAgorot(customerChargeAmount);
  const resolvedInsurerClaim = coerceAgorot(insurerClaimAmount);
  const resolvedWorkflowNotes = normalizeString(workflowNotes);
  const fingerprint = buildLegacyTrackFingerprint({
    providerId: normalizedProviderId,
    serviceId,
    paymentMode: normalizedPaymentMode,
    customerChargeAmount: resolvedCustomerCharge,
    insurerClaimAmount: resolvedInsurerClaim,
    workflowNotes: resolvedWorkflowNotes,
  });
  const deterministicId = buildDeterministicUuid(`legacy-hmo-track:${fingerprint}`);
  const trackName = buildLegacyTrackName({
    paymentMode: normalizedPaymentMode,
    customerChargeAmount: resolvedCustomerCharge,
    insurerClaimAmount: resolvedInsurerClaim,
  });

  const payload = {
    id: deterministicId,
    provider_id: normalizedProviderId,
    service_id: normalizeString(serviceId) || null,
    name: trackName,
    payment_mode: normalizedPaymentMode,
    default_customer_charge_amount: resolvedCustomerCharge,
    default_insurer_claim_amount: resolvedInsurerClaim,
    default_workflow_notes: resolvedWorkflowNotes,
    is_active: true,
    metadata: {
      legacy_fingerprint: fingerprint,
      generated_from: 'legacy_hmo_commitment',
    },
  };

  const { data, error } = await tenantClient
    .from('hmo_provider_tracks')
    .upsert(payload, { onConflict: 'id' })
    .select('id, provider_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_workflow_notes, is_active, metadata, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeTrackRow(data);
}

function deriveLegacyAuthorizationStatus(commitment) {
  if (commitment?.is_active === false) {
    return 'cancelled';
  }
  const expiryDate = toDateKey(commitment?.expires_at);
  if (expiryDate && expiryDate < toDateKey(new Date())) {
    return 'expired';
  }
  return 'active';
}

export async function ensureAuthorizationFromLegacyCommitment(tenantClient, commitment) {
  if (!commitment || commitment.commitment_type !== 'hmo') {
    return null;
  }

  const metadata = isPlainObject(commitment?.metadata) ? commitment.metadata : {};
  const hmoMetadata = isPlainObject(metadata?.hmo) ? metadata.hmo : {};
  const provider = await ensureProviderFromLegacyName(tenantClient, hmoMetadata.provider_name || 'גורם מממן');
  if (!provider) {
    return null;
  }

  const track = await ensureTrackFromLegacyConfig(tenantClient, {
    providerId: provider.id,
    serviceId: commitment.service_id,
    paymentMode: hmoMetadata.payment_mode,
    customerChargeAmount: hmoMetadata.customer_charge_amount ?? commitment.default_charge_amount,
    insurerClaimAmount: hmoMetadata.insurer_claim_amount,
    workflowNotes: hmoMetadata.workflow_notes,
  });

  const authorizationId = normalizeString(commitment?.hmo_authorization_id) || commitment.id || randomUUID();
  const payload = {
    id: authorizationId,
    student_id: commitment.student_id,
    service_id: commitment.service_id,
    provider_id: provider.id,
    provider_track_id: track?.id || null,
    authorization_reference: normalizeString(hmoMetadata.authorization_reference) || null,
    authorized_lessons: Math.max(0, Math.round(Number(hmoMetadata.authorized_lessons) || 0)),
    valid_from: toDateKey(commitment.created_at) || null,
    expires_at: toDateKey(commitment.expires_at) || null,
    reminder_date: toDateKey(hmoMetadata.reminder_date) || null,
    customer_charge_amount_override: null,
    insurer_claim_amount_override: null,
    workflow_notes_override: null,
    status: deriveLegacyAuthorizationStatus(commitment),
    notes: normalizeString(commitment.notes) || null,
    metadata: {
      generated_from: 'legacy_hmo_commitment',
      legacy_commitment_id: commitment.id,
      suggestion_id: normalizeString(hmoMetadata.suggestion_id) || 'custom',
    },
  };

  // Override values are already in agorot (from DB). Pass null to preserve track defaults.
  const authorizationData = {
    id: authorizationId,
    student_id: payload.student_id,
    service_id: payload.service_id,
    provider_id: payload.provider_id,
    provider_track_id: payload.provider_track_id,
    authorized_lessons: payload.authorized_lessons,
    valid_from: payload.valid_from,
    expires_at: payload.expires_at,
    customer_charge_amount_override: coerceAgorot(payload.customer_charge_amount_override, null) ?? null,
    insurer_claim_amount_override:   coerceAgorot(payload.insurer_claim_amount_override, null) ?? null,
    workflow_notes_override: payload.workflow_notes_override,
    authorization_reference: payload.authorization_reference,
    status: payload.status,
  };

  // Atomically upsert the authorization and link the commitment in one Postgres transaction.
  const { error: rpcError } = await tenantClient.rpc(
    'ensure_hmo_authorization_and_link_commitment',
    {
      p_authorization_data: authorizationData,
      p_commitment_id:      commitment.id,
    },
  );

  if (rpcError) {
    throw rpcError;
  }

  const [authorization] = await loadHmoAuthorizations(tenantClient, {
    authorizationIds: [authorizationId],
  });

  return authorization || null;
}

export async function hydrateHmoCommitments(tenantClient, commitments = []) {
  const input = commitments || [];
  const hydrationTasks = input.map((commitment) => {
    if (commitment?.commitment_type === 'hmo' && !normalizeString(commitment?.hmo_authorization_id)) {
      return ensureAuthorizationFromLegacyCommitment(tenantClient, commitment)
        .then((authorization) => ({
          ...commitment,
          hmo_provider_id: authorization?.provider_id || commitment.hmo_provider_id || null,
          hmo_provider_track_id: authorization?.provider_track_id || commitment.hmo_provider_track_id || null,
          hmo_authorization_id: authorization?.id || commitment.hmo_authorization_id || null,
        }))
        .catch(() => commitment);
    }
    return Promise.resolve(commitment);
  });
  return Promise.all(hydrationTasks);
}

export async function attachHmoContextToCommitments(tenantClient, commitments = []) {
  const normalizedCommitments = await hydrateHmoCommitments(tenantClient, commitments);
  const providerIds = normalizedCommitments.map((row) => row?.hmo_provider_id);
  const trackIds = normalizedCommitments.map((row) => row?.hmo_provider_track_id);
  const authorizationIds = normalizedCommitments.map((row) => row?.hmo_authorization_id);
  const [providerMap, trackMap, authorizations] = await Promise.all([
    loadHmoProviderMap(tenantClient, providerIds),
    loadHmoTrackMap(tenantClient, trackIds),
    loadHmoAuthorizations(tenantClient, { authorizationIds }),
  ]);

  const authorizationMap = new Map(authorizations.map((row) => [row.id, row]));
  return normalizedCommitments.map((row) => {
    const authorization = row?.hmo_authorization_id ? authorizationMap.get(row.hmo_authorization_id) || null : null;
    const provider = row?.hmo_provider_id ? providerMap.get(row.hmo_provider_id) || null : authorization?.provider || null;
    const providerTrack = row?.hmo_provider_track_id ? trackMap.get(row.hmo_provider_track_id) || null : authorization?.provider_track || null;
    return {
      ...row,
      hmo_provider: provider,
      hmo_provider_track: providerTrack,
      hmo_authorization: authorization,
    };
  });
}

export async function ensureSystemManagedHmoCommitment(tenantClient, authorization, actorUserId = null) {
  const [resolvedAuthorization] = Array.isArray(authorization)
    ? authorization
    : await loadHmoAuthorizations(tenantClient, {
      authorizationIds: [authorization?.id || authorization],
    });

  if (!resolvedAuthorization) {
    return null;
  }

  const financials = resolveAuthorizationFinancials(resolvedAuthorization);
  const totalAmount = Math.max(0, Math.round(resolvedAuthorization.authorized_lessons || 0)) * coerceAgorot(financials.customer_charge_amount);
  const expiresAt = toTimestampOrNull(resolvedAuthorization.expires_at);
  const commitmentMetadata = {
    hmo: {
      source: 'authorization',
      provider_id: resolvedAuthorization.provider_id,
      provider_name: resolvedAuthorization.provider?.name || 'גורם מממן',
      track_id: resolvedAuthorization.provider_track_id,
      track_name: resolvedAuthorization.provider_track?.name || '',
      payment_mode: financials.payment_mode,
      customer_charge_amount: financials.customer_charge_amount,
      insurer_claim_amount: financials.insurer_claim_amount,
      authorization_reference: normalizeString(resolvedAuthorization.authorization_reference) || '',
      authorized_lessons: Math.max(0, Math.round(resolvedAuthorization.authorized_lessons || 0)),
      reminder_date: toDateKey(resolvedAuthorization.reminder_date) || '',
      workflow_notes: financials.workflow_notes,
      valid_from: toDateKey(resolvedAuthorization.valid_from) || '',
      expires_at: toDateKey(resolvedAuthorization.expires_at) || '',
      status: normalizeAuthorizationStatus(resolvedAuthorization.status),
      system_managed: true,
    },
  };

  const existingQuery = await tenantClient
    .from('commitments')
    .select('*')
    .eq('hmo_authorization_id', resolvedAuthorization.id)
    .maybeSingle();

  if (existingQuery.error && existingQuery.error.code !== '42P01') {
    throw existingQuery.error;
  }

  const payload = {
    student_id: resolvedAuthorization.student_id,
    service_id: resolvedAuthorization.service_id,
    commitment_type: 'hmo',
    total_amount: totalAmount,
    default_charge_amount: financials.customer_charge_amount,
    transfer_ref: null,
    notes: normalizeString(resolvedAuthorization.notes) || null,
    is_active: normalizeAuthorizationStatus(resolvedAuthorization.status) === 'active',
    updated_at: new Date().toISOString(),
    expires_at: expiresAt,
    metadata: commitmentMetadata,
    hmo_provider_id: resolvedAuthorization.provider_id,
    hmo_provider_track_id: resolvedAuthorization.provider_track_id,
    hmo_authorization_id: resolvedAuthorization.id,
  };

  if (existingQuery.data?.id) {
    const { data, error } = await tenantClient
      .from('commitments')
      .update(payload)
      .eq('id', existingQuery.data.id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data;
  }

  const { data, error } = await tenantClient
    .from('commitments')
    .insert({
      ...payload,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  void actorUserId;
  return data;
}
