// @ts-check
/* eslint-env node */
import { loadFinancePolicies } from './employee-finance.js';
import { coerceAgorot } from './currency.js';
import { normalizeString } from './org-bff.js';
import { loadHmoAuthorizations, resolveActiveAuthorizationForStudentService } from './hmo.js';

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

async function loadStudentProfileMap(tenantClient, studentIds = []) {
  const ids = Array.from(new Set((studentIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  if (ids.length === 0) {
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

async function loadServiceMap(tenantClient, serviceIds = []) {
  const ids = Array.from(new Set((serviceIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('Services')
    .select('id, name, color, default_customer_charge_amount, is_active')
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

async function resolveLedgerAccount(tenantClient, accountType, accountRefId) {
  const normalizedType = normalizeAccountType(accountType);
  const normalizedRefId = normalizeString(accountRefId);
  if (!normalizedType || !normalizedRefId) {
    throw new Error('invalid_ledger_account_target');
  }

  const column = ACCOUNT_COLUMN_BY_TYPE[normalizedType];
  const payload = {
    account_type: normalizedType,
    student_id: normalizedType === STUDENT_ACCOUNT_TYPE ? normalizedRefId : null,
    client_profile_id: normalizedType === CLIENT_ACCOUNT_TYPE ? normalizedRefId : null,
    hmo_provider_id: normalizedType === HMO_ACCOUNT_TYPE ? normalizedRefId : null,
    is_active: true,
    metadata: {},
  };

  const { data, error } = await tenantClient
    .from('ledger_accounts')
    .upsert(payload, { onConflict: column })
    .select('id, account_type, student_id, client_profile_id, hmo_provider_id, is_active, metadata')
    .single();

  if (error) {
    throw error;
  }
  return data;
}

async function appendLedgerTransaction(tenantClient, payload) {
  const { data, error } = await tenantClient
    .from('ledger_transactions')
    .insert(payload)
    .select(`
      id,
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

function buildLessonChargeMetadata({
  participant,
  instance,
  service,
  authorization,
  actorUserId,
  reasonCode,
  detail,
  warnings,
}) {
  return {
    reason_code: normalizeReasonCode(reasonCode),
    actor_user_id: actorUserId || null,
    participant_status: normalizeString(participant?.participant_status).toLowerCase() || null,
    lesson_status: normalizeString(instance?.status).toLowerCase() || null,
    lesson_date: toDateKey(instance?.datetime_start) || null,
    service_name: service?.service_name || service?.name || null,
    billing_reason: detail?.billingReason || null,
    warnings: warnings || [],
    authorization: authorization ? {
      id: authorization.id,
      provider_id: authorization.provider_id,
      provider_track_id: authorization.provider_track_id,
      contracted_rate_amount: coerceAgorot(authorization.contracted_rate_amount),
      authorization_reference: authorization.authorization_reference || null,
    } : null,
  };
}

export function buildDesiredChargeDescriptors({
  participant,
  service,
  authorization,
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

  if (!authorization?.id) {
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

  if (authorization.contracted_rate_amount == null) {
    return {
      status: 'blocked',
      billingStatus: 'blocked',
      billingReason: 'missing_contracted_rate_amount',
      warnings: ['missing_contracted_rate_amount'],
      entries: [],
    };
  }
  const contractedRateAmount = coerceAgorot(authorization.contracted_rate_amount);
  const studentCopay = Math.max(coerceAgorot(serviceRate) - contractedRateAmount, 0);
  const entries = [];

  if (studentCopay > 0) {
    entries.push({
      accountType: STUDENT_ACCOUNT_TYPE,
      accountRefId: participant.student_id,
      direction: 'DEBIT',
      amount: studentCopay,
      rateSource: 'hmo_authorization',
      hmoAuthorizationId: authorization.id,
    });
  }
  if (contractedRateAmount > 0) {
    entries.push({
      accountType: HMO_ACCOUNT_TYPE,
      accountRefId: authorization.provider_id,
      direction: 'DEBIT',
      amount: contractedRateAmount,
      rateSource: 'hmo_authorization',
      hmoAuthorizationId: authorization.id,
    });
  }

  return {
    status: entries.length > 0 ? 'debited' : 'noop',
    billingStatus: entries.length > 0 ? 'charged' : 'not_chargeable',
    billingReason: entries.length > 0 ? 'hmo_split_charge' : 'zero_charge',
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
  constructor({ tenantClient, clock = () => new Date().toISOString() }) {
    this.tenantClient = tenantClient;
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
    const serviceMap = await loadServiceMap(this.tenantClient, [instance.service_id]);
    const service = serviceMap.get(instance.service_id) || null;
    const policies = await loadFinancePolicies(this.tenantClient);
    const authorization = participant.student_id
      ? await resolveActiveAuthorizationForStudentService(this.tenantClient, {
        studentId: participant.student_id,
        serviceId: instance.service_id,
        lessonDate: instance.datetime_start,
      })
      : null;
    const desiredResult = buildDesiredChargeDescriptors({
      participant,
      service,
      authorization,
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
      const ledgerAccount = await resolveLedgerAccount(this.tenantClient, descriptor.accountType, descriptor.accountRefId);
      desiredEntries.push({
        ledger_account_id: ledgerAccount.id,
        direction: descriptor.direction,
        amount: descriptor.amount,
        student_id: descriptor.accountType === STUDENT_ACCOUNT_TYPE ? descriptor.accountRefId : participant.student_id || null,
        client_profile_id: descriptor.accountType === CLIENT_ACCOUNT_TYPE ? descriptor.accountRefId : participant.client_profile_id || null,
        hmo_provider_id: descriptor.accountType === HMO_ACCOUNT_TYPE ? descriptor.accountRefId : null,
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
      authorization,
      actorUserId,
      reasonCode,
      detail: desiredResult,
      warnings: desiredResult.warnings,
    });

    const reversalRows = existingOpenCharges.map((original) => ({
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
    const [authorization] = await loadHmoAuthorizations(this.tenantClient, { authorizationIds: [hmoAuthorizationId] });
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

    const ledgerAccount = await resolveLedgerAccount(this.tenantClient, accountType, accountRefId);
    const transaction = await appendLedgerTransaction(this.tenantClient, {
      ledger_account_id: ledgerAccount.id,
      direction: 'CREDIT',
      amount: coercedAmount,
      effective_at: toIsoOrNow(effectiveAt, this.clock),
      source_type: normalizeString(sourceType),
      source_id: sourceId,
      lesson_instance_id: null,
      lesson_participant_id: null,
      student_id: accountType === STUDENT_ACCOUNT_TYPE ? accountRefId : null,
      client_profile_id: accountType === CLIENT_ACCOUNT_TYPE ? accountRefId : null,
      hmo_provider_id: accountType === HMO_ACCOUNT_TYPE ? accountRefId : null,
      hmo_authorization_id: null,
      service_id: null,
      rate_source: normalizeString(sourceType) === 'opening_balance'
        ? 'opening_balance'
        : (normalizeString(sourceType) === 'migration' ? 'migration' : 'manual'),
      reverses_transaction_id: null,
      external_reference: normalizeString(externalReference) || null,
      notes: normalizeString(notes) || null,
      metadata: {
        ...(isPlainObject(metadata) ? metadata : {}),
        actor_user_id: actorUserId || null,
      },
    });
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

    const ledgerAccount = await resolveLedgerAccount(this.tenantClient, accountType, accountRefId);
    const transaction = await appendLedgerTransaction(this.tenantClient, {
      ledger_account_id: ledgerAccount.id,
      direction: 'DEBIT',
      amount: coercedAmount,
      effective_at: toIsoOrNow(effectiveAt, this.clock),
      source_type: normalizeString(sourceType),
      source_id: sourceId,
      lesson_instance_id: null,
      lesson_participant_id: null,
      student_id: accountType === STUDENT_ACCOUNT_TYPE ? accountRefId : null,
      client_profile_id: accountType === CLIENT_ACCOUNT_TYPE ? accountRefId : null,
      hmo_provider_id: accountType === HMO_ACCOUNT_TYPE ? accountRefId : null,
      hmo_authorization_id: null,
      service_id: null,
      rate_source: normalizeString(sourceType) === 'opening_balance'
        ? 'opening_balance'
        : (normalizeString(sourceType) === 'migration' ? 'migration' : 'manual'),
      reverses_transaction_id: null,
      external_reference: normalizeString(externalReference) || null,
      notes: normalizeString(notes) || null,
      metadata: {
        ...(isPlainObject(metadata) ? metadata : {}),
        actor_user_id: actorUserId || null,
      },
    });
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

  async createHmoInvoiceBatch({
    hmoProviderId,
    periodStart,
    periodEnd,
    actorUserId,
    externalReference = null,
    externalLink = null,
    notes = null,
  }) {
    const normalizedProviderId = normalizeString(hmoProviderId);
    if (!normalizedProviderId) {
      throw new Error('missing_hmo_provider_id');
    }

    let query = this.tenantClient
      .from('ledger_transactions')
      .select('id, amount, effective_at')
      .eq('hmo_provider_id', normalizedProviderId)
      .eq('source_type', 'lesson_charge')
      .eq('direction', 'DEBIT')
      .is('reverses_transaction_id', null)
      .order('effective_at', { ascending: true });

    if (normalizeString(periodStart)) {
      query = query.gte('effective_at', `${periodStart}T00:00:00.000Z`);
    }
    if (normalizeString(periodEnd)) {
      query = query.lte('effective_at', `${periodEnd}T23:59:59.999Z`);
    }

    const { data: debitRows, error: debitError } = await query;
    if (debitError) {
      throw debitError;
    }

    const candidateIds = (debitRows || []).map((row) => row.id);
    const { data: existingItems, error: itemsError } = candidateIds.length > 0
      ? await this.tenantClient
        .from('hmo_invoice_batch_items')
        .select('ledger_transaction_id')
        .in('ledger_transaction_id', candidateIds)
      : { data: [], error: null };

    if (itemsError) {
      throw itemsError;
    }

    const usedLedgerIds = new Set((existingItems || []).map((row) => row.ledger_transaction_id));
    const eligibleRows = (debitRows || []).filter((row) => !usedLedgerIds.has(row.id));
    const totalAmount = eligibleRows.reduce((sum, row) => sum + coerceAgorot(row.amount), 0);

    const { data: batch, error: batchError } = await this.tenantClient
      .from('hmo_invoice_batches')
      .insert({
        hmo_provider_id: normalizedProviderId,
        period_start: normalizeString(periodStart) || null,
        period_end: normalizeString(periodEnd) || null,
        status: 'issued',
        total_amount: totalAmount,
        external_reference: normalizeString(externalReference) || null,
        external_link: normalizeString(externalLink) || null,
        notes: normalizeString(notes) || null,
        metadata: {
          actor_user_id: actorUserId || null,
        },
      })
      .select('id')
      .single();

    if (batchError) {
      throw batchError;
    }

    if (eligibleRows.length > 0) {
      const { error: insertItemsError } = await this.tenantClient
        .from('hmo_invoice_batch_items')
        .insert(eligibleRows.map((row) => ({
          batch_id: batch.id,
          ledger_transaction_id: row.id,
          amount: coerceAgorot(row.amount),
        })));

      if (insertItemsError) {
        // Best-effort cleanup of the orphaned batch header before re-throwing.
        await this.tenantClient.from('hmo_invoice_batches').delete().eq('id', batch.id);
        throw insertItemsError;
      }
    }

    return {
      batchId: batch.id,
      ledgerTransactionIds: eligibleRows.map((row) => row.id),
      totalAmount,
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
    const { data: batch, error } = await this.tenantClient
      .from('hmo_invoice_batches')
      .select('id, hmo_provider_id, total_amount, paid_amount')
      .eq('id', batchId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!batch?.id || !batch?.hmo_provider_id) {
      throw new Error('invoice_batch_not_found');
    }

    const result = await this.appendManualCredit({
      accountType: HMO_ACCOUNT_TYPE,
      accountRefId: batch.hmo_provider_id,
      amount,
      effectiveAt,
      actorUserId,
      sourceType: 'hmo_invoice_payment',
      sourceId: batch.id,
      externalReference,
      notes,
      metadata,
    });

    const nextPaidAmount = coerceAgorot(batch.paid_amount) + coerceAgorot(amount);
    const nextStatus = nextPaidAmount >= coerceAgorot(batch.total_amount) ? 'paid' : 'partially_paid';
    const { error: updateError } = await this.tenantClient
      .from('hmo_invoice_batches')
      .update({
        paid_amount: nextPaidAmount,
        status: nextStatus,
        paid_at: toIsoOrNow(effectiveAt, this.clock),
        updated_at: this.clock(),
      })
      .eq('id', batch.id);

    if (updateError) {
      throw updateError;
    }

    return {
      transactionId: result.transactionId,
      hmoProviderId: batch.hmo_provider_id,
    };
  }

  async getAccountBalance({
    accountType,
    accountRefId,
    asOf = null,
  }) {
    const ledgerAccount = await resolveLedgerAccount(this.tenantClient, accountType, accountRefId);
    let query = this.tenantClient
      .from('ledger_transactions')
      .select('direction, amount')
      .eq('ledger_account_id', ledgerAccount.id);

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

    const studentMap = await loadStudentProfileMap(this.tenantClient, [normalizedStudentId]);
    const student = studentMap.get(normalizedStudentId) || null;
    const balance = await this.getAccountBalance({ accountType: STUDENT_ACCOUNT_TYPE, accountRefId: normalizedStudentId });
    const authorizations = await loadHmoAuthorizations(this.tenantClient, { studentId: normalizedStudentId });

    const pageLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 500;

    let ledgerQuery = this.tenantClient
      .from('ledger_transactions')
      .select('*')
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
        payment_total: (ledgerEntries || [])
          .filter((row) => normalizeDirection(row.direction) === 'CREDIT')
          .reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
        manual_adjustment_total: (ledgerEntries || [])
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
        .in('lesson_participant_id', participantIds)
        .in('source_type', ['lesson_charge', 'reversal'])
      : { data: [], error: null };

    if (lessonLedgerError) {
      throw lessonLedgerError;
    }

    const lessonRowsByParticipant = groupBy(lessonLedgerRows || [], (row) => row.lesson_participant_id);
    const serviceMap = await loadServiceMap(
      this.tenantClient,
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
        payment_total: (ledgerEntries || [])
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
        receivable_total: (ledgerEntries || [])
          .filter((row) => normalizeDirection(row.direction) === 'DEBIT')
          .reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
        payment_total: (ledgerEntries || [])
          .filter((row) => normalizeDirection(row.direction) === 'CREDIT')
          .reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
      },
      ledger_entries: ledgerEntries || [],
      invoice_batches: invoiceBatches || [],
    };
  }
}
