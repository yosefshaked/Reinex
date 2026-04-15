// @ts-check
/* eslint-env node */
import BillingLedgerService, { buildDesiredChargeDescriptors, resolveHmoSplitAmounts } from './BillingLedgerService.js';
import { loadFinancePolicies } from './employee-finance.js';
import { normalizeString } from './org-bff.js';
import { loadHmoAuthorizations, resolveActiveAuthorizationForStudentService } from './hmo.js';

export const BILLING_BREAKDOWN_VERSION = 3;

function buildBreakdown({
  participant,
  instance,
  detail,
  authorization = null,
  splitAmounts = null,
}) {
  const warning = Array.isArray(detail?.warnings) && detail.warnings.length > 0
    ? detail.warnings[0]
    : null;
  return {
    version: BILLING_BREAKDOWN_VERSION,
    participant_status: normalizeString(participant?.participant_status).toLowerCase() || null,
    lesson_status: normalizeString(instance?.status).toLowerCase() || null,
    lesson_date: instance?.datetime_start || null,
    billing_status: detail?.billingStatus || null,
    billing_reason: detail?.billingReason || warning || null,
    hmo_authorization_id: authorization?.id || null,
    hmo_provider_track_id: authorization?.provider_track_id || null,
    hmo_payment_mode: splitAmounts?.paymentMode || null,
    contracted_rate_amount: authorization?.contracted_rate_amount ?? null,
    student_charge_amount: splitAmounts?.studentCopayAmount ?? null,
    insurer_claim_amount: splitAmounts?.insurerClaimAmount ?? null,
    uses_track_pricing: splitAmounts?.usesTrackPricing === true,
  };
}

async function loadServiceForInstance(tenantClient, instance) {
  if (!instance?.service_id) {
    return null;
  }

  const { data, error } = await tenantClient
    .from('Services')
    .select('id, name, default_customer_charge_amount')
    .eq('id', instance.service_id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? {
      ...data,
      service_name: data.name || 'שירות',
    }
    : null;
}

export async function loadCommitmentsMap() {
  return new Map();
}

export async function buildBillingDecision({
  participant,
  instance,
  policies,
  tenantClient,
  service: providedService = null,
  authorization: providedAuthorization = null,
}) {
  const service = providedService || (tenantClient ? await loadServiceForInstance(tenantClient, instance) : null);
  const authorization = providedAuthorization || (participant?.student_id && tenantClient
    ? await resolveActiveAuthorizationForStudentService(tenantClient, {
      studentId: participant.student_id,
      serviceId: instance?.service_id,
      lessonDate: instance?.datetime_start,
    })
    : null);
  const detail = buildDesiredChargeDescriptors({
    participant,
    instance,
    service,
    authorization,
    policies,
  });
  const splitAmounts = authorization?.id ? resolveHmoSplitAmounts({ service, authorization }) : null;
  const studentEntry = detail.entries.find((entry) => entry.accountType === 'student' || entry.accountType === 'client_profile') || null;
  return {
    shouldCharge: detail.entries.length > 0,
    chargeAmount: studentEntry?.amount ?? splitAmounts?.studentCopayAmount ?? null,
    coverage: null,
    billingStatus: detail.billingStatus,
    billingReason: detail.billingReason,
    requiresAttention: detail.status === 'blocked',
    usageType: authorization?.id ? 'hmo_split' : 'standard',
    pricingBreakdown: buildBreakdown({ participant, instance, detail, authorization, splitAmounts }),
  };
}

export async function buildDirectClientBillingDecision({
  participant,
  instance,
  service,
  policies,
}) {
  const detail = buildDesiredChargeDescriptors({
    participant,
    instance,
    service,
    authorization: null,
    policies,
  });
  const primaryEntry = detail.entries[0] || null;
  return {
    shouldCharge: detail.entries.length > 0,
    chargeAmount: primaryEntry?.amount ?? null,
    coverage: null,
    billingStatus: detail.billingStatus,
    billingReason: detail.billingReason,
    requiresAttention: detail.status === 'blocked',
    usageType: 'standard',
    pricingBreakdown: buildBreakdown({ participant, instance, detail }),
  };
}

export async function assignLessonParticipantCommitment() {
  return { error: 'legacy_commitment_assignment_removed' };
}

export async function clearLessonParticipantCommitment() {
  return { error: 'legacy_commitment_assignment_removed' };
}

export async function createCommitmentTransfer() {
  return { error: 'legacy_commitment_transfers_removed' };
}

export async function reconcileStudentBilling(tenantClient, {
  studentId,
  actorUserId = null,
} = {}) {
  const normalizedStudentId = normalizeString(studentId);
  if (!normalizedStudentId) {
    return { error: 'missing_student_id' };
  }

  const { data: participants, error } = await tenantClient
    .from('lesson_participants')
    .select('lesson_instance_id')
    .eq('student_id', normalizedStudentId);

  if (error) {
    throw error;
  }

  const service = new BillingLedgerService({ tenantClient });
  const lessonInstanceIds = Array.from(new Set((participants || []).map((row) => row.lesson_instance_id).filter(Boolean)));
  for (const lessonInstanceId of lessonInstanceIds) {
    await service.syncLessonInstanceCharges({
      lessonInstanceId,
      actorUserId,
      reasonCode: 'manual_rebuild',
    });
  }

  return {
    student_id: normalizedStudentId,
    reconciled_instances: lessonInstanceIds.length,
  };
}

export async function fetchBillingSnapshot(tenantClient, {
  studentId = '',
  clientProfileId = '',
  startDate = '',
  endDate = '',
} = {}) {
  const service = new BillingLedgerService({ tenantClient });
  if (normalizeString(studentId)) {
    return service.getStudentBillingSnapshot({
      studentId,
      startDate: normalizeString(startDate) || null,
      endDate: normalizeString(endDate) || null,
    });
  }
  if (normalizeString(clientProfileId)) {
    return service.getClientBillingSnapshot({
      clientProfileId,
      startDate: normalizeString(startDate) || null,
      endDate: normalizeString(endDate) || null,
    });
  }

  const policies = await loadFinancePolicies(tenantClient);
  const { data: students, error } = await tenantClient
    .from('students')
    .select(`
      id,
      client_profile:client_profiles(
        id,
        first_name,
        middle_name,
        last_name
      )
    `)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    throw error;
  }

  const studentSummaries = [];
  for (const row of students || []) {
    const snapshot = await service.getStudentBillingSnapshot({
      studentId: row.id,
      startDate: normalizeString(startDate) || null,
      endDate: normalizeString(endDate) || null,
    });
    studentSummaries.push({
      student_id: row.id,
      student: snapshot.student || null,
      balance: snapshot.summary?.balance ?? 0,
      lesson_charge_total: snapshot.summary?.lesson_charge_total ?? 0,
      hmo_charge_total: snapshot.summary?.hmo_charge_total ?? 0,
      authorizations: await loadHmoAuthorizations(tenantClient, { studentId: row.id, activeOnly: true }),
    });
  }

  return {
    policies: {
      billing_consumption_policy: policies.billingConsumptionPolicy,
      instructor_earnings_policy: policies.instructorEarningsPolicy,
    },
    student_summaries: studentSummaries,
  };
}
