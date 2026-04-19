// @ts-check
/* eslint-env node */
import BillingLedgerService, { buildDesiredChargeDescriptors, resolveHmoSplitAmounts } from './BillingLedgerService.js';
import { loadFinancePolicies } from './employee-finance.js';
import { normalizeString } from './org-bff.js';
import { loadHmoAuthorizations, resolveLessonCoverageDecision } from './hmo.js';

export const BILLING_BREAKDOWN_VERSION = 4;

function buildBreakdown({
  participant,
  instance,
  detail,
  coverageDecision = null,
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
    coverage_status: coverageDecision?.status || null,
    coverage_reason: coverageDecision?.reason || null,
    hmo_authorization_id: coverageDecision?.authorization_id || null,
    hmo_provider_track_id: coverageDecision?.authorization?.provider_track_id || null,
    covered_customer_charge_amount: coverageDecision?.covered_customer_charge_amount ?? null,
    covered_insurer_claim_amount: coverageDecision?.covered_insurer_claim_amount ?? null,
    post_coverage_policy: coverageDecision?.post_coverage_policy || null,
    post_coverage_customer_charge_amount: coverageDecision?.post_coverage_customer_charge_amount ?? null,
    student_charge_amount: detail?.entries
      .filter((entry) => entry.accountType === 'student' || entry.accountType === 'client_profile')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    insurer_claim_amount: detail?.entries
      .filter((entry) => entry.accountType === 'hmo_provider')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
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
  orgId = '',
  service: providedService = null,
  coverageDecision: providedCoverageDecision = null,
}) {
  const service = providedService || (tenantClient ? await loadServiceForInstance(tenantClient, instance) : null);
  const coverageDecision = providedCoverageDecision || (participant?.student_id && tenantClient
    ? await resolveLessonCoverageDecision(tenantClient, {
      orgId,
      studentId: participant.student_id,
      serviceId: instance?.service_id,
      lessonDate: instance?.datetime_start,
      lessonParticipantId: participant?.id,
    })
    : null);
  const detail = buildDesiredChargeDescriptors({
    participant,
    service,
    coverageDecision,
    policies,
  });
  const splitAmounts = resolveHmoSplitAmounts({ coverageDecision });
  const studentEntry = detail.entries.find((entry) => entry.accountType === 'student' || entry.accountType === 'client_profile') || null;
  return {
    shouldCharge: detail.entries.length > 0,
    chargeAmount: studentEntry?.amount ?? null,
    coverage: coverageDecision,
    billingStatus: detail.billingStatus,
    billingReason: detail.billingReason,
    requiresAttention: detail.status === 'blocked',
    usageType: coverageDecision?.status === 'covered'
      ? 'hmo_split'
      : (coverageDecision?.status === 'post_coverage' ? 'post_coverage' : 'standard'),
    splitAmounts,
    pricingBreakdown: buildBreakdown({ participant, instance, detail, coverageDecision }),
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
    coverageDecision: null,
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
    splitAmounts: null,
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

export async function fetchBillingSnapshot(tenantClient, {
  orgId = '',
  studentId = '',
  clientProfileId = '',
  startDate = '',
  endDate = '',
} = {}) {
  const service = new BillingLedgerService({ tenantClient, orgId });
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

  const policies = await loadFinancePolicies(tenantClient, orgId);
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
      authorizations: await loadHmoAuthorizations(tenantClient, { orgId, studentId: row.id, activeOnly: true }),
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
