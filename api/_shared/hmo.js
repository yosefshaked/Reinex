// @ts-check
/* eslint-env node */
import { normalizeString } from './org-bff.js';
import { coerceAgorot } from './currency.js';

export const HMO_PAYMENT_MODES = new Set([
  'fully_paid_by_hmo',
  'partially_paid_by_hmo',
  'fully_paid_by_customer',
]);

export const HMO_POST_COVERAGE_POLICIES = new Set([
  'service_default',
  'explicit_customer_charge',
  'manual_block',
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

function normalizePostCoveragePolicy(value, fallback = 'manual_block') {
  const normalized = normalizeString(value).toLowerCase();
  return HMO_POST_COVERAGE_POLICIES.has(normalized) ? normalized : fallback;
}

function toDateKey(value) {
  if (value == null) return '';
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
    default_post_coverage_policy: normalizePostCoveragePolicy(row?.default_post_coverage_policy, 'service_default'),
    default_post_coverage_customer_charge_amount: row?.default_post_coverage_customer_charge_amount == null
      ? null
      : coerceAgorot(row.default_post_coverage_customer_charge_amount),
    default_workflow_notes: normalizeString(row?.default_workflow_notes) || '',
    is_active: row?.is_active !== false,
    metadata: isPlainObject(row?.metadata) ? row.metadata : {},
  };
}

async function selectHmoProviders(tenantClient, { orgId = '', ids = [], activeOnly = false } = {}) {
  let query = tenantClient
    .from('hmo_providers')
    .select('id, name, is_active, metadata, created_at, updated_at')
    .order('name', { ascending: true });

  const normalizedOrgId = normalizeString(orgId);
  const normalizedIds = Array.from(new Set((ids || []).map((value) => normalizeString(value)).filter(Boolean)));
  if (normalizedOrgId) {
    query = query.eq('org_id', normalizedOrgId);
  }
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

async function selectHmoTracks(tenantClient, { orgId = '', providerIds = [], trackIds = [], activeOnly = false } = {}) {
  let query = tenantClient
    .from('hmo_provider_tracks')
    .select('id, provider_id, service_id, name, payment_mode, default_customer_charge_amount, default_insurer_claim_amount, default_post_coverage_policy, default_post_coverage_customer_charge_amount, default_workflow_notes, is_active, metadata, created_at, updated_at')
    .order('name', { ascending: true });

  const normalizedOrgId = normalizeString(orgId);
  const normalizedProviderIds = Array.from(new Set((providerIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  const normalizedTrackIds = Array.from(new Set((trackIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  if (normalizedOrgId) {
    query = query.eq('org_id', normalizedOrgId);
  }
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

export async function loadHmoProviderMap(tenantClient, providerIds = [], orgId = '') {
  const rows = await selectHmoProviders(tenantClient, { orgId, ids: providerIds });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadHmoTrackMap(tenantClient, trackIds = [], orgId = '') {
  const rows = await selectHmoTracks(tenantClient, { orgId, trackIds });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadHmoProviders(tenantClient, { orgId = '', activeOnly = false } = {}) {
  const providers = await selectHmoProviders(tenantClient, { orgId, activeOnly });
  const tracks = await selectHmoTracks(tenantClient, {
    orgId,
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
  orgId = '',
  authorizationIds = [],
  studentId = '',
  serviceId = '',
  activeOnly = false,
} = {}) {
  const normalizedOrgId = normalizeString(orgId);
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
      covered_customer_charge_amount,
      covered_insurer_claim_amount,
      post_coverage_policy,
      post_coverage_customer_charge_amount,
      status,
      notes,
      metadata,
      created_at,
      updated_at
    `)
    .order('created_at', { ascending: false });

  if (normalizedOrgId) {
    query = query.eq('org_id', normalizedOrgId);
  }

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

  const providerMap = await loadHmoProviderMap(tenantClient, authorizations.map((row) => row.provider_id), normalizedOrgId);
  const trackMap = await loadHmoTrackMap(tenantClient, authorizations.map((row) => row.provider_track_id), normalizedOrgId);

  return authorizations.map((row) => {
    const provider = providerMap.get(row.provider_id) || null;
    const providerTrack = trackMap.get(row.provider_track_id) || null;
    return {
      ...row,
      authorized_lessons: Math.max(0, Math.round(Number(row.authorized_lessons) || 0)),
      covered_customer_charge_amount: row?.covered_customer_charge_amount == null
        ? null
        : coerceAgorot(row.covered_customer_charge_amount),
      covered_insurer_claim_amount: row?.covered_insurer_claim_amount == null
        ? null
        : coerceAgorot(row.covered_insurer_claim_amount),
      post_coverage_policy: normalizePostCoveragePolicy(
        row?.post_coverage_policy,
        normalizePostCoveragePolicy(providerTrack?.default_post_coverage_policy, 'service_default'),
      ),
      post_coverage_customer_charge_amount: row?.post_coverage_customer_charge_amount == null
        ? null
        : coerceAgorot(row.post_coverage_customer_charge_amount),
      status: normalizeAuthorizationStatus(row.status),
      provider,
      provider_track: providerTrack,
      metadata: isPlainObject(row?.metadata) ? row.metadata : {},
    };
  });
}

export function isAuthorizationDateCovered(row, lessonDate = '') {
  const targetDate = toDateKey(lessonDate);
  if (!targetDate) {
    return true;
  }
  const validFrom = toDateKey(row?.valid_from);
  const expiresAt = toDateKey(row?.expires_at);
  if (validFrom && validFrom > targetDate) {
    return false;
  }
  if (expiresAt && expiresAt < targetDate) {
    return false;
  }
  return true;
}

async function countAuthorizationCoveredLessons(tenantClient, {
  orgId = '',
  authorizationId = '',
  excludedLessonParticipantId = '',
} = {}) {
  const normalizedOrgId = normalizeString(orgId);
  const normalizedAuthorizationId = normalizeString(authorizationId);
  if (!normalizedOrgId || !normalizedAuthorizationId) {
    return 0;
  }

  const { data, error } = await tenantClient
    .from('ledger_transactions')
    .select('id, lesson_participant_id, source_type, reverses_transaction_id')
    .eq('org_id', normalizedOrgId)
    .eq('hmo_authorization_id', normalizedAuthorizationId)
    .in('source_type', ['lesson_charge', 'reversal']);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const reversedIds = new Set(rows
    .filter((row) => normalizeString(row?.source_type) === 'reversal' && row?.reverses_transaction_id)
    .map((row) => row.reverses_transaction_id));

  const coveredLessonParticipantIds = new Set();
  for (const row of rows) {
    if (normalizeString(row?.source_type) !== 'lesson_charge') continue;
    if (reversedIds.has(row.id)) continue;
    const lessonParticipantId = normalizeString(row?.lesson_participant_id);
    if (!lessonParticipantId) continue;
    if (excludedLessonParticipantId && lessonParticipantId === excludedLessonParticipantId) continue;
    coveredLessonParticipantIds.add(lessonParticipantId);
  }

  return coveredLessonParticipantIds.size;
}

export async function resolveLessonCoverageDecision(tenantClient, {
  orgId = '',
  studentId = '',
  serviceId = '',
  lessonDate = '',
  lessonParticipantId = '',
  usageOffsetsByAuthorizationId = null,
} = {}) {
  const normalizedOrgId = normalizeString(orgId);
  const normalizedStudentId = normalizeString(studentId);
  const normalizedServiceId = normalizeString(serviceId);
  const normalizedLessonParticipantId = normalizeString(lessonParticipantId);
  if (!normalizedStudentId || !normalizedServiceId) {
    return {
      status: 'standard_uncovered',
      reason: 'missing_student_or_service',
      authorization_id: null,
      matched_authorization_count: 0,
      remaining_authorized_lessons: null,
      covered_customer_charge_amount: null,
      covered_insurer_claim_amount: null,
      post_coverage_policy: null,
      post_coverage_customer_charge_amount: null,
      authorization: null,
    };
  }

  const authorizations = await loadHmoAuthorizations(tenantClient, {
    orgId: normalizedOrgId,
    studentId: normalizedStudentId,
    serviceId: normalizedServiceId,
    activeOnly: false,
  });
  const matchingRows = authorizations.filter((row) => (
    normalizeString(row?.student_id) === normalizedStudentId
    && normalizeString(row?.service_id) === normalizedServiceId
  ));
  const activeRows = matchingRows.filter((row) => row.status === 'active');
  const activeInRangeRows = activeRows
    .filter((row) => isAuthorizationDateCovered(row, lessonDate))
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));

  if (activeInRangeRows.length === 0) {
    const reason = matchingRows.length === 0
      ? 'no_authorization_found'
      : (activeRows.length === 0 ? 'no_active_authorization' : 'no_active_authorization_for_date');
    return {
      status: 'standard_uncovered',
      reason,
      authorization_id: null,
      matched_authorization_count: 0,
      remaining_authorized_lessons: null,
      covered_customer_charge_amount: null,
      covered_insurer_claim_amount: null,
      post_coverage_policy: null,
      post_coverage_customer_charge_amount: null,
      authorization: null,
    };
  }

  if (activeInRangeRows.length > 1) {
    return {
      status: 'blocked',
      reason: 'authorization_conflict',
      authorization_id: null,
      matched_authorization_count: activeInRangeRows.length,
      remaining_authorized_lessons: null,
      covered_customer_charge_amount: null,
      covered_insurer_claim_amount: null,
      post_coverage_policy: null,
      post_coverage_customer_charge_amount: null,
      authorization: null,
    };
  }

  const authorization = activeInRangeRows[0];
  const hasCoveredPricing = authorization?.covered_customer_charge_amount != null
    && authorization?.covered_insurer_claim_amount != null;
  if (!hasCoveredPricing) {
    return {
      status: 'blocked',
      reason: 'missing_authorization_pricing',
      authorization_id: authorization.id,
      matched_authorization_count: 1,
      remaining_authorized_lessons: null,
      covered_customer_charge_amount: authorization?.covered_customer_charge_amount ?? null,
      covered_insurer_claim_amount: authorization?.covered_insurer_claim_amount ?? null,
      post_coverage_policy: authorization?.post_coverage_policy || null,
      post_coverage_customer_charge_amount: authorization?.post_coverage_customer_charge_amount ?? null,
      authorization,
    };
  }

  const coveredUsageCount = await countAuthorizationCoveredLessons(tenantClient, {
    orgId: normalizedOrgId,
    authorizationId: authorization.id,
    excludedLessonParticipantId: normalizedLessonParticipantId,
  });
  const usageOffset = usageOffsetsByAuthorizationId instanceof Map
    ? Number(usageOffsetsByAuthorizationId.get(authorization.id) || 0)
    : 0;
  const effectiveCoveredUsageCount = coveredUsageCount + Math.max(0, usageOffset);
  const remainingAuthorizedLessons = Math.max(
    0,
    Math.max(0, Number(authorization?.authorized_lessons || 0)) - effectiveCoveredUsageCount,
  );

  if (remainingAuthorizedLessons <= 0) {
    const postCoveragePolicy = normalizePostCoveragePolicy(authorization?.post_coverage_policy, '');
    const requiresExplicitPostCoverageAmount = postCoveragePolicy === 'explicit_customer_charge';
    const explicitPostCoverageAmount = authorization?.post_coverage_customer_charge_amount == null
      ? authorization?.provider_track?.default_post_coverage_customer_charge_amount ?? null
      : authorization.post_coverage_customer_charge_amount;
    if (!postCoveragePolicy || (requiresExplicitPostCoverageAmount && explicitPostCoverageAmount == null)) {
      return {
        status: 'blocked',
        reason: 'missing_post_coverage_policy',
        authorization_id: authorization.id,
        matched_authorization_count: 1,
        remaining_authorized_lessons: 0,
        covered_customer_charge_amount: authorization.covered_customer_charge_amount,
        covered_insurer_claim_amount: authorization.covered_insurer_claim_amount,
        post_coverage_policy: postCoveragePolicy || null,
        post_coverage_customer_charge_amount: explicitPostCoverageAmount,
        authorization,
      };
    }

    return {
      status: 'post_coverage',
      reason: 'authorization_exhausted',
      authorization_id: authorization.id,
      matched_authorization_count: 1,
      remaining_authorized_lessons: 0,
      covered_customer_charge_amount: authorization.covered_customer_charge_amount,
      covered_insurer_claim_amount: authorization.covered_insurer_claim_amount,
      post_coverage_policy: postCoveragePolicy,
      post_coverage_customer_charge_amount: explicitPostCoverageAmount,
      authorization,
    };
  }

  return {
    status: 'covered',
    reason: 'authorization_applies',
    authorization_id: authorization.id,
    matched_authorization_count: 1,
    remaining_authorized_lessons: remainingAuthorizedLessons,
    covered_customer_charge_amount: authorization.covered_customer_charge_amount,
    covered_insurer_claim_amount: authorization.covered_insurer_claim_amount,
    post_coverage_policy: authorization.post_coverage_policy || null,
    post_coverage_customer_charge_amount: authorization.post_coverage_customer_charge_amount,
    authorization,
  };
}

export async function resolveActiveAuthorizationForStudentService(tenantClient, options = {}) {
  const decision = await resolveLessonCoverageDecision(tenantClient, options);
  return decision?.status === 'covered' ? decision.authorization || null : null;
}
