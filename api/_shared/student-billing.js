// @ts-check
/* eslint-env node */
import { randomUUID } from 'node:crypto';
import {
  fetchCommitmentsWithBalances,
  isYmdDate,
  loadFinancePolicies,
  toDateKey,
} from './employee-finance.js';
import { toAgorot, coerceAgorot } from './currency.js';
import {
  attachHmoContextToCommitments,
  ensureSystemManagedHmoCommitment,
  loadHmoAuthorizations,
  resolveActiveAuthorizationForStudentService,
} from './hmo.js';
import { normalizeString } from './org-bff.js';
import {
  buildCommitmentRuntime,
  computeCommitmentAttention,
  resolveCommitmentCoverage,
} from './commitment-behavior.js';
import { buildUtcBoundsForTimezoneDateRange } from './instructor-availability.js';

const COMMITMENT_TYPES = new Set(['package', 'subscription', 'hmo', 'manual_credit']);
const RESOLVED_PARTICIPANT_STATUSES = new Set(['attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);
const ACTIONABLE_BILLING_STATUSES = new Set([
  'pending_commitment',
  'pending_commitment_configuration',
  'invalid_commitment',
  'pending_service_default_charge_amount',
]);
export const BILLING_BREAKDOWN_VERSION = 1;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


function buildFullName(row) {
  return [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ').trim();
}

function normalizeCommitmentType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return COMMITMENT_TYPES.has(normalized) ? normalized : '';
}

function isCommitmentExpired(commitment, lessonDate) {
  const expiryDate = toDateKey(commitment?.expires_at);
  if (!expiryDate || !lessonDate) {
    return false;
  }
  return expiryDate < lessonDate;
}

async function loadStudentsMap(tenantClient, studentIds = []) {
  const ids = Array.from(new Set((studentIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('students')
    .select(`
      id,
      client_profile_id,
      special_rate,
      client_profile:client_profiles(
        id,
        first_name,
        middle_name,
        last_name,
        is_active
      )
    `)
    .in('id', ids);

  if (error) {
    if (error.code === '42P01') {
      return new Map();
    }
    throw error;
  }

  return new Map((data || []).map((row) => {
    const profile = row?.client_profile || {};
    return [row.id, {
      id: row.id,
      client_profile_id: row.client_profile_id || profile.id || null,
      special_rate: row.special_rate,
      is_active: profile.is_active !== false,
      first_name: profile.first_name || '',
      middle_name: profile.middle_name || null,
      last_name: profile.last_name || '',
      full_name: buildFullName(profile),
    }];
  }));
}

async function loadServicesMap(tenantClient, serviceIds = []) {
  const ids = Array.from(new Set((serviceIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('Services')
    .select('id, name, color, is_active, default_customer_charge_amount')
    .in('id', ids);

  if (error) {
    if (error.code === '42P01') {
      return new Map();
    }
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

export async function loadCommitmentsMap(tenantClient, commitmentIds = []) {
  const ids = Array.from(new Set((commitmentIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('commitments')
    .select('*')
    .in('id', ids);

  if (error) {
    if (error.code === '42P01') {
      return new Map();
    }
    throw error;
  }

  const { data: ledgerRows, error: ledgerError } = await tenantClient
    .from('ledger_transactions')
    .select('id, commitment_id, transaction_type, usage_type, amount, source_ref, metadata')
    .in('commitment_id', ids);

  if (ledgerError && ledgerError.code !== '42P01') {
    throw ledgerError;
  }

  const entriesByCommitment = new Map();
  for (const entry of ledgerRows || []) {
    if (!entriesByCommitment.has(entry.commitment_id)) {
      entriesByCommitment.set(entry.commitment_id, []);
    }
    entriesByCommitment.get(entry.commitment_id).push(entry);
  }

  const commitmentsWithHmoContext = await attachHmoContextToCommitments(tenantClient, data || []);

  return new Map(commitmentsWithHmoContext.map((row) => {
    const runtime = buildCommitmentRuntime(row, entriesByCommitment.get(row.id) || []);
    return [row.id, {
      ...row,
      runtime: {
        ...runtime,
        attention: computeCommitmentAttention(row, runtime),
      },
    }];
  }));
}

async function loadLessonInstancesForRange(tenantClient, { startDate = '', endDate = '' } = {}) {
  let query = tenantClient
    .from('lesson_instances')
    .select('id, datetime_start, duration_minutes, instructor_employee_id, service_id, status')
    .order('datetime_start', { ascending: false });

  const effectiveStartDate = startDate || endDate;
  const effectiveEndDate = endDate || startDate;
  const rangeBounds = effectiveStartDate && effectiveEndDate
    ? buildUtcBoundsForTimezoneDateRange(effectiveStartDate, effectiveEndDate)
    : null;
  if (startDate && rangeBounds?.startIso) {
    query = query.gte('datetime_start', rangeBounds.startIso);
  }
  if (endDate && rangeBounds?.endExclusiveIso) {
    query = query.lt('datetime_start', rangeBounds.endExclusiveIso);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  return data || [];
}

async function loadLessonInstancesByIds(tenantClient, lessonInstanceIds = []) {
  const ids = Array.from(new Set((lessonInstanceIds || []).map((id) => normalizeString(id)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('lesson_instances')
    .select('id, datetime_start, duration_minutes, instructor_employee_id, service_id, status')
    .in('id', ids);

  if (error) {
    if (error.code === '42P01') {
      return new Map();
    }
    throw error;
  }

  return new Map((data || []).map((row) => [row.id, row]));
}

export function buildBillingDecision({ participant, instance, commitment, policies, syncedAt = new Date().toISOString() }) {
  const participantStatus = normalizeString(participant?.participant_status).toLowerCase();
  const lessonStatus = normalizeString(instance?.status).toLowerCase();
  const lessonDate = toDateKey(instance?.datetime_start);
  const storedPricingBreakdown = isPlainObject(participant?.pricing_breakdown) ? participant.pricing_breakdown : null;
  const policyAllowsCharge = RESOLVED_PARTICIPANT_STATUSES.has(participantStatus)
    ? Boolean(policies?.billingConsumptionPolicy?.[participantStatus])
    : false;

  let billingStatus = 'pending_attendance';
  let billingReason = 'participant_not_resolved';
  let chargeAmount = null;
  let requiresAttention = false;
  let coverage = null;

  const shouldPreserveStoredCharge = Boolean(
    commitment?.id
    && policyAllowsCharge
    && storedPricingBreakdown?.billing_status === 'charged'
    && normalizeString(storedPricingBreakdown?.selected_commitment_id) === commitment.id
    && Number.isFinite(Number(participant?.price_charged)),
  );

  if (shouldPreserveStoredCharge) {
    const preservedChargeAmount = coerceAgorot(participant.price_charged);
    const preservedInsurerClaim = coerceAgorot(storedPricingBreakdown?.insurer_claim_amount);
    return {
      shouldCharge: true,
      chargeAmount: preservedChargeAmount,
      coverage: {
        eligible: true,
        covered_service_id: storedPricingBreakdown?.covered_service_id || instance?.service_id || null,
        student_charge_amount: preservedChargeAmount,
        insurer_claim_amount: preservedInsurerClaim,
        metadata: storedPricingBreakdown,
      },
      billingStatus: 'charged',
      billingReason: storedPricingBreakdown?.billing_reason || 'chargeable',
      requiresAttention: false,
      pricingBreakdown: {
        ...storedPricingBreakdown,
        synced_at: syncedAt,
        charge_amount: preservedChargeAmount,
        student_charge_amount: preservedChargeAmount,
        insurer_claim_amount: preservedInsurerClaim,
        billing_status: 'charged',
        policy_allowed: true,
        requires_attention: false,
      },
    };
  }

  if (!RESOLVED_PARTICIPANT_STATUSES.has(participantStatus)) {
    billingStatus = 'pending_attendance';
    billingReason = 'participant_not_resolved';
  } else if (!policyAllowsCharge) {
    billingStatus = 'not_chargeable';
    billingReason = participantStatus === 'cancelled_clinic'
      ? 'lesson_cancelled_by_clinic'
      : 'policy_excluded_status';
  } else if (!commitment) {
    billingStatus = 'pending_commitment';
    billingReason = 'missing_commitment';
    requiresAttention = true;
  } else if (commitment.student_id !== participant.student_id) {
    billingStatus = 'invalid_commitment';
    billingReason = 'commitment_belongs_to_different_student';
    requiresAttention = true;
  } else if (commitment.service_id && instance?.service_id && commitment.service_id !== instance.service_id) {
    billingStatus = 'invalid_commitment';
    billingReason = 'service_mismatch';
    requiresAttention = true;
  } else if (commitment.is_active === false) {
    billingStatus = 'invalid_commitment';
    billingReason = 'inactive_commitment';
    requiresAttention = true;
  } else if (isCommitmentExpired(commitment, lessonDate)) {
    billingStatus = 'invalid_commitment';
    billingReason = 'expired_commitment';
    requiresAttention = true;
  } else if (!(coverage = resolveCommitmentCoverage(commitment, instance?.service_id, commitment?.runtime || null)).eligible) {
    billingStatus = 'invalid_commitment';
    billingReason = coverage.code;
    requiresAttention = true;
  } else {
    billingStatus = 'charged';
    billingReason = 'chargeable';
    chargeAmount = coverage.student_charge_amount;
  }

  let usageType = 'standard';
  if (coverage?.metadata?.coverage_type === 'package_item') {
    const coveredServiceId = normalizeString(coverage?.covered_service_id);
    const lessonServiceId = normalizeString(instance?.service_id);
    if (coveredServiceId && lessonServiceId && coveredServiceId !== lessonServiceId) {
      usageType = 'cross_service';
    }
  }

  return {
    shouldCharge: chargeAmount != null,
    chargeAmount,
    coverage,
    billingStatus,
    billingReason,
    requiresAttention,
    usageType,
    pricingBreakdown: {
      version: BILLING_BREAKDOWN_VERSION,
      synced_at: syncedAt,
      policy_snapshot: {
        billing_consumption_policy: policies?.billingConsumptionPolicy || null,
        instructor_earnings_policy: policies?.instructorEarningsPolicy || null,
      },
      lesson_status: lessonStatus || null,
      lesson_date: lessonDate || null,
      participant_status: participantStatus || null,
      selected_commitment_id: commitment?.id || null,
      selected_commitment_type: commitment?.commitment_type || null,
      selected_commitment_service_id: commitment?.service_id || null,
      selected_commitment_active: commitment ? commitment.is_active !== false : null,
      selected_commitment_expires_at: commitment?.expires_at || null,
      default_charge_amount: commitment?.runtime?.default_charge_amount ?? null,
      charge_amount: chargeAmount,
      covered_service_id: coverage?.covered_service_id || null,
      student_charge_amount: coverage?.student_charge_amount ?? null,
      insurer_claim_amount: coverage?.insurer_claim_amount ?? null,
      billing_status: billingStatus,
      billing_reason: billingReason,
      policy_allowed: policyAllowsCharge,
      requires_attention: requiresAttention,
      usage_type: usageType,
    },
  };
}

export function buildDirectClientBillingDecision({
  participant,
  instance,
  service,
  policies,
  syncedAt = new Date().toISOString(),
}) {
  const participantStatus = normalizeString(participant?.participant_status).toLowerCase();
  const lessonStatus = normalizeString(instance?.status).toLowerCase();
  const lessonDate = toDateKey(instance?.datetime_start);
  const storedPricingBreakdown = isPlainObject(participant?.pricing_breakdown) ? participant.pricing_breakdown : null;
  const policyAllowsCharge = RESOLVED_PARTICIPANT_STATUSES.has(participantStatus)
    ? Boolean(policies?.billingConsumptionPolicy?.[participantStatus])
    : false;

  const shouldPreserveStoredCharge = Boolean(
    policyAllowsCharge
    && storedPricingBreakdown?.billing_status === 'charged'
    && storedPricingBreakdown?.billing_mode === 'direct_client'
    && Number.isFinite(Number(participant?.price_charged))
  );

  if (shouldPreserveStoredCharge) {
    const preservedChargeAmount = coerceAgorot(participant.price_charged);
    return {
      shouldCharge: true,
      chargeAmount: preservedChargeAmount,
      coverage: {
        eligible: true,
        covered_service_id: instance?.service_id || null,
        student_charge_amount: preservedChargeAmount,
        insurer_claim_amount: 0,
        metadata: storedPricingBreakdown,
      },
      billingStatus: 'charged',
      billingReason: storedPricingBreakdown?.billing_reason || 'direct_client_charge',
      requiresAttention: false,
      usageType: 'standard',
      pricingBreakdown: {
        ...storedPricingBreakdown,
        synced_at: syncedAt,
        lesson_date: lessonDate || null,
        charge_amount: preservedChargeAmount,
        student_charge_amount: preservedChargeAmount,
        insurer_claim_amount: 0,
        billing_status: 'charged',
        billing_reason: storedPricingBreakdown?.billing_reason || 'direct_client_charge',
        policy_allowed: true,
        requires_attention: false,
        billing_mode: 'direct_client',
      },
    };
  }

  let billingStatus = 'pending_attendance';
  let billingReason = 'participant_not_resolved';
  let chargeAmount = null;
  let requiresAttention = false;
  const directClientChargeOverride = Number.isFinite(Number(participant?.metadata?.direct_client_charge_amount_override))
    ? coerceAgorot(participant.metadata.direct_client_charge_amount_override)
    : null;

  if (!RESOLVED_PARTICIPANT_STATUSES.has(participantStatus)) {
    billingStatus = 'pending_attendance';
    billingReason = 'participant_not_resolved';
  } else if (!policyAllowsCharge) {
    billingStatus = 'not_chargeable';
    billingReason = participantStatus === 'cancelled_clinic'
      ? 'lesson_cancelled_by_clinic'
      : 'policy_excluded_status';
  } else if (Number.isFinite(Number(directClientChargeOverride))) {
    billingStatus = 'charged';
    billingReason = 'direct_client_charge';
    chargeAmount = directClientChargeOverride;
  } else if (!Number.isFinite(Number(service?.default_customer_charge_amount))) {
    billingStatus = 'pending_service_default_charge_amount';
    billingReason = 'missing_service_default_customer_charge_amount';
    requiresAttention = true;
  } else {
    billingStatus = 'charged';
    billingReason = 'direct_client_charge';
    chargeAmount = coerceAgorot(service.default_customer_charge_amount);
  }

  return {
    shouldCharge: chargeAmount != null,
    chargeAmount,
    coverage: chargeAmount != null
      ? {
          eligible: true,
          covered_service_id: instance?.service_id || null,
          student_charge_amount: chargeAmount,
          insurer_claim_amount: 0,
          metadata: null,
        }
      : null,
    billingStatus,
    billingReason,
    requiresAttention,
    usageType: 'standard',
    pricingBreakdown: {
      version: BILLING_BREAKDOWN_VERSION,
      synced_at: syncedAt,
      policy_snapshot: {
        billing_consumption_policy: policies?.billingConsumptionPolicy || null,
        instructor_earnings_policy: policies?.instructorEarningsPolicy || null,
      },
      lesson_status: lessonStatus || null,
      lesson_date: lessonDate || null,
      participant_status: participantStatus || null,
      selected_commitment_id: null,
      selected_commitment_type: null,
      selected_commitment_service_id: null,
      selected_commitment_active: null,
      selected_commitment_expires_at: null,
      default_charge_amount: directClientChargeOverride ?? service?.default_customer_charge_amount ?? null,
      direct_client_charge_amount_override: directClientChargeOverride,
      charge_amount: chargeAmount,
      covered_service_id: instance?.service_id || null,
      student_charge_amount: chargeAmount,
      insurer_claim_amount: null,
      billing_status: billingStatus,
      billing_reason: billingReason,
      policy_allowed: policyAllowsCharge,
      requires_attention: requiresAttention,
      usage_type: 'standard',
      billing_mode: 'direct_client',
    },
  };
}

function enrichCommitment(commitment, studentMap, serviceMap) {
  return {
    ...commitment,
    student: studentMap.get(commitment.student_id) || null,
    service: serviceMap.get(commitment.service_id) || null,
    attention: commitment?.runtime?.attention || computeCommitmentAttention(commitment, commitment?.runtime || null),
  };
}

async function fetchLessonBillingHistory(tenantClient, {
  studentId = '',
  startDate = '',
  endDate = '',
  policies,
  commitmentBalanceMap = new Map(),
} = {}) {
  let instanceMap = new Map();
  let scopedInstanceIds = [];

  if (startDate || endDate || !studentId) {
    const scopedInstances = await loadLessonInstancesForRange(tenantClient, { startDate, endDate });
    instanceMap = new Map(scopedInstances.map((row) => [row.id, row]));
    scopedInstanceIds = scopedInstances.map((row) => row.id);
    if (scopedInstanceIds.length === 0) {
      return [];
    }
  }

  let query = tenantClient
    .from('lesson_participants')
    .select('id, lesson_instance_id, student_id, participant_status, price_charged, pricing_breakdown, commitment_id, attendance_confirmed_at, attendance_confirmed_by, metadata');

  if (studentId) {
    query = query.eq('student_id', studentId);
  }
  if (scopedInstanceIds.length > 0) {
    query = query.in('lesson_instance_id', scopedInstanceIds);
  }

  const { data: participants, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  const participantRows = participants || [];
  if (participantRows.length === 0) {
    return [];
  }

  if (instanceMap.size === 0) {
    instanceMap = await loadLessonInstancesByIds(tenantClient, participantRows.map((row) => row.lesson_instance_id));
  }

  const missingCommitmentIds = participantRows
    .map((row) => row.commitment_id)
    .filter((id) => id && !commitmentBalanceMap.has(id));

  const missingCommitmentsMap = await loadCommitmentsMap(tenantClient, missingCommitmentIds);
  const commitmentMap = new Map(commitmentBalanceMap);
  for (const [id, value] of missingCommitmentsMap.entries()) {
    commitmentMap.set(id, value);
  }

  const studentIds = participantRows.map((row) => row.student_id);
  const serviceIds = [];
  for (const instance of instanceMap.values()) {
    if (instance?.service_id) {
      serviceIds.push(instance.service_id);
    }
  }
  for (const commitment of commitmentMap.values()) {
    if (commitment?.service_id) {
      serviceIds.push(commitment.service_id);
    }
    if (commitment?.student_id) {
      studentIds.push(commitment.student_id);
    }
  }

  const [studentMap, serviceMap] = await Promise.all([
    loadStudentsMap(tenantClient, studentIds),
    loadServicesMap(tenantClient, serviceIds),
  ]);

  return participantRows
    .map((participant) => {
      const instance = instanceMap.get(participant.lesson_instance_id) || null;
      if (!instance) {
        return null;
      }

      const storedCommitment = participant.commitment_id
        ? commitmentMap.get(participant.commitment_id) || null
        : null;
      const resolvedCommitment = storedCommitment
        ? enrichCommitment(storedCommitment, studentMap, serviceMap)
        : null;
      const decision = buildBillingDecision({
        participant,
        instance,
        commitment: storedCommitment,
        policies,
      });

      return {
        id: participant.id,
        lesson_participant_id: participant.id,
        lesson_instance_id: participant.lesson_instance_id,
        lesson_date: toDateKey(instance.datetime_start),
        student_id: participant.student_id,
        student: studentMap.get(participant.student_id) || null,
        lesson_instance: instance,
        service: serviceMap.get(instance.service_id) || null,
        participant_status: participant.participant_status,
        attendance_confirmed_at: participant.attendance_confirmed_at || null,
        commitment_id: participant.commitment_id || null,
        commitment: resolvedCommitment,
        price_charged: participant.price_charged,
        resolved_charge_amount: decision.chargeAmount,
        pricing_breakdown: decision.pricingBreakdown,
        stored_pricing_breakdown: isPlainObject(participant.pricing_breakdown) ? participant.pricing_breakdown : null,
        billing_status: decision.billingStatus,
        billing_reason: decision.billingReason,
        requires_attention: decision.requiresAttention,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftDate = left.lesson_instance?.datetime_start || '';
      const rightDate = right.lesson_instance?.datetime_start || '';
      return rightDate.localeCompare(leftDate);
    });
}

async function fetchBillingEntries(tenantClient, { studentId = '', commitmentBalanceMap = new Map() } = {}) {
  let query = tenantClient
    .from('ledger_transactions')
    .select('id, client_profile_id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, invoice_id, invoice_link, notes, created_at, updated_at, metadata')
    .order('created_at', { ascending: false });

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  const rows = data || [];
  if (rows.length === 0) {
    return [];
  }

  const missingCommitmentIds = rows
    .map((row) => row.commitment_id)
    .filter((id) => id && !commitmentBalanceMap.has(id));
  const missingCommitmentsMap = await loadCommitmentsMap(tenantClient, missingCommitmentIds);

  const combinedCommitmentMap = new Map(commitmentBalanceMap);
  for (const [id, value] of missingCommitmentsMap.entries()) {
    combinedCommitmentMap.set(id, value);
  }

  const studentIds = rows.map((row) => row.student_id);
  const serviceIds = [];
  for (const commitment of combinedCommitmentMap.values()) {
    if (commitment?.student_id) {
      studentIds.push(commitment.student_id);
    }
    if (commitment?.service_id) {
      serviceIds.push(commitment.service_id);
    }
  }

  const [studentMap, serviceMap] = await Promise.all([
    loadStudentsMap(tenantClient, studentIds),
    loadServicesMap(tenantClient, serviceIds),
  ]);

  return rows.map((entry) => {
    const rawCommitment = entry.commitment_id
      ? combinedCommitmentMap.get(entry.commitment_id) || null
      : null;
    const commitment = rawCommitment
      ? enrichCommitment(rawCommitment, studentMap, serviceMap)
      : null;

    return {
      ...entry,
      effective_date: entry.metadata?.effective_date || null,
      transfer_ref: entry.metadata?.transfer_ref || null,
      source_type: entry.metadata?.original_source_type || (entry.transaction_type === 'CREDIT' ? 'credit' : entry.usage_type),
      amount_charged: entry.transaction_type === 'CREDIT' ? -entry.amount : entry.amount,
      invoice_id: entry.invoice_id || null,
      invoice_link: entry.invoice_link || null,
      student: studentMap.get(entry.student_id) || null,
      commitment,
    };
  });
}

function buildTransferGroups({ commitments = [], entries = [], studentId = '' } = {}) {
  const groups = new Map();

  for (const entry of entries) {
    const transferRef = entry?.transfer_ref || entry?.metadata?.transfer_ref;
    if (!transferRef) {
      continue;
    }

    groups.set(transferRef, {
      transfer_ref: transferRef,
      source_entry: entry,
      target_commitments: [],
      created_at: entry.effective_date || entry.metadata?.effective_date || entry.created_at || null,
      amount: coerceAgorot(entry.amount_charged ?? entry.amount),
    });
  }

  for (const commitment of commitments) {
    if (!commitment?.transfer_ref) {
      continue;
    }

    const existing = groups.get(commitment.transfer_ref) || {
      transfer_ref: commitment.transfer_ref,
      source_entry: null,
      target_commitments: [],
      created_at: commitment.created_at || null,
      amount: coerceAgorot(commitment.total_amount),
    };

    existing.target_commitments.push(commitment);
    if (!existing.created_at) {
      existing.created_at = commitment.created_at || null;
    }
    groups.set(commitment.transfer_ref, existing);
  }

  return Array.from(groups.values())
    .filter((group) => {
      if (!studentId) {
        return true;
      }
      const sourceMatches = group.source_entry?.student_id === studentId;
      const targetMatches = group.target_commitments.some((commitment) => commitment.student_id === studentId);
      return sourceMatches || targetMatches;
    })
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
}

function buildSnapshotSummary({ commitments = [], billingQueue = [], lessonHistory = [], entries = [], transfers = [] } = {}) {
  const totalCommitted = commitments.reduce((sum, row) => sum + coerceAgorot(row.total_amount), 0);
  const totalConsumed  = commitments.reduce((sum, row) => sum + coerceAgorot(row.consumed_amount), 0);
  const totalRemaining = commitments.reduce((sum, row) => sum + coerceAgorot(row.remaining_amount), 0);
  const activeCommitments = commitments.filter((row) => row.is_active !== false);
  const lowBalanceCount = commitments.filter((row) => row.attention?.low_balance).length;
  const expiringSoonCount = commitments.filter((row) => row.attention?.expiring_soon).length;
  const manualEntryCount = entries.filter((row) => row.usage_type === 'manual_adjustment' || row.usage_type === 'manual_topup' || row.source_type === 'adjustment').length;
  const studentChargedAmount = lessonHistory.reduce(
    (sum, row) => sum + coerceAgorot(row?.pricing_breakdown?.student_charge_amount ?? row?.resolved_charge_amount ?? row?.price_charged),
    0,
  );
  const insurerClaimAmount = lessonHistory.reduce(
    (sum, row) => sum + coerceAgorot(row?.pricing_breakdown?.insurer_claim_amount),
    0,
  );
  const pendingInsurerClaimAmount = commitments.reduce(
    (sum, row) => sum + coerceAgorot(row?.runtime?.hmo?.pending_claim_amount),
    0,
  );

  return {
    total_committed: totalCommitted,
    total_consumed: totalConsumed,
    total_remaining: totalRemaining,
    active_commitments_count: activeCommitments.length,
    pending_queue_count: billingQueue.length,
    lesson_history_count: lessonHistory.length,
    manual_entry_count: manualEntryCount,
    transfer_count: transfers.length,
    low_balance_commitments_count: lowBalanceCount,
    expiring_soon_commitments_count: expiringSoonCount,
    student_charged_amount: studentChargedAmount,
    insurer_claim_amount: insurerClaimAmount,
    pending_insurer_claim_amount: pendingInsurerClaimAmount,
  };
}

async function loadParticipantWithInstance(tenantClient, lessonParticipantId) {
  const { data, error } = await tenantClient
    .from('lesson_participants')
    .select('id, lesson_instance_id, client_profile_id, student_id, participant_status, price_charged, pricing_breakdown, commitment_id')
    .eq('id', lessonParticipantId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  const instanceMap = await loadLessonInstancesByIds(tenantClient, [data.lesson_instance_id]);
  return {
    ...data,
    lesson_instance: instanceMap.get(data.lesson_instance_id) || null,
  };
}


async function resolveParticipantCommitmentForSync(tenantClient, {
  participant,
  instance,
  commitmentMap,
  actorUserId = null,
} = {}) {
  let commitment = participant?.commitment_id
    ? commitmentMap.get(participant.commitment_id) || null
    : null;

  if (commitment) {
    return commitment;
  }

  const authorization = await resolveActiveAuthorizationForStudentService(tenantClient, {
    studentId: participant?.student_id,
    serviceId: instance?.service_id,
    lessonDate: instance?.datetime_start,
  });

  if (!authorization) {
    return null;
  }

  const linkedCommitment = await ensureSystemManagedHmoCommitment(tenantClient, authorization, actorUserId);
  if (!linkedCommitment?.id) {
    return null;
  }

  const refreshedCommitmentMap = await loadCommitmentsMap(tenantClient, [linkedCommitment.id]);
  const resolvedCommitment = refreshedCommitmentMap.get(linkedCommitment.id) || null;
  if (!resolvedCommitment) {
    return null;
  }

  commitmentMap.set(resolvedCommitment.id, resolvedCommitment);

  const { error: participantUpdateError } = await tenantClient
    .from('lesson_participants')
    .update({
      commitment_id: resolvedCommitment.id,
      pricing_breakdown: null,
      price_charged: null,
    })
    .eq('id', participant.id)
    .is('commitment_id', null);

  if (participantUpdateError && participantUpdateError.code !== '42P01') {
    throw participantUpdateError;
  }

  participant.commitment_id = resolvedCommitment.id;
  return resolvedCommitment;
}

export async function syncLessonBillingArtifacts(tenantClient, lessonInstanceId, actorUserId = null) {
  if (!lessonInstanceId) {
    return null;
  }

  const instanceMap = await loadLessonInstancesByIds(tenantClient, [lessonInstanceId]);
  const instance = instanceMap.get(lessonInstanceId) || null;
  if (!instance) {
    return null;
  }

  const { data: participants, error: participantsError } = await tenantClient
    .from('lesson_participants')
    .select('id, lesson_instance_id, client_profile_id, student_id, participant_status, price_charged, pricing_breakdown, commitment_id, attendance_confirmed_at, metadata')
    .eq('lesson_instance_id', lessonInstanceId);

  if (participantsError) {
    throw participantsError;
  }

  const policies = await loadFinancePolicies(tenantClient);
  const commitmentIds = Array.from(new Set((participants || []).map((row) => row.commitment_id).filter(Boolean)));
  const commitmentMap = await loadCommitmentsMap(tenantClient, commitmentIds);
  const serviceMap = await loadServicesMap(tenantClient, [instance.service_id]);
  const instanceService = serviceMap.get(instance.service_id) || null;
  const syncedAt = new Date().toISOString();
  let updatedParticipants = 0;
  const attentionRequired = [];
  // batchEntries is sent in one RPC call for atomic ledger + price_charged + pricing_breakdown
  const batchEntries = [];
  // attendanceUpdates is a separate non-critical pass (idempotent, not part of billing atomicity)
  const attendanceUpdates = [];

  // Phase 1: resolve commitments and build billing decisions (read-only except commitment assignment)
  for (const participant of participants || []) {
    const commitment = await resolveParticipantCommitmentForSync(tenantClient, {
      participant,
      instance,
      commitmentMap,
      actorUserId,
    });
    const decision = participant?.student_id
      ? buildBillingDecision({
          participant,
          instance,
          commitment: commitment || null,
          policies,
          syncedAt,
        })
      : buildDirectClientBillingDecision({
          participant,
          instance,
          service: instanceService,
          policies,
          syncedAt,
        });

    // Amount is already in agorot (read from DB). The RPC casts it to integer.
    batchEntries.push({
      participant_id:    participant.id,
      client_profile_id: participant.client_profile_id || null,
      student_id:        participant.student_id || null,
      commitment_id:     commitment?.id || null,
      should_charge:     decision.shouldCharge,
      transaction_type:  'DEBIT',
      usage_type:        decision.usageType || 'standard',
      amount:            decision.chargeAmount ?? 0,
      source_ref:        participant.id,
      // lesson_entry_id is omitted; the ledger entry is always findable via source_ref = participant_id
      pricing_breakdown: decision.pricingBreakdown || null,
      notes:             null,
    });

    if (participant.participant_status !== 'scheduled') {
      attendanceUpdates.push({
        id:                     participant.id,
        attendance_confirmed_at: participant.attendance_confirmed_at || syncedAt,
        attendance_confirmed_by: actorUserId || null,
      });
    }

    if (decision.requiresAttention) {
      const pStatus = normalizeString(participant.participant_status).toLowerCase();
      if (RESOLVED_PARTICIPANT_STATUSES.has(pStatus)) {
        attentionRequired.push({
          participant_id:   participant.id,
          client_profile_id: participant.client_profile_id || null,
          student_id:        participant.student_id,
          billing_status:    decision.billingStatus,
          billing_reason:    decision.billingReason,
        });
      }
    }
  }

  // Phase 2: atomically write ledger entries + price_charged + pricing_breakdown via RPC
  if (batchEntries.length > 0) {
    const { data: rpcResult, error: rpcError } = await tenantClient.rpc(
      'batch_sync_lesson_ledger_entries',
      {
        p_lesson_instance_id: lessonInstanceId,
        p_actor_user_id:      actorUserId || null,
        p_entries:            batchEntries,
      },
    );
    if (rpcError) {
      throw rpcError;
    }
    updatedParticipants = rpcResult?.updated ?? batchEntries.length;
  }

  // Phase 3: update attendance confirmation fields (non-atomic — idempotent and safe to retry)
  for (const upd of attendanceUpdates) {
    await tenantClient
      .from('lesson_participants')
      .update({
        attendance_confirmed_at: upd.attendance_confirmed_at,
        attendance_confirmed_by: upd.attendance_confirmed_by,
      })
      .eq('id', upd.id);
  }

  return {
    lesson_instance_id:  lessonInstanceId,
    billing_synced:      true,
    updated_participants: updatedParticipants,
    attention_required:  attentionRequired,
  };
}

export async function assignLessonParticipantCommitment(tenantClient, {
  lessonParticipantId,
  commitmentId,
  actorUserId = null,
} = {}) {
  const participant = await loadParticipantWithInstance(tenantClient, lessonParticipantId);
  if (!participant) {
    return { error: 'lesson_participant_not_found' };
  }

  const commitmentMap = await loadCommitmentsMap(tenantClient, [commitmentId]);
  const commitment = commitmentMap.get(commitmentId) || null;
  if (!commitment) {
    return { error: 'commitment_not_found' };
  }

  const lessonDate = toDateKey(participant.lesson_instance?.datetime_start);
  if (commitment.student_id !== participant.student_id) {
    return { error: 'commitment_belongs_to_different_student' };
  }
  if (commitment.is_active === false) {
    return { error: 'commitment_inactive' };
  }
  if (isCommitmentExpired(commitment, lessonDate)) {
    return { error: 'commitment_expired' };
  }
  const coverage = resolveCommitmentCoverage(commitment, participant.lesson_instance?.service_id, commitment?.runtime || null);
  if (!coverage.eligible) {
    return { error: coverage.code === 'service_mismatch' ? 'commitment_service_mismatch' : coverage.code };
  }

  const { error: updateError } = await tenantClient
    .from('lesson_participants')
    .update({
      commitment_id: commitment.id,
      pricing_breakdown: null,
      price_charged: null,
    })
    .eq('id', lessonParticipantId);

  if (updateError) {
    throw updateError;
  }

  await syncLessonBillingArtifacts(tenantClient, participant.lesson_instance_id, actorUserId);
  const refreshed = await loadParticipantWithInstance(tenantClient, lessonParticipantId);
  return { participant: refreshed };
}

export async function clearLessonParticipantCommitment(tenantClient, {
  lessonParticipantId,
  actorUserId = null,
} = {}) {
  const participant = await loadParticipantWithInstance(tenantClient, lessonParticipantId);
  if (!participant) {
    return { error: 'lesson_participant_not_found' };
  }

  const { error: updateError } = await tenantClient
    .from('lesson_participants')
    .update({
      commitment_id: null,
      pricing_breakdown: null,
      price_charged: null,
    })
    .eq('id', lessonParticipantId);

  if (updateError) {
    throw updateError;
  }

  await syncLessonBillingArtifacts(tenantClient, participant.lesson_instance_id, actorUserId);
  const refreshed = await loadParticipantWithInstance(tenantClient, lessonParticipantId);
  return { participant: refreshed };
}

/**
 * Transfer a balance from one commitment to a new target commitment.
 * All three DB operations (new commitment + source DEBIT + target CREDIT)
 * execute inside a single Postgres transaction via the atomic RPC.
 *
 * @param {object} tenantClient - Supabase client
 * @param {object} params
 * @param {string} params.sourceCommitmentId
 * @param {number} params.amount - transfer amount in shekel (converted to agorot internally)
 * @param {string} [params.targetStudentId]
 * @param {string} [params.targetServiceId]
 * @param {string} [params.targetCommitmentType]
 * @param {number|null} [params.targetDefaultChargeAmount] - in shekel
 * @param {string|null} [params.expiresAt]
 * @param {string} [params.notes]
 * @param {string|null} [params.actorUserId]
 */
export async function createCommitmentTransfer(tenantClient, {
  sourceCommitmentId,
  amount,
  targetStudentId = '',
  targetServiceId = '',
  targetCommitmentType = '',
  targetDefaultChargeAmount = null,
  expiresAt = null,
  notes = '',
  actorUserId = null,
} = {}) {
  const normalizedSourceCommitmentId = normalizeString(sourceCommitmentId);
  const sourceCommitmentMap = await loadCommitmentsMap(tenantClient, [normalizedSourceCommitmentId]);
  const sourceCommitment = sourceCommitmentMap.get(normalizedSourceCommitmentId) || null;

  if (!sourceCommitment) {
    return { error: 'source_commitment_not_found' };
  }

  const sourceCommitments = await fetchCommitmentsWithBalances(tenantClient, { studentId: sourceCommitment.student_id });
  const sourceWithBalance = sourceCommitments.find((row) => row.id === normalizedSourceCommitmentId) || null;
  if (!sourceWithBalance) {
    return { error: 'source_commitment_not_found' };
  }

  // Convert shekel input to agorot for all comparisons and DB writes
  const transferAmountAgorot = toAgorot(amount);
  if (transferAmountAgorot <= 0) {
    return { error: 'invalid_transfer_amount' };
  }
  const remainingAgorot = coerceAgorot(sourceWithBalance.remaining_amount, 0);
  if (transferAmountAgorot > remainingAgorot) {
    return { error: 'transfer_amount_exceeds_remaining_balance' };
  }

  const transferRef = randomUUID();
  const targetStudent = normalizeString(targetStudentId) || sourceCommitment.student_id;
  const targetService = normalizeString(targetServiceId) || sourceCommitment.service_id;
  const normalizedCommitmentType = normalizeCommitmentType(targetCommitmentType) || 'manual_credit';

  // default_charge_amount: prefer explicit override (shekel → agorot), fall back to source
  const resolvedDefaultChargeAgorot =
    targetDefaultChargeAmount === null || targetDefaultChargeAmount === ''
      ? (sourceCommitment.default_charge_amount ?? 0)  // already agorot in DB
      : toAgorot(targetDefaultChargeAmount);

  const resolvedExpiresAt = normalizeString(expiresAt) || sourceCommitment.expires_at || null;
  const trimmedNotes = normalizeString(notes) || null;

  if (!targetStudent) {
    return { error: 'missing_target_student_id' };
  }
  if (!targetService) {
    return { error: 'missing_target_service_id' };
  }
  if (normalizedCommitmentType === 'hmo') {
    return { error: 'hmo_commitments_managed_via_authorizations' };
  }
  if (resolvedDefaultChargeAgorot < 0) {
    return { error: 'invalid_target_default_charge_amount' };
  }

  const { data: rpcResult, error: rpcError } = await tenantClient.rpc(
    'create_commitment_transfer_atomic',
    {
      p_source_commitment_id:   normalizedSourceCommitmentId,
      p_transfer_amount:        transferAmountAgorot,
      p_transfer_ref:           transferRef,
      p_target_student_id:      targetStudent,
      p_target_service_id:      targetService,
      p_target_commitment_type: normalizedCommitmentType,
      p_target_default_charge:  resolvedDefaultChargeAgorot,
      p_target_expires_at:      resolvedExpiresAt,
      p_target_notes:           trimmedNotes,
      p_actor_user_id:          actorUserId || null,
    },
  );

  if (rpcError) {
    // Map Postgres RAISE EXCEPTION messages to structured error codes
    const msg = rpcError.message || '';
    if (msg.includes('source_commitment_not_found')) return { error: 'source_commitment_not_found' };
    if (msg.includes('target_student_not_found'))    return { error: 'target_student_not_found' };
    if (msg.includes('invalid_transfer_amount'))     return { error: 'invalid_transfer_amount' };
    if (msg.includes('invalid_commitment_type'))     return { error: 'invalid_commitment_type' };
    throw rpcError;
  }

  return {
    transfer_ref:           transferRef,
    target_commitment_id:  rpcResult?.target_commitment_id || null,
    source_debit_id:        rpcResult?.source_debit_id || null,
    target_credit_id:       rpcResult?.target_credit_id || null,
    effective_date:         toDateKey(new Date()),
  };
}

export async function reconcileStudentBilling(tenantClient, {
  studentId,
  startDate = '',
  endDate = '',
  actorUserId = null,
} = {}) {
  const normalizedStudentId = normalizeString(studentId);
  if (!normalizedStudentId) {
    return { error: 'missing_student_id' };
  }

  const normalizedStartDate = isYmdDate(startDate) ? startDate : '';
  const normalizedEndDate = isYmdDate(endDate) ? endDate : '';
  const history = await fetchLessonBillingHistory(tenantClient, {
    studentId: normalizedStudentId,
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
    policies: await loadFinancePolicies(tenantClient),
  });

  const lessonInstanceIds = Array.from(new Set(history.map((row) => row.lesson_instance_id).filter(Boolean)));
  for (const lessonInstanceId of lessonInstanceIds) {
    await syncLessonBillingArtifacts(tenantClient, lessonInstanceId, actorUserId);
  }

  return {
    student_id: normalizedStudentId,
    reconciled_instances: lessonInstanceIds.length,
  };
}

export async function fetchBillingSnapshot(tenantClient, {
  studentId = '',
  startDate = '',
  endDate = '',
} = {}) {
  const normalizedStudentId = normalizeString(studentId);
  const normalizedStartDate = isYmdDate(startDate) ? startDate : '';
  const normalizedEndDate = isYmdDate(endDate) ? endDate : '';
  const policies = await loadFinancePolicies(tenantClient);
  const rawCommitments = await fetchCommitmentsWithBalances(tenantClient, {
    studentId: normalizedStudentId,
  });

  const studentIds = rawCommitments.map((row) => row.student_id);
  const serviceIds = rawCommitments.map((row) => row.service_id);
  const [studentMap, serviceMap] = await Promise.all([
    loadStudentsMap(tenantClient, studentIds),
    loadServicesMap(tenantClient, serviceIds),
  ]);

  const commitments = rawCommitments.map((row) => enrichCommitment(row, studentMap, serviceMap));
  const commitmentBalanceMap = new Map(commitments.map((row) => [row.id, row]));

  const [lessonHistory, allEntries, hmoAuthorizations] = await Promise.all([
    fetchLessonBillingHistory(tenantClient, {
      studentId: normalizedStudentId,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      policies,
      commitmentBalanceMap,
    }),
    fetchBillingEntries(tenantClient, {
      studentId: normalizedStudentId,
      commitmentBalanceMap,
    }),
    normalizedStudentId
      ? loadHmoAuthorizations(tenantClient, { studentId: normalizedStudentId })
      : Promise.resolve([]),
  ]);

  const LESSON_DEBIT_TYPES = new Set(['standard', 'double', 'cross_service']);

  const filteredEntries = allEntries.filter((entry) => {
    const dateKey = toDateKey(entry.effective_date || entry.metadata?.effective_date || entry.created_at);
    if (normalizedStartDate && dateKey < normalizedStartDate) {
      return false;
    }
    if (normalizedEndDate && dateKey > normalizedEndDate) {
      return false;
    }
    return true;
  });

  const billingQueue = lessonHistory.filter((row) => ACTIONABLE_BILLING_STATUSES.has(row.billing_status));
  const manualEntries = filteredEntries.filter((row) => !LESSON_DEBIT_TYPES.has(row.usage_type));
  const transfers = buildTransferGroups({
    commitments,
    entries: manualEntries,
    studentId: normalizedStudentId,
  });
  const summary = buildSnapshotSummary({
    commitments,
    billingQueue,
    lessonHistory,
    entries: manualEntries,
    transfers,
  });

  return {
    summary,
    policies: {
      billing_consumption_policy: policies.billingConsumptionPolicy,
    },
    commitments,
    hmo_authorizations: hmoAuthorizations,
    billing_queue: billingQueue,
    lesson_history: lessonHistory,
    entries: manualEntries,
    transfers,
  };
}
