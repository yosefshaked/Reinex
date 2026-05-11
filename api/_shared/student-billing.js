// @ts-check
/* eslint-env node */
import BillingLedgerService, { buildDesiredChargeDescriptors, resolveHmoSplitAmounts } from './BillingLedgerService.js';
import { loadFinancePolicies } from './employee-finance.js';
import { normalizeString, withOrgScope } from './org-bff.js';
import { loadHmoAuthorizations, resolveLessonCoverageDecision } from './hmo.js';

export const BILLING_BREAKDOWN_VERSION = 4;
export const INTAKE_FINANCE_NOTICE_TTL_DAYS = 30;

const INTAKE_FINANCE_NOTICE_TTL_MS = INTAKE_FINANCE_NOTICE_TTL_DAYS * 24 * 60 * 60 * 1000;
const PAYMENT_PATH_LABELS = {
  hmo: 'גורם מממן',
  private: 'תשלום פרטי',
  unsure: 'צריך עזרה בבחירת מסלול',
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePaymentPathIntent(value) {
  const normalized = normalizeString(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAYMENT_PATH_LABELS, normalized) ? normalized : '';
}

function parseDateMs(value) {
  const normalized = normalizeString(value);
  if (!normalized) return NaN;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

function resolveNoticeReferenceAt(entry) {
  const metadata = isPlainObject(entry?.metadata) ? entry.metadata : {};
  return normalizeString(metadata.matched_at)
    || normalizeString(metadata.submitted_at)
    || normalizeString(entry?.created_at)
    || '';
}

function hasEffectiveLedgerActivity(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const reversedIds = new Set(rows
    .filter((entry) => normalizeString(entry?.source_type) === 'reversal' && normalizeString(entry?.reverses_transaction_id))
    .map((entry) => normalizeString(entry.reverses_transaction_id)));

  return rows.some((entry) => (
    normalizeString(entry?.source_type) !== 'reversal'
    && !reversedIds.has(normalizeString(entry?.id))
    && Math.abs(Number(entry?.amount || 0)) > 0
  ));
}

export function buildIntakeFinanceNotice({
  entry = null,
  hasLedgerActivity = false,
  hasHmoAuthorization = false,
  now = new Date(),
} = {}) {
  if (!entry?.id || hasLedgerActivity || hasHmoAuthorization) {
    return null;
  }

  const metadata = isPlainObject(entry?.metadata) ? entry.metadata : {};
  const paymentPathIntent = normalizePaymentPathIntent(metadata.payment_path_intent);
  if (!paymentPathIntent) {
    return null;
  }

  const referenceAt = resolveNoticeReferenceAt(entry);
  const referenceMs = parseDateMs(referenceAt);
  const nowMs = now instanceof Date ? now.getTime() : parseDateMs(now);
  if (!Number.isFinite(referenceMs) || !Number.isFinite(nowMs)) {
    return null;
  }

  const expiresAtMs = referenceMs + INTAKE_FINANCE_NOTICE_TTL_MS;
  if (nowMs > expiresAtMs) {
    return null;
  }

  return {
    waiting_list_entry_id: entry.id,
    payment_path_intent: paymentPathIntent,
    label: PAYMENT_PATH_LABELS[paymentPathIntent],
    hmo_provider_name: paymentPathIntent === 'hmo' ? (normalizeString(metadata.hmo_provider_name) || null) : null,
    hmo_approval_status: paymentPathIntent === 'hmo' ? (normalizeString(metadata.hmo_approval_status) || null) : null,
    matched_at: normalizeString(metadata.matched_at) || null,
    submitted_at: normalizeString(metadata.submitted_at) || null,
    reference_at: referenceAt,
    expires_at: new Date(expiresAtMs).toISOString(),
  };
}

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
  const hasHmoEntry = detail.entries.some((entry) => entry.accountType === 'hmo_provider');
  const splitAmounts = hasHmoEntry ? resolveHmoSplitAmounts({ coverageDecision }) : null;
  const studentEntry = detail.entries.find((entry) => entry.accountType === 'student' || entry.accountType === 'client_profile') || null;
  return {
    shouldCharge: detail.entries.length > 0,
    chargeAmount: studentEntry?.amount ?? (detail.entries.length > 0 ? 0 : null),
    coverage: coverageDecision,
    billingStatus: detail.billingStatus,
    billingReason: detail.billingReason,
    requiresAttention: detail.status === 'blocked',
    usageType: hasHmoEntry
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

async function loadMatchedWaitingListEntryForStudent(tenantClient, {
  orgId = '',
  studentId = '',
  clientProfileId = '',
} = {}) {
  const normalizedOrgId = normalizeString(orgId);
  const normalizedStudentId = normalizeString(studentId);
  const normalizedClientProfileId = normalizeString(clientProfileId);
  if (!normalizedOrgId || (!normalizedStudentId && !normalizedClientProfileId)) {
    return null;
  }

  const selectColumns = 'id, student_id, client_profile_id, desired_service_id, status, metadata, created_at';
  const loadByColumn = async (column, value) => {
    if (!value) return [];
    const { data, error } = await withOrgScope(tenantClient, 'waiting_list_entries', normalizedOrgId)
      .select(selectColumns)
      .eq(column, value)
      .eq('status', 'matched')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      if (error.code === '42P01') {
        return [];
      }
      throw error;
    }
    return Array.isArray(data) ? data : [];
  };

  const rows = [
    ...await loadByColumn('client_profile_id', normalizedClientProfileId),
    ...await loadByColumn('student_id', normalizedStudentId),
  ];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Array.from(byId.values())
    .filter((row) => normalizePaymentPathIntent(row?.metadata?.payment_path_intent))
    .sort((a, b) => {
      const aMs = parseDateMs(resolveNoticeReferenceAt(a)) || 0;
      const bMs = parseDateMs(resolveNoticeReferenceAt(b)) || 0;
      return bMs - aMs;
    })[0] || null;
}

async function hasStudentLedgerActivity(tenantClient, { orgId = '', studentId = '' } = {}) {
  const normalizedOrgId = normalizeString(orgId);
  const normalizedStudentId = normalizeString(studentId);
  if (!normalizedOrgId || !normalizedStudentId) {
    return false;
  }

  const { data, error } = await withOrgScope(tenantClient, 'ledger_transactions', normalizedOrgId)
    .select('id, amount, source_type, reverses_transaction_id')
    .eq('student_id', normalizedStudentId)
    .limit(1000);

  if (error) {
    if (error.code === '42P01') {
      return false;
    }
    throw error;
  }
  return hasEffectiveLedgerActivity(data || []);
}

async function loadStudentIntakeFinanceNotice(tenantClient, {
  orgId = '',
  studentId = '',
  snapshot = null,
} = {}) {
  const normalizedStudentId = normalizeString(studentId);
  if (!normalizedStudentId || !snapshot?.student) {
    return null;
  }

  const hasHmoAuthorization = Array.isArray(snapshot?.authorizations) && snapshot.authorizations.length > 0;
  const hasLedgerActivity = await hasStudentLedgerActivity(tenantClient, { orgId, studentId: normalizedStudentId });
  if (hasLedgerActivity || hasHmoAuthorization) {
    return null;
  }

  const entry = await loadMatchedWaitingListEntryForStudent(tenantClient, {
    orgId,
    studentId: normalizedStudentId,
    clientProfileId: snapshot?.student?.client_profile_id,
  });

  return buildIntakeFinanceNotice({
    entry,
    hasLedgerActivity,
    hasHmoAuthorization,
  });
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
    const snapshot = await service.getStudentBillingSnapshot({
      studentId,
      startDate: normalizeString(startDate) || null,
      endDate: normalizeString(endDate) || null,
    });
    return {
      ...snapshot,
      intake_finance_notice: await loadStudentIntakeFinanceNotice(tenantClient, {
        orgId,
        studentId,
        snapshot,
      }),
    };
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
      hmo_non_attendance_billing_policy: policies.hmoNonAttendanceBillingPolicy,
      instructor_earnings_policy: policies.instructorEarningsPolicy,
    },
    student_summaries: studentSummaries,
  };
}
