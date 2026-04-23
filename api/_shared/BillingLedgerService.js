// @ts-check
/* eslint-env node */
import { loadFinancePolicies } from './employee-finance.js';
import { coerceAgorot } from './currency.js';
import { normalizeString } from './org-bff.js';
import { loadHmoAuthorizations, resolveLessonCoverageDecision } from './hmo.js';
import { resolveDashboardTask } from './dashboard-tasks.js';

const RESOLVED_PARTICIPANT_STATUSES = new Set(['attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);
const STUDENT_ACCOUNT_TYPE = 'student';
const CLIENT_ACCOUNT_TYPE = 'client_profile';
const HMO_ACCOUNT_TYPE = 'hmo_provider';
const ACCOUNT_COLUMN_BY_TYPE = {
  student: 'student_id',
  client_profile: 'client_profile_id',
  hmo_provider: 'hmo_provider_id',
};
const MANUAL_CREDIT_SOURCE_TYPES = new Set(['manual_payment', 'hmo_invoice_payment', 'opening_balance', 'migration']);
const MANUAL_DEBIT_SOURCE_TYPES = new Set(['manual_adjustment', 'opening_balance', 'migration']);
const REVERSIBLE_SOURCE_TYPES = new Set(['lesson_charge', 'manual_payment', 'manual_adjustment', 'hmo_invoice_payment', 'opening_balance', 'migration']);
const ACTIVE_HMO_BATCH_STATUSES = new Set(['draft', 'issued', 'submitted', 'acknowledged', 'partially_paid', 'paid', 'disputed', 'closed']);
const SUBMITTED_HMO_BATCH_STATUSES = new Set(['issued', 'submitted', 'acknowledged', 'partially_paid', 'paid', 'disputed', 'closed']);
const MANUAL_CREDIT_USAGE_TYPE_BY_SOURCE = {
  manual_payment: 'manual_topup',
  hmo_invoice_payment: 'transfer_received',
  opening_balance: 'manual_topup',
  migration: 'manual_topup',
};
const MANUAL_DEBIT_USAGE_TYPE_BY_SOURCE = {
  manual_adjustment: 'manual_adjustment',
  opening_balance: 'manual_adjustment',
  migration: 'manual_adjustment',
};

function resolveLegacyUsageType(direction, sourceType) {
  const normalizedDirection = normalizeDirection(direction);
  const normalizedSourceType = normalizeString(sourceType).toLowerCase();

  if (normalizedSourceType === 'lesson_charge') {
    return 'standard';
  }
  if (normalizedSourceType === 'reversal') {
    return normalizedDirection === 'CREDIT' ? 'manual_topup' : 'refund';
  }
  if (normalizedDirection === 'CREDIT') {
    return MANUAL_CREDIT_USAGE_TYPE_BY_SOURCE[normalizedSourceType] || 'manual_topup';
  }
  return MANUAL_DEBIT_USAGE_TYPE_BY_SOURCE[normalizedSourceType] || 'manual_adjustment';
}

function buildLegacyLedgerCompatFields({
  orgId,
  direction,
  sourceType,
}) {
  const normalizedOrgId = normalizeString(orgId);
  const normalizedDirection = normalizeDirection(direction);
  if (!normalizedOrgId || !normalizedDirection) {
    throw new Error('invalid_legacy_ledger_compat_fields');
  }

  return {
    org_id: normalizedOrgId,
    transaction_type: normalizedDirection,
    usage_type: resolveLegacyUsageType(normalizedDirection, sourceType),
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAccountType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return ACCOUNT_COLUMN_BY_TYPE[normalized] ? normalized : '';
}

function normalizeDirection(value) {
  const normalized = normalizeString(value).toUpperCase();
  return normalized === 'DEBIT' || normalized === 'CREDIT' ? normalized : '';
}

function normalizeReasonCode(value, fallback = 'manual_rebuild') {
  return normalizeString(value).toLowerCase() || fallback;
}

function toIsoOrNow(value, clock) {
  const candidate = normalizeString(value);
  if (candidate) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return clock();
}

/**
 * Filter ledger entries down to only "effective" entries — i.e. those that are
 * neither a reversal entry nor an entry that has been reversed.
 *
 * Why: summary totals (payment_total, manual_adjustment_total, receivable_total)
 * should reflect net activity only.  A reversal pair (original + its reversal)
 * nets to zero and must not inflate either direction's total.
 *
 * @param {Array<{id: string, reverses_transaction_id?: string|null}>} entries
 * @returns {Array}
 */
function effectiveLedgerEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  // IDs of entries that were subsequently reversed by another entry.
  const reversedIds = new Set(
    list
      .filter((e) => e.reverses_transaction_id)
      .map((e) => e.reverses_transaction_id),
  );
  // Keep only entries that are neither the reversal itself nor the reversed original.
  return list.filter((e) => !e.reverses_transaction_id && !reversedIds.has(e.id));
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

function dateKeyToUtcBoundary(value, boundary) {
  const normalized = toDateKey(value);
  if (!normalized) return '';
  return boundary === 'end'
    ? `${normalized}T23:59:59.999Z`
    : `${normalized}T00:00:00.000Z`;
}

function signedAmount(direction, amount) {
  return normalizeDirection(direction) === 'CREDIT'
    ? coerceAgorot(amount)
    : -coerceAgorot(amount);
}

function groupBy(rows, keyResolver) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = keyResolver(row);
    if (!key) continue;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }
  return grouped;
}

function buildLedgerEntrySignature(row) {
  return JSON.stringify({
    ledger_account_id: row.ledger_account_id || null,
    direction: normalizeDirection(row.direction),
    amount: coerceAgorot(row.amount),
    student_id: row.student_id || null,
    client_profile_id: row.client_profile_id || null,
    hmo_provider_id: row.hmo_provider_id || null,
    hmo_authorization_id: row.hmo_authorization_id || null,
    service_id: row.service_id || null,
    rate_source: normalizeString(row.rate_source) || null,
  });
}

function resolveBillingRequirement(participantStatus, policies) {
  if (!RESOLVED_PARTICIPANT_STATUSES.has(participantStatus)) {
    return { billable: false, reason: 'participant_not_resolved' };
  }
  if (!policies?.billingConsumptionPolicy?.[participantStatus]) {
    return {
      billable: false,
      reason: participantStatus === 'cancelled_clinic' ? 'lesson_cancelled_by_clinic' : 'policy_excluded_status',
    };
  }
  return { billable: true, reason: 'chargeable' };
}

async function loadStudentProfileMap(tenantClient, orgId, studentIds = []) {
  const ids = Array.from(new Set((studentIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  const normalizedOrgId = normalizeString(orgId);
  if (ids.length === 0 || !normalizedOrgId) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('students')
    .select(`
      id,
      client_profile_id,
      client_profile:client_profiles(
        id,
        first_name,
        middle_name,
        last_name
      )
    `)
    .eq('org_id', normalizedOrgId)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return new Map((data || []).map((row) => {
    const profile = row?.client_profile || null;
    const fullName = [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ').trim();
    return [row.id, {
      ...row,
      full_name: fullName || 'תלמיד',
    }];
  }));
}

async function loadClientProfileMap(tenantClient, orgId, clientProfileIds = []) {
  const ids = Array.from(new Set((clientProfileIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  const normalizedOrgId = normalizeString(orgId);
  if (ids.length === 0 || !normalizedOrgId) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('client_profiles')
    .select('id')
    .eq('org_id', normalizedOrgId)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return new Map((data || []).map((row) => [row.id, row]));
}

async function loadServiceMap(tenantClient, orgId, serviceIds = []) {
  const ids = Array.from(new Set((serviceIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  const normalizedOrgId = normalizeString(orgId);
  if (ids.length === 0 || !normalizedOrgId) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('Services')
    .select('id, name, color, default_customer_charge_amount, is_active')
    .eq('org_id', normalizedOrgId)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return new Map((data || []).map((row) => [row.id, {
    ...row,
    service_name: normalizeString(row?.name) || 'שירות',
    default_customer_charge_amount: row?.default_customer_charge_amount == null
      ? null
      : coerceAgorot(row.default_customer_charge_amount),
  }]));
}

async function loadParticipantContext(tenantClient, lessonParticipantId) {
  const { data, error } = await tenantClient
    .from('lesson_participants')
    .select(`
      id,
      lesson_instance_id,
      client_profile_id,
      student_id,
      participant_status,
      metadata,
      client_profile:client_profiles(
        id,
        first_name,
        middle_name,
        last_name
      ),
      lesson_instance:lesson_instances(
        id,
        datetime_start,
        service_id,
        status,
        is_closed,
        metadata
      )
    `)
    .eq('id', lessonParticipantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function loadInstanceParticipants(tenantClient, lessonInstanceId) {
  const { data, error } = await tenantClient
    .from('lesson_participants')
    .select('id')
    .eq('lesson_instance_id', lessonInstanceId)
    .order('id', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function loadOpenLessonCharges(tenantClient, lessonParticipantId) {
  const { data, error } = await tenantClient
    .from('ledger_transactions')
    .select(`
      id,
      ledger_account_id,
      direction,
      amount,
      source_type,
      lesson_participant_id,
      student_id,
      client_profile_id,
      hmo_provider_id,
      hmo_authorization_id,
      service_id,
      rate_source,
      reverses_transaction_id,
      metadata
    `)
    .eq('lesson_participant_id', lessonParticipantId)
    .in('source_type', ['lesson_charge', 'reversal'])
    .order('posted_at', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = data || [];
  const reversedIds = new Set(rows
    .filter((row) => normalizeString(row?.source_type) === 'reversal' && row?.reverses_transaction_id)
    .map((row) => row.reverses_transaction_id));

  return rows.filter((row) => (
    normalizeString(row?.source_type) === 'lesson_charge'
    && !reversedIds.has(row.id)
  ));
}

async function resolveLedgerAccount(tenantClient, orgId, accountType, accountRefId) {
  const normalizedOrgId = normalizeString(orgId);
  const normalizedType = normalizeAccountType(accountType);
  const normalizedRefId = normalizeString(accountRefId);
  if (!normalizedOrgId || !normalizedType || !normalizedRefId) {
    throw new Error('invalid_ledger_account_target');
  }

  let clientProfileId = null;
  let studentId = null;
  let hmoProviderId = null;

  if (normalizedType === STUDENT_ACCOUNT_TYPE) {
    const studentMap = await loadStudentProfileMap(tenantClient, normalizedOrgId, [normalizedRefId]);
    const student = studentMap.get(normalizedRefId) || null;
    if (!student?.client_profile_id) {
      throw new Error('ledger_account_target_not_found');
    }
    clientProfileId = normalizeString(student.client_profile_id);
    studentId = normalizedRefId;
  } else if (normalizedType === CLIENT_ACCOUNT_TYPE) {
    const clientProfileMap = await loadClientProfileMap(tenantClient, normalizedOrgId, [normalizedRefId]);
    if (!clientProfileMap.has(normalizedRefId)) {
      throw new Error('ledger_account_target_not_found');
    }
    clientProfileId = normalizedRefId;
  } else if (normalizedType === HMO_ACCOUNT_TYPE) {
    const { data: provider, error: providerError } = await tenantClient
      .from('hmo_providers')
      .select('id')
      .eq('org_id', normalizedOrgId)
      .eq('id', normalizedRefId)
      .maybeSingle();
    if (providerError) {
      throw providerError;
    }
    if (!provider?.id) {
      throw new Error('ledger_account_target_not_found');
    }
    hmoProviderId = normalizedRefId;
  }

  let accountQuery = tenantClient
    .from('ledger_accounts')
    .select('id, org_id, account_type, client_profile_id, student_id, hmo_provider_id, service_id, metadata')
    .eq('org_id', normalizedOrgId)
    .eq('account_type', normalizedType);

  if (normalizedType === STUDENT_ACCOUNT_TYPE) {
    accountQuery = accountQuery.eq('student_id', studentId);
  } else if (normalizedType === CLIENT_ACCOUNT_TYPE) {
    accountQuery = accountQuery.eq('client_profile_id', clientProfileId).is('student_id', null);
  } else if (normalizedType === HMO_ACCOUNT_TYPE) {
    accountQuery = accountQuery.eq('hmo_provider_id', hmoProviderId);
  }

  const { data: existingAccount, error: existingAccountError } = await accountQuery.maybeSingle();

  if (existingAccountError) {
    throw existingAccountError;
  }

  if (existingAccount?.id) {
    return {
      id: existingAccount.id,
      accountType: normalizedType,
      accountRefId: normalizedRefId,
      clientProfileId: existingAccount.client_profile_id || clientProfileId || null,
      studentId: existingAccount.student_id || studentId || null,
      hmoProviderId: existingAccount.hmo_provider_id || hmoProviderId || null,
    };
  }

  const { data, error } = await tenantClient
    .from('ledger_accounts')
    .insert({
      org_id: normalizedOrgId,
      account_type: normalizedType,
      client_profile_id: clientProfileId,
      student_id: studentId,
      hmo_provider_id: hmoProviderId,
      service_id: null,
      metadata: {},
    })
    .select('id, org_id, account_type, client_profile_id, student_id, hmo_provider_id, service_id, metadata')
    .single();

  if (error) {
    throw error;
  }
  return {
    id: data.id,
    accountType: normalizedType,
    accountRefId: normalizedRefId,
    clientProfileId: data.client_profile_id || clientProfileId || null,
    studentId: data.student_id || studentId || null,
    hmoProviderId: data.hmo_provider_id || hmoProviderId || null,
  };
}

async function appendLedgerTransaction(tenantClient, payload) {
  const { data, error } = await tenantClient
    .from('ledger_transactions')
    .insert(payload)
    .select(`
      id,
      org_id,
      client_profile_id,
      student_id,
      commitment_id,
      transaction_type,
      usage_type,
      ledger_account_id,
      direction,
      amount,
      effective_at,
      posted_at,
      source_type,
      source_id,
      lesson_instance_id,
      lesson_participant_id,
      student_id,
      client_profile_id,
      hmo_provider_id,
      hmo_authorization_id,
      service_id,
      rate_source,
      reverses_transaction_id,
      external_reference,
      notes,
      metadata
    `)
    .single();

  if (error) {
    throw error;
  }
  return data;
}

function resolveUsageTypeForManualEntry(direction, sourceType) {
  const normalizedDirection = normalizeDirection(direction);
  const normalizedSourceType = normalizeString(sourceType).toLowerCase();
  if (normalizedDirection === 'CREDIT') {
    return MANUAL_CREDIT_USAGE_TYPE_BY_SOURCE[normalizedSourceType] || '';
  }
  if (normalizedDirection === 'DEBIT') {
    return MANUAL_DEBIT_USAGE_TYPE_BY_SOURCE[normalizedSourceType] || '';
  }
  return '';
}

function buildManualTransactionPayload({
  orgId,
  target,
  direction,
  amount,
  effectiveAt,
  clock,
  sourceType,
  sourceId = null,
  externalReference = null,
  notes = null,
  actorUserId = null,
  metadata = {},
}) {
  const normalizedDirection = normalizeDirection(direction);
  const usageType = resolveUsageTypeForManualEntry(normalizedDirection, sourceType);
  if (!orgId || !target?.accountType || !usageType) {
    throw new Error('invalid_manual_ledger_payload');
  }

  const normalizedSourceType = normalizeString(sourceType).toLowerCase();
  const normalizedExternalReference = normalizeString(externalReference) || null;
  const normalizedNotes = normalizeString(notes) || null;
  const timestamp = toIsoOrNow(effectiveAt, clock);

  return {
    org_id: orgId,
    client_profile_id: target.clientProfileId,
    student_id: target.studentId,
    commitment_id: null,
    transaction_type: normalizedDirection,
    usage_type: usageType,
    amount: coerceAgorot(amount),
    source_ref: sourceId,
    invoice_id: null,
    invoice_link: null,
    notes: normalizedNotes,
    ledger_account_id: target.id,
    direction: normalizedDirection,
    effective_at: timestamp,
    posted_at: timestamp,
    source_type: normalizedSourceType,
    source_id: sourceId,
    lesson_instance_id: null,
    lesson_participant_id: null,
    hmo_provider_id: target.hmoProviderId,
    hmo_authorization_id: null,
    service_id: null,
    rate_source: normalizedSourceType === 'opening_balance'
      ? 'opening_balance'
      : (normalizedSourceType === 'migration' ? 'migration' : 'manual'),
    reverses_transaction_id: null,
    external_reference: normalizedExternalReference,
    posted_at_migrated: false,
    metadata: {
      ...(isPlainObject(metadata) ? metadata : {}),
      actor_user_id: actorUserId || null,
      ledger_target_type: target.accountType,
      ledger_target_ref_id: target.accountRefId,
    },
  };
}

function buildLessonChargeMetadata({
  participant,
  instance,
  service,
  coverageDecision,
  actorUserId,
  reasonCode,
  detail,
  warnings,
}) {
  const authorization = coverageDecision?.authorization || null;
  return {
    reason_code: normalizeReasonCode(reasonCode),
    actor_user_id: actorUserId || null,
    participant_status: normalizeString(participant?.participant_status).toLowerCase() || null,
    lesson_status: normalizeString(instance?.status).toLowerCase() || null,
    lesson_date: toDateKey(instance?.datetime_start) || null,
    service_name: service?.service_name || service?.name || null,
    billing_reason: detail?.billingReason || null,
    coverage_status: coverageDecision?.status || null,
    coverage_reason: coverageDecision?.reason || null,
    post_coverage_policy: coverageDecision?.post_coverage_policy || null,
    warnings: warnings || [],
    authorization: authorization ? {
      id: authorization.id,
      provider_id: authorization.provider_id,
      provider_track_id: authorization.provider_track_id,
      covered_customer_charge_amount: coerceAgorot(coverageDecision?.covered_customer_charge_amount),
      covered_insurer_claim_amount: coerceAgorot(coverageDecision?.covered_insurer_claim_amount),
      post_coverage_customer_charge_amount: coverageDecision?.post_coverage_customer_charge_amount == null
        ? null
        : coerceAgorot(coverageDecision.post_coverage_customer_charge_amount),
      authorization_reference: authorization.authorization_reference || null,
    } : null,
  };
}

export function resolveHmoSplitAmounts({
  coverageDecision,
}) {
  if (coverageDecision?.status !== 'covered') {
    return null;
  }
  return {
    studentCopayAmount: coerceAgorot(coverageDecision.covered_customer_charge_amount),
    insurerClaimAmount: coerceAgorot(coverageDecision.covered_insurer_claim_amount),
    postCoveragePolicy: coverageDecision.post_coverage_policy || null,
    postCoverageCustomerChargeAmount: coverageDecision.post_coverage_customer_charge_amount == null
      ? null
      : coerceAgorot(coverageDecision.post_coverage_customer_charge_amount),
  };
}

export function buildDesiredChargeDescriptors({
  participant,
  service,
  coverageDecision = null,
  policies,
}) {
  const participantStatus = normalizeString(participant?.participant_status).toLowerCase();
  const billingRequirement = resolveBillingRequirement(participantStatus, policies);
  if (!billingRequirement.billable) {
    return {
      status: 'noop',
      billingStatus: 'not_chargeable',
      billingReason: billingRequirement.reason,
      warnings: [],
      entries: [],
    };
  }

  const serviceRate = service?.default_customer_charge_amount;
  if (serviceRate == null || !Number.isFinite(Number(serviceRate))) {
    return {
      status: 'blocked',
      billingStatus: 'blocked',
      billingReason: 'missing_service_default_customer_charge_amount',
      warnings: ['missing_service_default_customer_charge_amount'],
      entries: [],
    };
  }

  if (!participant?.client_profile_id) {
    return {
      status: 'blocked',
      billingStatus: 'blocked',
      billingReason: 'missing_client_profile_id',
      warnings: ['missing_client_profile_id'],
      entries: [],
    };
  }

  if (!participant?.student_id) {
    return {
      status: 'debited',
      billingStatus: 'charged',
      billingReason: 'direct_client_charge',
      warnings: [],
      entries: [{
        accountType: CLIENT_ACCOUNT_TYPE,
        accountRefId: participant.client_profile_id,
        direction: 'DEBIT',
        amount: coerceAgorot(serviceRate),
        rateSource: 'service_rate',
        hmoAuthorizationId: null,
      }],
    };
  }

  const effectiveCoverageDecision = coverageDecision && typeof coverageDecision === 'object'
    ? coverageDecision
    : {
      status: 'standard_uncovered',
      reason: 'no_authorization_found',
      authorization_id: null,
      authorization: null,
    };

  if (effectiveCoverageDecision.status === 'blocked') {
    return {
      status: 'blocked',
      billingStatus: 'blocked',
      billingReason: effectiveCoverageDecision.reason || 'billing_blocked',
      warnings: [effectiveCoverageDecision.reason || 'billing_blocked'],
      entries: [],
    };
  }

  if (effectiveCoverageDecision.status === 'standard_uncovered') {
    return {
      status: 'debited',
      billingStatus: 'charged',
      billingReason: 'service_rate_charge',
      warnings: [],
      entries: [{
        accountType: STUDENT_ACCOUNT_TYPE,
        accountRefId: participant.student_id,
        direction: 'DEBIT',
        amount: coerceAgorot(serviceRate),
        rateSource: 'service_rate',
        hmoAuthorizationId: null,
      }],
    };
  }

  if (effectiveCoverageDecision.status === 'post_coverage') {
    if (effectiveCoverageDecision.post_coverage_policy === 'manual_block') {
      return {
        status: 'blocked',
        billingStatus: 'blocked',
        billingReason: 'authorization_exhausted_manual_block',
        warnings: ['authorization_exhausted_manual_block'],
        entries: [],
      };
    }

    const postCoverageAmount = effectiveCoverageDecision.post_coverage_policy === 'explicit_customer_charge'
      ? effectiveCoverageDecision.post_coverage_customer_charge_amount
      : serviceRate;
    if (postCoverageAmount == null || !Number.isFinite(Number(postCoverageAmount))) {
      return {
        status: 'blocked',
        billingStatus: 'blocked',
        billingReason: 'missing_post_coverage_policy',
        warnings: ['missing_post_coverage_policy'],
        entries: [],
      };
    }

    return {
      status: 'debited',
      billingStatus: 'charged',
      billingReason: effectiveCoverageDecision.post_coverage_policy === 'explicit_customer_charge'
        ? 'post_coverage_explicit_customer_charge'
        : 'post_coverage_service_default_charge',
      warnings: [],
      entries: [{
        accountType: STUDENT_ACCOUNT_TYPE,
        accountRefId: participant.student_id,
        direction: 'DEBIT',
        amount: coerceAgorot(postCoverageAmount),
        rateSource: effectiveCoverageDecision.post_coverage_policy === 'explicit_customer_charge'
          ? 'post_coverage_policy'
          : 'service_rate',
        hmoAuthorizationId: effectiveCoverageDecision.authorization_id || null,
      }],
    };
  }

  const studentCopay = coerceAgorot(effectiveCoverageDecision.covered_customer_charge_amount);
  const insurerClaimAmount = coerceAgorot(effectiveCoverageDecision.covered_insurer_claim_amount);
  const entries = [];

  if (studentCopay > 0) {
    entries.push({
      accountType: STUDENT_ACCOUNT_TYPE,
      accountRefId: participant.student_id,
      direction: 'DEBIT',
      amount: studentCopay,
      rateSource: 'hmo_authorization',
      hmoAuthorizationId: effectiveCoverageDecision.authorization_id || null,
    });
  }
  if (insurerClaimAmount > 0) {
    entries.push({
      accountType: HMO_ACCOUNT_TYPE,
      accountRefId: effectiveCoverageDecision.authorization?.provider_id,
      direction: 'DEBIT',
      amount: insurerClaimAmount,
      rateSource: 'hmo_authorization',
      hmoAuthorizationId: effectiveCoverageDecision.authorization_id || null,
    });
  }

  return {
    status: entries.length > 0 ? 'debited' : 'noop',
    billingStatus: entries.length > 0 ? 'charged' : 'not_chargeable',
    billingReason: entries.length > 0 ? 'covered_hmo_charge' : 'zero_charge',
    warnings: [],
    entries,
  };
}

export function extractActiveLedgerAmounts(ledgerRows = []) {
  const totals = {
    debit: 0,
    credit: 0,
    net: 0,
  };
  for (const row of Array.isArray(ledgerRows) ? ledgerRows : []) {
    const amount = coerceAgorot(row?.amount);
    if (normalizeDirection(row?.direction) === 'CREDIT') {
      totals.credit += amount;
      totals.net += amount;
    } else if (normalizeDirection(row?.direction) === 'DEBIT') {
      totals.debit += amount;
      totals.net -= amount;
    }
  }
  return totals;
}

export default class BillingLedgerService {
  constructor({ tenantClient, orgId = '', clock = () => new Date().toISOString() }) {
    this.tenantClient = tenantClient;
    this.orgId = normalizeString(orgId);
    this.clock = clock;
  }

  async syncLessonParticipantCharge({
    lessonParticipantId,
    actorUserId,
    reasonCode,
    effectiveAt = null,
  }) {
    const participant = await loadParticipantContext(this.tenantClient, lessonParticipantId);
    if (!participant?.id || !participant?.lesson_instance?.id) {
      return {
        lessonParticipantId,
        status: 'blocked',
        createdTransactionIds: [],
        reversedTransactionIds: [],
        accountImpacts: [],
        warnings: ['lesson_participant_not_found'],
      };
    }

    const instance = participant.lesson_instance;
    const effectiveOrgId = normalizeString(this.orgId || instance?.org_id);
    if (!effectiveOrgId) {
      throw new Error('missing_org_id');
    }
    const serviceMap = await loadServiceMap(this.tenantClient, effectiveOrgId, [instance.service_id]);
    const service = serviceMap.get(instance.service_id) || null;
    const policies = await loadFinancePolicies(this.tenantClient, effectiveOrgId);
    const coverageDecision = participant.student_id
      ? await resolveLessonCoverageDecision(this.tenantClient, {
        orgId: effectiveOrgId,
        studentId: participant.student_id,
        serviceId: instance.service_id,
        lessonDate: instance.datetime_start,
        lessonParticipantId,
      })
      : { status: 'standard_uncovered', reason: 'missing_student_id', authorization_id: null, authorization: null };
    const desiredResult = buildDesiredChargeDescriptors({
      participant,
      service,
      coverageDecision,
      policies,
    });

    if (desiredResult.status === 'blocked') {
      return {
        lessonParticipantId,
        status: 'blocked',
        createdTransactionIds: [],
        reversedTransactionIds: [],
        accountImpacts: [],
        warnings: desiredResult.warnings,
      };
    }

    const existingOpenCharges = await loadOpenLessonCharges(this.tenantClient, lessonParticipantId);
    const desiredEntries = [];
    for (const descriptor of desiredResult.entries) {
      const ledgerAccount = await resolveLedgerAccount(this.tenantClient, effectiveOrgId, descriptor.accountType, descriptor.accountRefId);
      desiredEntries.push({
        ledger_account_id: ledgerAccount.id,
        direction: descriptor.direction,
        amount: descriptor.amount,
        student_id: ledgerAccount.studentId || null,
        client_profile_id: ledgerAccount.clientProfileId || participant.client_profile_id || null,
        hmo_provider_id: ledgerAccount.hmoProviderId || null,
        hmo_authorization_id: descriptor.hmoAuthorizationId || null,
        service_id: instance.service_id || null,
        rate_source: descriptor.rateSource,
      });
    }

    const existingSignatures = existingOpenCharges.map(buildLedgerEntrySignature).sort();
    const desiredSignatures = desiredEntries.map(buildLedgerEntrySignature).sort();
    if (existingSignatures.length === desiredSignatures.length
      && existingSignatures.every((signature, index) => signature === desiredSignatures[index])) {
      return {
        lessonParticipantId,
        status: 'noop',
        createdTransactionIds: [],
        reversedTransactionIds: [],
        accountImpacts: desiredEntries.map((entry) => ({
          ledgerAccountId: entry.ledger_account_id,
          accountType: entry.hmo_provider_id ? HMO_ACCOUNT_TYPE : (entry.student_id ? STUDENT_ACCOUNT_TYPE : CLIENT_ACCOUNT_TYPE),
          accountRefId: entry.hmo_provider_id || entry.student_id || entry.client_profile_id,
          direction: entry.direction,
          amount: entry.amount,
          rateSource: entry.rate_source,
          hmoAuthorizationId: entry.hmo_authorization_id || null,
        })),
        warnings: desiredResult.warnings,
      };
    }

    const effectiveTimestamp = toIsoOrNow(effectiveAt || instance.datetime_start, this.clock);
    const lessonChargeMetadata = buildLessonChargeMetadata({
      participant,
      instance,
      service,
      coverageDecision,
      actorUserId,
      reasonCode,
      detail: desiredResult,
      warnings: desiredResult.warnings,
    });

    const reversalRows = existingOpenCharges.map((original) => ({
      ...buildLegacyLedgerCompatFields({
        orgId: effectiveOrgId,
        direction: normalizeDirection(original.direction) === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        sourceType: 'reversal',
      }),
      ledger_account_id: original.ledger_account_id,
      direction: normalizeDirection(original.direction) === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      amount: coerceAgorot(original.amount),
      effective_at: effectiveTimestamp,
      source_type: 'reversal',
      source_id: null,
      lesson_instance_id: instance.id,
      lesson_participant_id: lessonParticipantId,
      student_id: original.student_id || null,
      client_profile_id: original.client_profile_id || participant.client_profile_id || null,
      hmo_provider_id: original.hmo_provider_id || null,
      hmo_authorization_id: original.hmo_authorization_id || null,
      service_id: original.service_id || instance.service_id || null,
      rate_source: original.rate_source || 'manual',
      reverses_transaction_id: original.id,
      external_reference: null,
      notes: `Reversal: ${normalizeReasonCode(reasonCode)}`,
      metadata: {
        reason_code: normalizeReasonCode(reasonCode),
        actor_user_id: actorUserId || null,
        reversed_source_type: original.source_type || null,
      },
    }));

    const debitRows = desiredEntries.map((entry) => ({
      ...buildLegacyLedgerCompatFields({
        orgId: effectiveOrgId,
        direction: entry.direction,
        sourceType: 'lesson_charge',
      }),
      ...entry,
      effective_at: effectiveTimestamp,
      source_type: 'lesson_charge',
      source_id: instance.id,
      lesson_instance_id: instance.id,
      lesson_participant_id: lessonParticipantId,
      external_reference: null,
      notes: null,
      metadata: lessonChargeMetadata,
    }));

    const allRows = [...reversalRows, ...debitRows];
    const { data: inserted, error: insertError } = await this.tenantClient
      .from('ledger_transactions')
      .insert(allRows)
      .select(`
        id,
        ledger_account_id,
        direction,
        amount,
        rate_source,
        student_id,
        client_profile_id,
        hmo_provider_id,
        hmo_authorization_id
      `);

    if (insertError) {
      throw insertError;
    }

    const insertedRows = inserted || [];
    const reversedTransactionIds = insertedRows.slice(0, reversalRows.length).map((r) => r.id);
    const createdRows = insertedRows.slice(reversalRows.length);
    const createdTransactionIds = createdRows.map((r) => r.id);
    const accountImpacts = createdRows.map((r) => ({
      ledgerAccountId: r.ledger_account_id,
      accountType: r.hmo_provider_id ? HMO_ACCOUNT_TYPE : (r.student_id ? STUDENT_ACCOUNT_TYPE : CLIENT_ACCOUNT_TYPE),
      accountRefId: r.hmo_provider_id || r.student_id || r.client_profile_id,
      direction: r.direction,
      amount: r.amount,
      rateSource: r.rate_source,
      hmoAuthorizationId: r.hmo_authorization_id || null,
    }));

    let status = 'noop';
    if (reversedTransactionIds.length > 0 && createdTransactionIds.length > 0) {
      status = 'reversed_and_debited';
    } else if (reversedTransactionIds.length > 0) {
      status = 'reversed_only';
    } else if (createdTransactionIds.length > 0) {
      status = 'debited';
    }

    return {
      lessonParticipantId,
      status,
      createdTransactionIds,
      reversedTransactionIds,
      accountImpacts,
      warnings: desiredResult.warnings,
    };
  }

  async syncLessonInstanceCharges({
    lessonInstanceId,
    actorUserId,
    reasonCode,
  }) {
    const participants = await loadInstanceParticipants(this.tenantClient, lessonInstanceId);
    const participantResults = [];
    for (const participant of participants) {
      participantResults.push(await this.syncLessonParticipantCharge({
        lessonParticipantId: participant.id,
        actorUserId,
        reasonCode,
      }));
    }

    return {
      lessonInstanceId,
      participantResults,
      createdTransactionCount: participantResults.reduce((sum, row) => sum + row.createdTransactionIds.length, 0),
      reversedTransactionCount: participantResults.reduce((sum, row) => sum + row.reversedTransactionIds.length, 0),
      blockedParticipantIds: participantResults.filter((row) => row.status === 'blocked').map((row) => row.lessonParticipantId),
    };
  }

  async resyncAuthorizationWindow({
    hmoAuthorizationId,
    actorUserId,
    reasonCode,
  }) {
    const [authorization] = await loadHmoAuthorizations(this.tenantClient, { orgId: this.orgId, authorizationIds: [hmoAuthorizationId] });
    if (!authorization?.id) {
      return {
        hmoAuthorizationId,
        lessonParticipantIds: [],
        createdTransactionCount: 0,
        reversedTransactionCount: 0,
        blockedParticipantIds: [],
      };
    }

    let participantsQuery = this.tenantClient
      .from('lesson_participants')
      .select(`
        id,
        lesson_instance:lesson_instances!inner(
          id,
          service_id,
          datetime_start
        )
      `)
      .eq('student_id', authorization.student_id)
      .eq('lesson_instance.service_id', authorization.service_id);

    if (normalizeString(authorization.valid_from)) {
      participantsQuery = participantsQuery.gte('lesson_instance.datetime_start', `${authorization.valid_from}T00:00:00.000Z`);
    }
    if (normalizeString(authorization.expires_at)) {
      participantsQuery = participantsQuery.lte('lesson_instance.datetime_start', `${authorization.expires_at}T23:59:59.999Z`);
    }

    const { data: participants, error } = await participantsQuery;

    if (error) {
      throw error;
    }

    const lessonParticipantIds = (participants || []).map((row) => row.id).filter(Boolean);
    const participantResults = [];
    for (const lessonParticipantId of lessonParticipantIds) {
      participantResults.push(await this.syncLessonParticipantCharge({
        lessonParticipantId,
        actorUserId,
        reasonCode,
      }));
    }

    return {
      hmoAuthorizationId,
      lessonParticipantIds,
      createdTransactionCount: participantResults.reduce((sum, row) => sum + row.createdTransactionIds.length, 0),
      reversedTransactionCount: participantResults.reduce((sum, row) => sum + row.reversedTransactionIds.length, 0),
      blockedParticipantIds: participantResults.filter((row) => row.status === 'blocked').map((row) => row.lessonParticipantId),
    };
  }

  async appendManualCredit({
    accountType,
    accountRefId,
    amount,
    effectiveAt,
    actorUserId,
    sourceType,
    sourceId = null,
    externalReference = null,
    notes = null,
    metadata = {},
  }) {
    if (!MANUAL_CREDIT_SOURCE_TYPES.has(normalizeString(sourceType))) {
      throw new Error('invalid_manual_credit_source_type');
    }
    const coercedAmount = coerceAgorot(amount);
    if (!Number.isFinite(coercedAmount) || coercedAmount <= 0) {
      throw new Error('amount_must_be_positive_integer');
    }

    const ledgerTarget = await resolveLedgerAccount(this.tenantClient, this.orgId, accountType, accountRefId);
    const transaction = await appendLedgerTransaction(this.tenantClient, buildManualTransactionPayload({
      orgId: this.orgId,
      target: ledgerTarget,
      direction: 'CREDIT',
      amount: coercedAmount,
      effectiveAt,
      clock: this.clock,
      sourceType,
      sourceId,
      externalReference,
      notes,
      actorUserId,
      metadata,
    }));
    return { transactionId: transaction.id };
  }

  async appendManualDebit({
    accountType,
    accountRefId,
    amount,
    effectiveAt,
    actorUserId,
    sourceType,
    sourceId = null,
    externalReference = null,
    notes = null,
    metadata = {},
  }) {
    if (!MANUAL_DEBIT_SOURCE_TYPES.has(normalizeString(sourceType))) {
      throw new Error('invalid_manual_debit_source_type');
    }
    const coercedAmount = coerceAgorot(amount);
    if (!Number.isFinite(coercedAmount) || coercedAmount <= 0) {
      throw new Error('amount_must_be_positive_integer');
    }

    const ledgerTarget = await resolveLedgerAccount(this.tenantClient, this.orgId, accountType, accountRefId);
    const transaction = await appendLedgerTransaction(this.tenantClient, buildManualTransactionPayload({
      orgId: this.orgId,
      target: ledgerTarget,
      direction: 'DEBIT',
      amount: coercedAmount,
      effectiveAt,
      clock: this.clock,
      sourceType,
      sourceId,
      externalReference,
      notes,
      actorUserId,
      metadata,
    }));
    return { transactionId: transaction.id };
  }

  async reverseTransaction({
    transactionId,
    actorUserId,
    reasonCode,
    effectiveAt = null,
    notes = null,
    sourceType = 'reversal',
    sourceId = null,
    metadata = {},
  }) {
    const { data: original, error } = await this.tenantClient
      .from('ledger_transactions')
      .select('*')
      .eq('id', transactionId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!original?.id || !REVERSIBLE_SOURCE_TYPES.has(normalizeString(original.source_type))) {
      throw new Error('transaction_not_reversible');
    }

    const { data: existingReversal, error: reversalLookupError } = await this.tenantClient
      .from('ledger_transactions')
      .select('id')
      .eq('reverses_transaction_id', transactionId)
      .maybeSingle();

    if (reversalLookupError) {
      throw reversalLookupError;
    }
    if (existingReversal?.id) {
      return {
        originalTransactionId: transactionId,
        reversalTransactionId: existingReversal.id,
      };
    }

    const reversal = await appendLedgerTransaction(this.tenantClient, {
      ...buildLegacyLedgerCompatFields({
        orgId: original.org_id || this.orgId,
        direction: normalizeDirection(original.direction) === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        sourceType: normalizeString(sourceType) || 'reversal',
      }),
      org_id: original.org_id || this.orgId,
      ledger_account_id: original.ledger_account_id,
      direction: normalizeDirection(original.direction) === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      amount: coerceAgorot(original.amount),
      effective_at: toIsoOrNow(effectiveAt || original.effective_at, this.clock),
      source_type: normalizeString(sourceType) || 'reversal',
      source_id: sourceId,
      lesson_instance_id: original.lesson_instance_id || null,
      lesson_participant_id: original.lesson_participant_id || null,
      student_id: original.student_id || null,
      client_profile_id: original.client_profile_id || null,
      hmo_provider_id: original.hmo_provider_id || null,
      hmo_authorization_id: original.hmo_authorization_id || null,
      service_id: original.service_id || null,
      rate_source: original.rate_source || 'manual',
      reverses_transaction_id: original.id,
      external_reference: null,
      notes: normalizeString(notes) || `Reversal: ${normalizeReasonCode(reasonCode)}`,
      metadata: {
        ...(isPlainObject(metadata) ? metadata : {}),
        reason_code: normalizeReasonCode(reasonCode),
        actor_user_id: actorUserId || null,
      },
    });

    return {
      originalTransactionId: transactionId,
      reversalTransactionId: reversal.id,
    };
  }

  async resolveRequestedHmoClaimLedgerIds({ requestedIds = [], hmoProviderId }) {
    const normalizedProviderId = normalizeString(hmoProviderId);
    const normalizedRequestedIds = Array.from(new Set((Array.isArray(requestedIds) ? requestedIds : [])
      .map((id) => normalizeString(id))
      .filter(Boolean)));

    if (normalizedRequestedIds.length === 0) {
      return {
        ledgerTransactionIds: [],
        resolvedDashboardTaskIds: [],
        unresolvedClaimIds: [],
      };
    }

    const { data: directLedgerRows, error: directLedgerError } = await this.tenantClient
      .from('ledger_transactions')
      .select('id')
      .eq('org_id', this.orgId)
      .in('id', normalizedRequestedIds);
    if (directLedgerError) {
      throw directLedgerError;
    }

    const directLedgerIds = new Set((directLedgerRows || []).map((row) => normalizeString(row?.id)).filter(Boolean));
    const missingDirectIds = normalizedRequestedIds.filter((id) => !directLedgerIds.has(id));
    if (missingDirectIds.length === 0) {
      return {
        ledgerTransactionIds: normalizedRequestedIds,
        resolvedDashboardTaskIds: [],
        unresolvedClaimIds: [],
      };
    }

    const { data: taskRows, error: taskError } = await this.tenantClient
      .from('dashboard_tasks')
      .select('id, resource_id, metadata')
      .eq('org_id', this.orgId)
      .eq('task_type', 'hmo_claim_submission')
      .in('id', missingDirectIds);
    if (taskError && taskError.code !== '42P01') {
      throw taskError;
    }

    const tasksById = new Map((taskRows || [])
      .map((task) => [normalizeString(task?.id), task])
      .filter(([id, task]) => id && normalizeString(task?.resource_id)));
    const participantIds = Array.from(new Set(Array.from(tasksById.values())
      .map((task) => normalizeString(task?.resource_id))
      .filter(Boolean)));

    const { data: participantLedgerRows, error: participantLedgerError } = participantIds.length > 0
      ? await this.tenantClient
        .from('ledger_transactions')
        .select('id, lesson_participant_id, hmo_authorization_id, hmo_provider_id, effective_at')
        .eq('org_id', this.orgId)
        .eq('source_type', 'lesson_charge')
        .eq('direction', 'DEBIT')
        .eq('hmo_provider_id', normalizedProviderId)
        .is('reverses_transaction_id', null)
        .in('lesson_participant_id', participantIds)
      : { data: [], error: null };
    if (participantLedgerError) {
      throw participantLedgerError;
    }

    const rowsByParticipantId = new Map();
    for (const row of participantLedgerRows || []) {
      const participantId = normalizeString(row?.lesson_participant_id);
      if (!participantId) continue;
      if (!rowsByParticipantId.has(participantId)) {
        rowsByParticipantId.set(participantId, []);
      }
      rowsByParticipantId.get(participantId).push(row);
    }

    const resolvedTaskLedgerIds = new Map();
    const ambiguousTaskIds = new Set();
    for (const [taskId, task] of tasksById.entries()) {
      const participantId = normalizeString(task?.resource_id);
      const metadata = isPlainObject(task?.metadata) ? task.metadata : {};
      const expectedAuthorizationId = normalizeString(metadata.hmo_authorization_id || metadata.authorization?.id);
      const matchingRows = (rowsByParticipantId.get(participantId) || [])
        .filter((row) => !expectedAuthorizationId || normalizeString(row?.hmo_authorization_id) === expectedAuthorizationId)
        .sort((a, b) => String(a?.effective_at || '').localeCompare(String(b?.effective_at || '')));

      if (matchingRows.length === 1) {
        resolvedTaskLedgerIds.set(taskId, normalizeString(matchingRows[0]?.id));
      } else if (matchingRows.length > 1) {
        ambiguousTaskIds.add(taskId);
      }
    }

    const ledgerTransactionIds = [];
    const seenLedgerIds = new Set();
    const resolvedDashboardTaskIds = [];
    const unresolvedClaimIds = [];
    for (const requestedId of normalizedRequestedIds) {
      const directLedgerId = directLedgerIds.has(requestedId) ? requestedId : null;
      const resolvedLedgerId = directLedgerId || resolvedTaskLedgerIds.get(requestedId);
      if (resolvedLedgerId) {
        if (!seenLedgerIds.has(resolvedLedgerId)) {
          seenLedgerIds.add(resolvedLedgerId);
          ledgerTransactionIds.push(resolvedLedgerId);
        }
        if (!directLedgerId) {
          resolvedDashboardTaskIds.push(requestedId);
        }
      } else {
        unresolvedClaimIds.push(requestedId);
      }
    }

    return {
      ledgerTransactionIds,
      resolvedDashboardTaskIds,
      unresolvedClaimIds,
      ambiguousDashboardTaskIds: Array.from(ambiguousTaskIds),
    };
  }

  async createHmoInvoiceBatch({
    hmoProviderId,
    periodStart,
    periodEnd,
    actorUserId,
    ledgerTransactionIds = [],
    externalReference = null,
    externalLink = null,
    notes = null,
  }) {
    const normalizedProviderId = normalizeString(hmoProviderId);
    if (!normalizedProviderId) {
      throw new Error('missing_hmo_provider_id');
    }

    if (!this.orgId) {
      throw new Error('missing_org_id');
    }

    const requestedClaimIds = Array.from(new Set((Array.isArray(ledgerTransactionIds) ? ledgerTransactionIds : [])
      .map((id) => normalizeString(id))
      .filter(Boolean)));

    const { data: provider, error: providerError } = await this.tenantClient
      .from('hmo_providers')
      .select('id, name, is_active')
      .eq('org_id', this.orgId)
      .eq('id', normalizedProviderId)
      .maybeSingle();

    if (providerError) {
      throw providerError;
    }
    if (!provider?.id) {
      throw new Error('hmo_provider_not_found');
    }
    if (provider.is_active === false) {
      throw new Error('hmo_provider_inactive');
    }

    const claimIdResolution = await this.resolveRequestedHmoClaimLedgerIds({
      requestedIds: requestedClaimIds,
      hmoProviderId: normalizedProviderId,
    });
    const requestedLedgerIds = claimIdResolution.ledgerTransactionIds;
    if (requestedClaimIds.length > 0 && claimIdResolution.unresolvedClaimIds.length > 0) {
      const error = new Error('hmo_claim_line_not_claimable');
      error.details = {
        requested_claim_ids: requestedClaimIds,
        requested_ledger_transaction_ids: requestedLedgerIds,
        found_ledger_transaction_ids: requestedLedgerIds,
        missing_claim_ids: claimIdResolution.unresolvedClaimIds,
        resolved_dashboard_task_ids: claimIdResolution.resolvedDashboardTaskIds,
        expected_org_id: this.orgId,
      };
      throw error;
    }

    let query = this.tenantClient
      .from('ledger_transactions')
      .select('id, org_id, amount, effective_at, hmo_provider_id, hmo_authorization_id, lesson_participant_id, source_type, direction, reverses_transaction_id')
      .eq('org_id', this.orgId)
      .eq('source_type', 'lesson_charge')
      .eq('direction', 'DEBIT')
      .is('reverses_transaction_id', null)
      .order('effective_at', { ascending: true });

    if (requestedLedgerIds.length === 0) {
      query = query.eq('hmo_provider_id', normalizedProviderId);
    }

    if (dateKeyToUtcBoundary(periodStart, 'start')) {
      query = query.gte('effective_at', dateKeyToUtcBoundary(periodStart, 'start'));
    }
    if (dateKeyToUtcBoundary(periodEnd, 'end')) {
      query = query.lte('effective_at', dateKeyToUtcBoundary(periodEnd, 'end'));
    }
    if (requestedLedgerIds.length > 0) {
      query = query.in('id', requestedLedgerIds);
    }

    const { data: debitRows, error: debitError } = await query;
    if (debitError) {
      throw debitError;
    }

    const candidateRows = Array.isArray(debitRows) ? debitRows : [];
    const candidateIds = candidateRows.map((row) => row.id).filter(Boolean);
    if (requestedLedgerIds.length > 0 && candidateIds.length !== requestedLedgerIds.length) {
      const foundIds = new Set(candidateIds);
      const error = new Error('hmo_claim_line_not_claimable');
      error.details = {
        requested_claim_ids: requestedClaimIds,
        requested_ledger_transaction_ids: requestedLedgerIds,
        found_ledger_transaction_ids: candidateIds,
        missing_ledger_transaction_ids: requestedLedgerIds.filter((id) => !foundIds.has(id)),
        resolved_dashboard_task_ids: claimIdResolution.resolvedDashboardTaskIds,
        expected_org_id: this.orgId,
      };
      throw error;
    }
    if (requestedLedgerIds.length > 0 && candidateRows.some((row) => normalizeString(row?.hmo_provider_id) !== normalizedProviderId)) {
      throw new Error('hmo_claim_provider_mismatch');
    }

    const { data: reversalRows, error: reversalError } = candidateIds.length > 0
      ? await this.tenantClient
        .from('ledger_transactions')
        .select('id, reverses_transaction_id')
        .eq('org_id', this.orgId)
        .in('reverses_transaction_id', candidateIds)
      : { data: [], error: null };

    if (reversalError) {
      throw reversalError;
    }

    const reversedLedgerIds = new Set((reversalRows || []).map((row) => row.reverses_transaction_id).filter(Boolean));

    const { data: existingItems, error: itemsError } = candidateIds.length > 0
      ? await this.tenantClient
        .from('hmo_invoice_batch_items')
        .select('ledger_transaction_id, batch_id')
        .eq('org_id', this.orgId)
        .in('ledger_transaction_id', candidateIds)
      : { data: [], error: null };

    if (itemsError) {
      throw itemsError;
    }

    const existingBatchIds = Array.from(new Set((existingItems || []).map((row) => row.batch_id).filter(Boolean)));
    const { data: existingBatches, error: existingBatchesError } = existingBatchIds.length > 0
      ? await this.tenantClient
        .from('hmo_invoice_batches')
        .select('id, status')
        .eq('org_id', this.orgId)
        .in('id', existingBatchIds)
      : { data: [], error: null };

    if (existingBatchesError) {
      throw existingBatchesError;
    }

    const activeBatchIds = new Set((existingBatches || [])
      .filter((batch) => ACTIVE_HMO_BATCH_STATUSES.has(normalizeString(batch?.status).toLowerCase()))
      .map((batch) => batch.id));
    const usedLedgerIds = new Set((existingItems || [])
      .filter((item) => activeBatchIds.has(item.batch_id))
      .map((row) => row.ledger_transaction_id));
    const eligibleRows = candidateRows.filter((row) => !reversedLedgerIds.has(row.id) && !usedLedgerIds.has(row.id));
    if (requestedLedgerIds.length > 0 && eligibleRows.length !== requestedLedgerIds.length) {
      throw new Error('hmo_claim_line_already_batched_or_reversed');
    }

    await this.assertHmoAuthorizationClaimCapacity(eligibleRows);

    const totalAmount = eligibleRows.reduce((sum, row) => sum + coerceAgorot(row.amount), 0);
    if (eligibleRows.length === 0 || totalAmount <= 0) {
      throw new Error('hmo_claim_batch_empty');
    }

    const { data: batch, error: batchError } = await this.tenantClient
      .from('hmo_invoice_batches')
      .insert({
        org_id: this.orgId,
        hmo_provider_id: normalizedProviderId,
        period_start: toDateKey(periodStart) || null,
        period_end: toDateKey(periodEnd) || null,
        status: 'draft',
        total_amount: totalAmount,
        paid_amount: 0,
        external_reference: normalizeString(externalReference) || null,
        external_link: normalizeString(externalLink) || null,
        notes: normalizeString(notes) || null,
        issued_at: null,
        metadata: {
          actor_user_id: actorUserId || null,
          claim_count: eligibleRows.length,
          created_from: requestedLedgerIds.length > 0 ? 'selected_claim_lines' : 'provider_period',
        },
      })
      .select('id, status')
      .single();

    if (batchError) {
      throw batchError;
    }

    if (eligibleRows.length > 0) {
      const { error: insertItemsError } = await this.tenantClient
        .from('hmo_invoice_batch_items')
        .insert(eligibleRows.map((row) => ({
          org_id: this.orgId,
          batch_id: batch.id,
          ledger_transaction_id: row.id,
          amount: coerceAgorot(row.amount),
          expected_amount: coerceAgorot(row.amount),
          expected_unit_count: 1,
          paid_amount: 0,
          status: 'draft',
          lesson_participant_id: row.lesson_participant_id || null,
          hmo_authorization_id: row.hmo_authorization_id || null,
          hmo_provider_id: normalizedProviderId,
          metadata: {
            actor_user_id: actorUserId || null,
          },
        })));

      if (insertItemsError) {
        // Best-effort cleanup of the orphaned batch header before re-throwing.
        await this.tenantClient.from('hmo_invoice_batches').delete().eq('org_id', this.orgId).eq('id', batch.id);
        throw insertItemsError;
      }
    }

    return {
      batchId: batch.id,
      status: batch.status,
      ledgerTransactionIds: eligibleRows.map((row) => row.id),
      claimCount: eligibleRows.length,
      totalAmount,
    };
  }

  async assertHmoAuthorizationClaimCapacity(selectedRows = [], { addSelectedCount = true } = {}) {
    const selectedByAuthorization = new Map();
    for (const row of Array.isArray(selectedRows) ? selectedRows : []) {
      const authorizationId = normalizeString(row?.hmo_authorization_id);
      if (!authorizationId) continue;
      selectedByAuthorization.set(authorizationId, (selectedByAuthorization.get(authorizationId) || 0) + 1);
    }
    const authorizationIds = Array.from(selectedByAuthorization.keys());
    if (authorizationIds.length === 0) return;

    const { data: authorizations, error: authorizationError } = await this.tenantClient
      .from('hmo_authorizations')
      .select('id, authorized_lessons')
      .eq('org_id', this.orgId)
      .in('id', authorizationIds);
    if (authorizationError) {
      throw authorizationError;
    }

    const authorizationMap = new Map((authorizations || []).map((row) => [row.id, row]));
    const { data: authorizationLedgerRows, error: ledgerError } = await this.tenantClient
      .from('ledger_transactions')
      .select('id, hmo_authorization_id')
      .eq('org_id', this.orgId)
      .in('hmo_authorization_id', authorizationIds)
      .eq('source_type', 'lesson_charge')
      .eq('direction', 'DEBIT')
      .is('reverses_transaction_id', null);
    if (ledgerError) {
      throw ledgerError;
    }

    const ledgerAuthorizationMap = new Map((authorizationLedgerRows || []).map((row) => [row.id, row.hmo_authorization_id]));
    const ledgerIds = Array.from(ledgerAuthorizationMap.keys());
    if (ledgerIds.length === 0) return;

    const { data: items, error: itemsError } = await this.tenantClient
      .from('hmo_invoice_batch_items')
      .select('ledger_transaction_id, batch_id')
      .eq('org_id', this.orgId)
      .in('ledger_transaction_id', ledgerIds);
    if (itemsError) {
      throw itemsError;
    }

    const batchIds = Array.from(new Set((items || []).map((item) => item.batch_id).filter(Boolean)));
    const { data: batches, error: batchError } = batchIds.length > 0
      ? await this.tenantClient
        .from('hmo_invoice_batches')
        .select('id, status')
        .eq('org_id', this.orgId)
        .in('id', batchIds)
      : { data: [], error: null };
    if (batchError) {
      throw batchError;
    }

    const activeBatchIds = new Set((batches || [])
      .filter((batch) => ACTIVE_HMO_BATCH_STATUSES.has(normalizeString(batch?.status).toLowerCase()))
      .map((batch) => batch.id));
    const existingCounts = new Map();
    for (const item of items || []) {
      if (!activeBatchIds.has(item.batch_id)) continue;
      const authorizationId = ledgerAuthorizationMap.get(item.ledger_transaction_id);
      if (!authorizationId) continue;
      existingCounts.set(authorizationId, (existingCounts.get(authorizationId) || 0) + 1);
    }

    for (const [authorizationId, selectedCount] of selectedByAuthorization.entries()) {
      const authorization = authorizationMap.get(authorizationId);
      const limit = Number(authorization?.authorized_lessons || 0);
      const attemptedTotal = (existingCounts.get(authorizationId) || 0) + (addSelectedCount ? selectedCount : 0);
      if (limit > 0 && attemptedTotal > limit) {
        const error = new Error('hmo_authorization_claim_limit_exceeded');
        error.details = {
          hmo_authorization_id: authorizationId,
          authorized_lessons: limit,
          already_selected_claims: existingCounts.get(authorizationId) || 0,
          attempted_claims: addSelectedCount ? selectedCount : 0,
        };
        throw error;
      }
    }
  }

  async submitHmoInvoiceBatch({
    batchId,
    actorUserId,
    externalReference = null,
    externalLink = null,
    notes = null,
  }) {
    const normalizedBatchId = normalizeString(batchId);
    if (!this.orgId) {
      throw new Error('missing_org_id');
    }
    if (!normalizedBatchId) {
      throw new Error('missing_invoice_batch_id');
    }

    const { data: batch, error: batchError } = await this.tenantClient
      .from('hmo_invoice_batches')
      .select('id, org_id, hmo_provider_id, status, total_amount, metadata')
      .eq('org_id', this.orgId)
      .eq('id', normalizedBatchId)
      .maybeSingle();
    if (batchError) {
      throw batchError;
    }
    if (!batch?.id) {
      throw new Error('invoice_batch_not_found');
    }
    const status = normalizeString(batch.status).toLowerCase();
    if (status !== 'draft') {
      throw new Error('invoice_batch_not_draft');
    }

    const { data: items, error: itemsError } = await this.tenantClient
      .from('hmo_invoice_batch_items')
      .select('id, ledger_transaction_id, amount, lesson_participant_id, hmo_authorization_id')
      .eq('org_id', this.orgId)
      .eq('batch_id', normalizedBatchId);
    if (itemsError) {
      throw itemsError;
    }
    const itemRows = Array.isArray(items) ? items : [];
    if (itemRows.length === 0) {
      throw new Error('invoice_batch_empty');
    }

    const ledgerIds = itemRows.map((item) => item.ledger_transaction_id).filter(Boolean);
    const { data: ledgerRows, error: ledgerError } = await this.tenantClient
      .from('ledger_transactions')
      .select('id, amount, hmo_authorization_id, lesson_participant_id')
      .eq('org_id', this.orgId)
      .in('id', ledgerIds);
    if (ledgerError) {
      throw ledgerError;
    }
    await this.assertHmoAuthorizationClaimCapacity(ledgerRows || [], { addSelectedCount: false });

    const submittedAt = this.clock();
    const { error: updateError } = await this.tenantClient
      .from('hmo_invoice_batches')
      .update({
        status: 'submitted',
        external_reference: normalizeString(externalReference) || null,
        external_link: normalizeString(externalLink) || null,
        notes: normalizeString(notes) || null,
        issued_at: submittedAt,
        submitted_at: submittedAt,
        submitted_by: actorUserId || null,
        updated_at: submittedAt,
        metadata: {
          ...(isPlainObject(batch.metadata) ? batch.metadata : {}),
          submitted_by: actorUserId || null,
          submitted_at: submittedAt,
        },
      })
      .eq('org_id', this.orgId)
      .eq('id', normalizedBatchId)
      .eq('status', 'draft');
    if (updateError) {
      throw updateError;
    }

    const { error: itemUpdateError } = await this.tenantClient
      .from('hmo_invoice_batch_items')
      .update({ status: 'submitted' })
      .eq('org_id', this.orgId)
      .eq('batch_id', normalizedBatchId);
    if (itemUpdateError) {
      throw itemUpdateError;
    }

    const participantIds = Array.from(new Set(itemRows.map((item) => normalizeString(item.lesson_participant_id)).filter(Boolean)));
    if (participantIds.length > 0) {
      const lockRows = participantIds.map((participantId) => ({
        org_id: this.orgId,
        lesson_participant_id: participantId,
        lock_source_type: 'claim_batch',
        lock_source_id: normalizedBatchId,
        lock_reason: 'hmo_claim_submitted',
        created_by: actorUserId || null,
        metadata: {
          hmo_invoice_batch_id: normalizedBatchId,
          hmo_provider_id: batch.hmo_provider_id,
        },
      }));
      const { error: lockError } = await this.tenantClient
        .from('participant_locks')
        .upsert(lockRows, { onConflict: 'org_id,lesson_participant_id,lock_source_type,lock_source_id' });
      if (lockError) {
        throw lockError;
      }

      const { data: tasks, error: taskError } = await this.tenantClient
        .from('dashboard_tasks')
        .select('id, resource_id')
        .eq('org_id', this.orgId)
        .eq('task_type', 'hmo_claim_submission')
        .eq('status', 'open')
        .in('resource_id', participantIds);
      if (taskError && taskError.code !== '42P01') {
        throw taskError;
      }
      for (const task of tasks || []) {
        await resolveDashboardTask(this.tenantClient, {
          orgId: this.orgId,
          taskId: task.id,
          resolvedBy: actorUserId || null,
          metadata: {
            resolved_by_hmo_invoice_batch: true,
            hmo_invoice_batch_id: normalizedBatchId,
          },
        });
      }
    }

    return {
      batchId: normalizedBatchId,
      status: 'submitted',
      submittedAt,
      claimCount: itemRows.length,
      totalAmount: coerceAgorot(batch.total_amount),
    };
  }

  async recordHmoInvoiceBatchPayment({
    batchId,
    amount,
    effectiveAt,
    actorUserId,
    externalReference = null,
    notes = null,
    metadata = {},
  }) {
    if (!this.orgId) {
      throw new Error('missing_org_id');
    }
    const normalizedBatchId = normalizeString(batchId);
    if (!normalizedBatchId) {
      throw new Error('missing_invoice_batch_id');
    }
    const { data: batch, error } = await this.tenantClient
      .from('hmo_invoice_batches')
      .select('id, hmo_provider_id, total_amount, paid_amount, status')
      .eq('org_id', this.orgId)
      .eq('id', normalizedBatchId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!batch?.id || !batch?.hmo_provider_id) {
      throw new Error('invoice_batch_not_found');
    }
    if (!SUBMITTED_HMO_BATCH_STATUSES.has(normalizeString(batch.status).toLowerCase())) {
      throw new Error('invoice_batch_not_submitted');
    }
    const amountAgorot = coerceAgorot(amount);
    if (amountAgorot <= 0) {
      throw new Error('amount_must_be_positive_integer');
    }

    const { data: provider, error: providerError } = await this.tenantClient
      .from('hmo_providers')
      .select('id, claim_reference_required')
      .eq('org_id', this.orgId)
      .eq('id', batch.hmo_provider_id)
      .maybeSingle();
    if (providerError) {
      throw providerError;
    }
    if (provider?.claim_reference_required === true && !normalizeString(externalReference)) {
      throw new Error('hmo_payment_reference_required');
    }

    const nextPaidAmount = coerceAgorot(batch.paid_amount) + amountAgorot;
    if (nextPaidAmount > coerceAgorot(batch.total_amount)) {
      throw new Error('hmo_payment_exceeds_batch_balance');
    }

    const result = await this.appendManualCredit({
      accountType: HMO_ACCOUNT_TYPE,
      accountRefId: batch.hmo_provider_id,
      amount: amountAgorot,
      effectiveAt,
      actorUserId,
      sourceType: 'hmo_invoice_payment',
      sourceId: batch.id,
      externalReference,
      notes,
      metadata,
    });

    const nextStatus = nextPaidAmount >= coerceAgorot(batch.total_amount) ? 'paid' : 'partially_paid';
    const paymentAt = toIsoOrNow(effectiveAt, this.clock);
    const { error: updateError } = await this.tenantClient
      .from('hmo_invoice_batches')
      .update({
        paid_amount: nextPaidAmount,
        status: nextStatus,
        paid_at: nextStatus === 'paid' ? paymentAt : null,
        received_at: paymentAt,
        updated_at: this.clock(),
      })
      .eq('org_id', this.orgId)
      .eq('id', batch.id);

    if (updateError) {
      throw updateError;
    }

    const { error: itemsUpdateError } = await this.tenantClient
      .from('hmo_invoice_batch_items')
      .update({ status: nextStatus === 'paid' ? 'paid' : 'partially_paid' })
      .eq('org_id', this.orgId)
      .eq('batch_id', batch.id);
    if (itemsUpdateError) {
      throw itemsUpdateError;
    }

    return {
      transactionId: result.transactionId,
      hmoProviderId: batch.hmo_provider_id,
      batchId: batch.id,
      status: nextStatus,
      paidAmount: nextPaidAmount,
    };
  }

  async cancelHmoInvoiceBatch({
    batchId,
    actorUserId,
    reason = null,
  }) {
    if (!this.orgId) {
      throw new Error('missing_org_id');
    }
    const normalizedBatchId = normalizeString(batchId);
    if (!normalizedBatchId) {
      throw new Error('missing_invoice_batch_id');
    }

    const { data: batch, error: batchError } = await this.tenantClient
      .from('hmo_invoice_batches')
      .select('id, status, paid_amount, metadata')
      .eq('org_id', this.orgId)
      .eq('id', normalizedBatchId)
      .maybeSingle();
    if (batchError) {
      throw batchError;
    }
    if (!batch?.id) {
      throw new Error('invoice_batch_not_found');
    }
    if (coerceAgorot(batch.paid_amount) > 0 || normalizeString(batch.status).toLowerCase() === 'paid') {
      throw new Error('paid_invoice_batch_cannot_be_cancelled');
    }
    if (normalizeString(batch.status).toLowerCase() === 'cancelled') {
      return { batchId: normalizedBatchId, status: 'cancelled' };
    }

    const cancelledAt = this.clock();
    const { error: updateError } = await this.tenantClient
      .from('hmo_invoice_batches')
      .update({
        status: 'cancelled',
        updated_at: cancelledAt,
        metadata: {
          ...(isPlainObject(batch.metadata) ? batch.metadata : {}),
          cancelled_by: actorUserId || null,
          cancelled_at: cancelledAt,
          cancel_reason: normalizeString(reason) || null,
        },
      })
      .eq('org_id', this.orgId)
      .eq('id', normalizedBatchId);
    if (updateError) {
      throw updateError;
    }

    const { error: itemsUpdateError } = await this.tenantClient
      .from('hmo_invoice_batch_items')
      .update({ status: 'cancelled' })
      .eq('org_id', this.orgId)
      .eq('batch_id', normalizedBatchId);
    if (itemsUpdateError) {
      throw itemsUpdateError;
    }

    const { error: lockDeleteError } = await this.tenantClient
      .from('participant_locks')
      .delete()
      .eq('org_id', this.orgId)
      .eq('lock_source_type', 'claim_batch')
      .eq('lock_source_id', normalizedBatchId);
    if (lockDeleteError && lockDeleteError.code !== '42P01') {
      throw lockDeleteError;
    }

    return { batchId: normalizedBatchId, status: 'cancelled' };
  }

  async getAccountBalance({
    accountType,
    accountRefId,
    asOf = null,
  }) {
    const normalizedType = normalizeAccountType(accountType);
    const normalizedRefId = normalizeString(accountRefId);
    if (!normalizedType || !normalizedRefId) {
      throw new Error('invalid_ledger_account_target');
    }
    if (!this.orgId) {
      throw new Error('missing_org_id');
    }

    let query = this.tenantClient
      .from('ledger_transactions')
      .select('direction, amount')
      .eq('org_id', this.orgId)
      .eq(ACCOUNT_COLUMN_BY_TYPE[normalizedType], normalizedRefId);

    if (normalizeString(asOf)) {
      const parsed = new Date(asOf);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('invalid_asOf_date');
      }
      query = query.lte('effective_at', parsed.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const balance = (data || []).reduce((sum, row) => sum + signedAmount(row.direction, row.amount), 0);
    return { balance };
  }

  async getStudentBillingSnapshot({
    studentId,
    startDate = null,
    endDate = null,
    limit = 500,
  }) {
    const normalizedStudentId = normalizeString(studentId);
    if (!normalizedStudentId) {
      return {
        summary: { balance: 0, lesson_charge_total: 0, payment_total: 0, manual_adjustment_total: 0 },
        ledger_entries: [],
        lesson_history: [],
        authorizations: [],
      };
    }

    const studentMap = await loadStudentProfileMap(this.tenantClient, this.orgId, [normalizedStudentId]);
    const student = studentMap.get(normalizedStudentId) || null;
    const balance = await this.getAccountBalance({ accountType: STUDENT_ACCOUNT_TYPE, accountRefId: normalizedStudentId });
    const authorizations = await loadHmoAuthorizations(this.tenantClient, { orgId: this.orgId, studentId: normalizedStudentId });

    const pageLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 500;

    let ledgerQuery = this.tenantClient
      .from('ledger_transactions')
      .select('*')
      .eq('org_id', this.orgId)
      .eq('student_id', normalizedStudentId)
      .order('effective_at', { ascending: false })
      .order('posted_at', { ascending: false })
      .limit(pageLimit);

    if (normalizeString(startDate)) {
      ledgerQuery = ledgerQuery.gte('effective_at', `${startDate}T00:00:00.000Z`);
    }
    if (normalizeString(endDate)) {
      ledgerQuery = ledgerQuery.lte('effective_at', `${endDate}T23:59:59.999Z`);
    }

    const { data: ledgerEntries, error: ledgerError } = await ledgerQuery;
    if (ledgerError) {
      throw ledgerError;
    }

    const { data: participants, error: participantsError } = await this.tenantClient
      .from('lesson_participants')
      .select(`
        id,
        participant_status,
        client_profile_id,
        student_id,
        lesson_instance:lesson_instances!inner(
          id,
          datetime_start,
          service_id,
          status
        )
      `)
      .eq('org_id', this.orgId)
      .eq('student_id', normalizedStudentId)
      .order('lesson_instance(datetime_start)', { ascending: false })
      .limit(pageLimit);

    if (participantsError) {
      throw participantsError;
    }

    const participantIds = (participants || []).map((row) => row.id);
    const { data: lessonLedgerRows, error: lessonLedgerError } = participantIds.length > 0
      ? await this.tenantClient
        .from('ledger_transactions')
        .select('*')
        .eq('org_id', this.orgId)
        .in('lesson_participant_id', participantIds)
        .in('source_type', ['lesson_charge', 'reversal'])
        .limit(pageLimit * 4)
      : { data: [], error: null };

    if (lessonLedgerError) {
      throw lessonLedgerError;
    }

    const lessonRowsByParticipant = groupBy(lessonLedgerRows || [], (row) => row.lesson_participant_id);
    const serviceMap = await loadServiceMap(
      this.tenantClient,
      this.orgId,
      (participants || []).map((row) => row?.lesson_instance?.service_id).filter(Boolean),
    );

    const lessonHistory = (participants || []).map((participant) => {
      const rows = lessonRowsByParticipant.get(participant.id) || [];
      const reversedIds = new Set(rows
        .filter((entry) => normalizeString(entry.source_type) === 'reversal' && entry.reverses_transaction_id)
        .map((entry) => entry.reverses_transaction_id));
      const activeRows = rows.filter((row) => normalizeString(row.source_type) === 'lesson_charge' && !reversedIds.has(row.id));
      const studentChargeAmount = activeRows
        .filter((row) => row.student_id === normalizedStudentId && normalizeDirection(row.direction) === 'DEBIT')
        .reduce((sum, row) => sum + coerceAgorot(row.amount), 0);
      const hmoChargeAmount = activeRows
        .filter((row) => row.hmo_provider_id && normalizeDirection(row.direction) === 'DEBIT')
        .reduce((sum, row) => sum + coerceAgorot(row.amount), 0);
      const coverageMetadata = activeRows.find((row) => isPlainObject(row?.metadata) && row.metadata.coverage_status)?.metadata
        || null;
      const service = serviceMap.get(participant?.lesson_instance?.service_id) || null;
      return {
        id: participant.id,
        student_id: normalizedStudentId,
        participant_status: participant.participant_status,
        lesson_instance_id: participant?.lesson_instance?.id || null,
        lesson_instance: participant.lesson_instance || null,
        service,
        student_charge_amount: studentChargeAmount,
        hmo_charge_amount: hmoChargeAmount,
        billed_amount: studentChargeAmount,
        billing_status: (studentChargeAmount > 0 || hmoChargeAmount > 0) ? 'charged' : 'not_chargeable',
        coverage_status: normalizeString(coverageMetadata?.coverage_status) || null,
        coverage_reason: normalizeString(coverageMetadata?.coverage_reason) || null,
        post_coverage_policy: normalizeString(coverageMetadata?.post_coverage_policy) || null,
      };
    }).filter((row) => {
      const lessonDate = toDateKey(row?.lesson_instance?.datetime_start);
      if (normalizeString(startDate) && lessonDate && lessonDate < startDate) {
        return false;
      }
      if (normalizeString(endDate) && lessonDate && lessonDate > endDate) {
        return false;
      }
      return true;
    });

    return {
      student,
      summary: {
        balance: balance.balance,
        lesson_charge_total: lessonHistory.reduce((sum, row) => sum + coerceAgorot(row.student_charge_amount), 0),
        hmo_charge_total: lessonHistory.reduce((sum, row) => sum + coerceAgorot(row.hmo_charge_amount), 0),
        payment_total: effectiveLedgerEntries(ledgerEntries)
          .filter((row) => normalizeDirection(row.direction) === 'CREDIT')
          .reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
        manual_adjustment_total: effectiveLedgerEntries(ledgerEntries)
          .filter((row) => normalizeString(row.source_type) === 'manual_adjustment')
          .reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
      },
      ledger_entries: ledgerEntries || [],
      lesson_history: lessonHistory,
      authorizations,
    };
  }

  async getClientBillingSnapshot({
    clientProfileId,
    startDate = null,
    endDate = null,
  }) {
    const normalizedClientProfileId = normalizeString(clientProfileId);
    if (!normalizedClientProfileId) {
      return {
        summary: { balance: 0, lesson_charge_total: 0, payment_total: 0 },
        ledger_entries: [],
        lesson_history: [],
      };
    }

    const balance = await this.getAccountBalance({ accountType: CLIENT_ACCOUNT_TYPE, accountRefId: normalizedClientProfileId });

    let ledgerQuery = this.tenantClient
      .from('ledger_transactions')
      .select('*')
      .eq('org_id', this.orgId)
      .eq('client_profile_id', normalizedClientProfileId)
      .is('student_id', null)
      .order('effective_at', { ascending: false })
      .order('posted_at', { ascending: false });

    if (normalizeString(startDate)) {
      ledgerQuery = ledgerQuery.gte('effective_at', `${startDate}T00:00:00.000Z`);
    }
    if (normalizeString(endDate)) {
      ledgerQuery = ledgerQuery.lte('effective_at', `${endDate}T23:59:59.999Z`);
    }

    const { data: ledgerEntries, error: ledgerError } = await ledgerQuery;
    if (ledgerError) {
      throw ledgerError;
    }

    const { data: participants, error: participantsError } = await this.tenantClient
      .from('lesson_participants')
      .select(`
        id,
        participant_status,
        client_profile_id,
        student_id,
        lesson_instance:lesson_instances!inner(
          id,
          datetime_start,
          service_id,
          status
        )
      `)
      .eq('org_id', this.orgId)
      .eq('client_profile_id', normalizedClientProfileId)
      .is('student_id', null)
      .order('lesson_instance(datetime_start)', { ascending: false });

    if (participantsError) {
      throw participantsError;
    }

    const participantIds = (participants || []).map((row) => row.id);
    const { data: lessonLedgerRows, error: lessonLedgerError } = participantIds.length > 0
      ? await this.tenantClient
        .from('ledger_transactions')
        .select('*')
        .eq('org_id', this.orgId)
        .in('lesson_participant_id', participantIds)
        .in('source_type', ['lesson_charge', 'reversal'])
      : { data: [], error: null };

    if (lessonLedgerError) {
      throw lessonLedgerError;
    }

    const lessonRowsByParticipant = groupBy(lessonLedgerRows || [], (row) => row.lesson_participant_id);
    const serviceMap = await loadServiceMap(
      this.tenantClient,
      this.orgId,
      (participants || []).map((row) => row?.lesson_instance?.service_id).filter(Boolean),
    );

    const lessonHistory = (participants || []).map((participant) => {
      const rows = lessonRowsByParticipant.get(participant.id) || [];
      const reversedIds = new Set(rows
        .filter((entry) => normalizeString(entry.source_type) === 'reversal' && entry.reverses_transaction_id)
        .map((entry) => entry.reverses_transaction_id));
      const activeRows = rows.filter((row) => normalizeString(row.source_type) === 'lesson_charge' && !reversedIds.has(row.id));
      const billedAmount = activeRows
        .filter((row) => row.client_profile_id === normalizedClientProfileId && normalizeDirection(row.direction) === 'DEBIT')
        .reduce((sum, row) => sum + coerceAgorot(row.amount), 0);
      return {
        id: participant.id,
        client_profile_id: normalizedClientProfileId,
        participant_status: participant.participant_status,
        lesson_instance_id: participant?.lesson_instance?.id || null,
        lesson_instance: participant.lesson_instance || null,
        service: serviceMap.get(participant?.lesson_instance?.service_id) || null,
        billed_amount: billedAmount,
        billing_status: billedAmount > 0 ? 'charged' : 'not_chargeable',
      };
    }).filter((row) => {
      const lessonDate = toDateKey(row?.lesson_instance?.datetime_start);
      if (normalizeString(startDate) && lessonDate && lessonDate < startDate) {
        return false;
      }
      if (normalizeString(endDate) && lessonDate && lessonDate > endDate) {
        return false;
      }
      return true;
    });

    return {
      summary: {
        balance: balance.balance,
        lesson_charge_total: lessonHistory.reduce((sum, row) => sum + coerceAgorot(row.billed_amount), 0),
        payment_total: effectiveLedgerEntries(ledgerEntries)
          .filter((row) => normalizeDirection(row.direction) === 'CREDIT')
          .reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
      },
      ledger_entries: ledgerEntries || [],
      lesson_history: lessonHistory,
    };
  }

  async getHmoProviderReceivablesSnapshot({
    hmoProviderId,
    periodStart = null,
    periodEnd = null,
  }) {
    const normalizedProviderId = normalizeString(hmoProviderId);
    if (!normalizedProviderId) {
      return {
        summary: { balance: 0, receivable_total: 0, payment_total: 0 },
        ledger_entries: [],
        invoice_batches: [],
      };
    }

    const balance = await this.getAccountBalance({ accountType: HMO_ACCOUNT_TYPE, accountRefId: normalizedProviderId });
    let ledgerQuery = this.tenantClient
      .from('ledger_transactions')
      .select('*')
      .eq('org_id', this.orgId)
      .eq('hmo_provider_id', normalizedProviderId)
      .order('effective_at', { ascending: false })
      .order('posted_at', { ascending: false });

    if (normalizeString(periodStart)) {
      ledgerQuery = ledgerQuery.gte('effective_at', `${periodStart}T00:00:00.000Z`);
    }
    if (normalizeString(periodEnd)) {
      ledgerQuery = ledgerQuery.lte('effective_at', `${periodEnd}T23:59:59.999Z`);
    }

    const [{ data: ledgerEntries, error: ledgerError }, { data: invoiceBatches, error: batchError }] = await Promise.all([
      ledgerQuery,
      this.tenantClient
        .from('hmo_invoice_batches')
        .select('*')
        .eq('org_id', this.orgId)
        .eq('hmo_provider_id', normalizedProviderId)
        .order('created_at', { ascending: false }),
    ]);

    if (ledgerError) {
      throw ledgerError;
    }
    if (batchError) {
      throw batchError;
    }

    return {
      summary: {
        balance: balance.balance,
        receivable_total: effectiveLedgerEntries(ledgerEntries)
          .filter((row) => normalizeDirection(row.direction) === 'DEBIT')
          .reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
        payment_total: effectiveLedgerEntries(ledgerEntries)
          .filter((row) => normalizeDirection(row.direction) === 'CREDIT')
          .reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
      },
      ledger_entries: ledgerEntries || [],
      invoice_batches: invoiceBatches || [],
    };
  }
}
