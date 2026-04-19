/* eslint-env node */
import {
  computeLessonInstructorPayoutAmount,
  lessonHasInstructorCompensation,
  loadFinancePolicies,
  toDateKey,
} from './employee-finance.js';
import { normalizeEntityVersion } from './calendar-editing.js';
import { normalizeString } from './org-bff.js';
import { resolveActiveAuthorizationForStudentService } from './hmo.js';
import { buildBillingDecision, buildDirectClientBillingDecision } from './student-billing.js';
import { normalizeLessonInstanceStatus } from './lesson-instance-status.js';
import { coerceAgorot } from './currency.js';

const LESSON_BILLING_USAGE_TYPES = ['lesson_charge', 'reversal', 'manual_adjustment', 'manual_payment'];
const PARTICIPANT_STATUSES = new Set(['scheduled', 'attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);

class CorrectionValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function roundCurrency(value) {
  return coerceAgorot(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isMissingRelationError(error) {
  const code = normalizeString(error?.code).toUpperCase();
  const message = normalizeString(error?.message).toLowerCase();
  return code === '42P01' || message.includes('does not exist');
}

function normalizeCorrectionMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (['value_only', 'replacement_instance', 'participant_adjustment'].includes(normalized)) {
    return normalized;
  }
  return 'value_only';
}

function normalizePatchObject(value) {
  return isPlainObject(value) ? value : {};
}

function getPatchParticipantId(patch) {
  return normalizeString(patch?.participant_id || patch?.participantId || patch?.id);
}

function applyInstancePatch(instance, instancePatch) {
  const patch = normalizePatchObject(instancePatch);
  return {
    ...instance,
    ...patch,
    metadata: isPlainObject(patch.metadata)
      ? { ...(isPlainObject(instance?.metadata) ? instance.metadata : {}), ...patch.metadata }
      : instance?.metadata || {},
  };
}

function applyParticipantPatches(participants, participantPatches) {
  const patchesById = new Map();
  for (const patch of asArray(participantPatches)) {
    const participantId = getPatchParticipantId(patch);
    if (!participantId) continue;
    patchesById.set(participantId, normalizePatchObject(patch));
  }

  return asArray(participants).map((participant) => {
    const patch = patchesById.get(participant.id);
    if (!patch) {
      return participant;
    }

    const nextMetadata = patch.metadata && isPlainObject(patch.metadata)
      ? { ...(isPlainObject(participant.metadata) ? participant.metadata : {}), ...patch.metadata }
      : participant.metadata;

    return {
      ...participant,
      ...patch,
      metadata: nextMetadata,
    };
  });
}

function buildRateKey(employeeId, serviceId) {
  return `${employeeId || ''}:${serviceId || ''}`;
}

async function loadServicesMap(tenantClient, serviceIds = []) {
  const ids = Array.from(new Set(asArray(serviceIds).map((value) => normalizeString(value)).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await tenantClient
    .from('Services')
    .select('id, default_customer_charge_amount')
    .in('id', ids);

  if (error) {
    throw error;
  }

  return new Map(asArray(data).map((service) => [service.id, service]));
}

function shouldInstructorEarn(instance, participants, policies) {
  void instance;
  return lessonHasInstructorCompensation(participants, policies);
}

function computeWorkedMinutes(instance, participants, policies) {
  return lessonHasInstructorCompensation(participants, policies)
    ? Number(instance?.duration_minutes || 0)
    : 0;
}

async function computeParticipantChargeDecision(tenantClient, instance, participant, serviceMap, policies) {
  if (participant?.student_id) {
    const authorization = await resolveActiveAuthorizationForStudentService(tenantClient, {
      studentId: participant.student_id,
      serviceId: instance?.service_id,
      lessonDate: instance?.datetime_start,
    });
    return buildBillingDecision({
      participant,
      instance,
      service: serviceMap.get(instance?.service_id) || null,
      authorization,
      policies,
    });
  }

  return buildDirectClientBillingDecision({
    participant,
    instance,
    service: serviceMap.get(instance?.service_id) || null,
    policies,
  });
}

function validateCorrectionEffectiveState(instance, participants) {
  const normalizedInstanceStatus = normalizeLessonInstanceStatus(instance?.status);
  const effectiveParticipants = asArray(participants);
  const attendedParticipants = effectiveParticipants.filter((participant) => normalizeString(participant?.participant_status).toLowerCase() === 'attended');
  const scheduledParticipants = effectiveParticipants.filter((participant) => normalizeString(participant?.participant_status).toLowerCase() === 'scheduled');

  for (const participant of effectiveParticipants) {
    const status = normalizeString(participant?.participant_status).toLowerCase();
    if (status && !PARTICIPANT_STATUSES.has(status)) {
      throw new CorrectionValidationError('invalid_participant_patch_status', {
        participant_id: participant.id,
        participant_status: participant?.participant_status || null,
      });
    }
  }

  if (normalizedInstanceStatus === 'cancelled' && attendedParticipants.length > 0) {
    throw new CorrectionValidationError('cancelled_instance_has_attended_participants', {
      participant_ids: attendedParticipants.map((participant) => participant.id),
    });
  }

  if (normalizedInstanceStatus === 'completed' && scheduledParticipants.length > 0) {
    throw new CorrectionValidationError('completed_instance_has_scheduled_participants', {
      participant_ids: scheduledParticipants.map((participant) => participant.id),
    });
  }
}

async function loadCorrectionContext(tenantClient, originalInstanceId) {
  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .select('id, template_id, datetime_start, duration_minutes, instructor_employee_id, service_id, status, documentation_status, version, metadata, created_at, updated_at')
    .eq('id', originalInstanceId)
    .maybeSingle();

  if (instanceError) {
    throw instanceError;
  }
  if (!instance) {
    return null;
  }

  instance.version = normalizeEntityVersion(instance.version);

  const { data: participants, error: participantsError } = await tenantClient
    .from('lesson_participants')
    .select('id, lesson_instance_id, client_profile_id, student_id, participant_status, reminder_sent, reminder_seen, attendance_confirmed_at, documented_at, version, metadata')
    .eq('lesson_instance_id', originalInstanceId);

  if (participantsError) {
    throw participantsError;
  }

  const participantRows = asArray(participants).map((participant) => ({
    ...participant,
    version: normalizeEntityVersion(participant.version),
  }));
  const participantIds = participantRows.map((participant) => participant.id);

  const [{ data: earnings, error: earningsError }, { data: ledgerRows, error: ledgerError }, { data: instanceLocks, error: instanceLocksError }, { data: participantLocks, error: participantLocksError }, { data: latestCorrectionRows, error: latestCorrectionError }, { data: financeAdjustmentRows, error: financeAdjustmentError }, { data: attendanceCorrectionRows, error: attendanceCorrectionError }, { data: correctionLedgerRows, error: correctionLedgerError }] = await Promise.all([
    tenantClient
      .from('lesson_earnings')
      .select('employee_id, lesson_instance_id, rate_used, payout_amount, metadata')
      .eq('lesson_instance_id', originalInstanceId)
      .maybeSingle(),
    participantIds.length > 0
      ? tenantClient
        .from('ledger_transactions')
        .select('id, student_id, client_profile_id, hmo_provider_id, direction, source_type, amount, lesson_participant_id, reverses_transaction_id, metadata')
        .in('lesson_participant_id', participantIds)
        .in('source_type', LESSON_BILLING_USAGE_TYPES)
      : Promise.resolve({ data: [], error: null }),
    tenantClient
      .from('instance_locks')
      .select('id, lesson_instance_id, lock_source_type, lock_source_id, lock_reason, created_at, metadata')
      .eq('lesson_instance_id', originalInstanceId),
    participantIds.length > 0
      ? tenantClient
        .from('participant_locks')
        .select('id, lesson_participant_id, lock_source_type, lock_source_id, lock_reason, created_at, metadata')
        .in('lesson_participant_id', participantIds)
      : Promise.resolve({ data: [], error: null }),
    tenantClient
      .from('calendar_instance_corrections')
      .select('id, original_instance_id, status, effective_state, impact_snapshot, created_at, metadata')
      .eq('original_instance_id', originalInstanceId)
      .eq('status', 'applied')
      .order('created_at', { ascending: false })
      .limit(1),
    tenantClient
      .from('finance_corrections')
      .select('id, amount, effective_date, metadata')
      .contains('metadata', { source_type: 'calendar_instance_correction', original_instance_id: originalInstanceId }),
    tenantClient
      .from('employee_attendance_records')
      .select('id, worked_minutes, attendance_date, metadata')
      .contains('metadata', { source_type: 'calendar_instance_correction', original_instance_id: originalInstanceId }),
    tenantClient
      .from('ledger_transactions')
      .select('id, student_id, client_profile_id, hmo_provider_id, direction, source_type, amount, lesson_participant_id, reverses_transaction_id, metadata')
      .contains('metadata', { source_type: 'calendar_instance_correction', original_instance_id: originalInstanceId }),
  ]);

  if (earningsError && earningsError.code !== 'PGRST116' && !isMissingRelationError(earningsError)) {
    throw earningsError;
  }
  if (ledgerError) {
    throw ledgerError;
  }
  if (instanceLocksError) {
    throw instanceLocksError;
  }
  if (participantLocksError) {
    throw participantLocksError;
  }
  if (latestCorrectionError) {
    throw latestCorrectionError;
  }
  if (financeAdjustmentError && !isMissingRelationError(financeAdjustmentError)) {
    throw financeAdjustmentError;
  }
  if (attendanceCorrectionError && !isMissingRelationError(attendanceCorrectionError)) {
    throw attendanceCorrectionError;
  }
  if (correctionLedgerError && !isMissingRelationError(correctionLedgerError)) {
    throw correctionLedgerError;
  }

  const claimBatchIds = Array.from(new Set([
    ...asArray(instanceLocks).filter((lock) => lock.lock_source_type === 'claim_batch').map((lock) => lock.lock_source_id),
    ...asArray(participantLocks).filter((lock) => lock.lock_source_type === 'claim_batch').map((lock) => lock.lock_source_id),
  ].filter(Boolean)));

  const { data: claimBatches, error: claimBatchesError } = claimBatchIds.length > 0
    ? await tenantClient
      .from('claim_batches')
      .select('id, status, batch_type, submitted_at, paid_at')
      .in('id', claimBatchIds)
    : { data: [], error: null };

  if (claimBatchesError) {
    throw claimBatchesError;
  }

  return {
    instance,
    participants: participantRows,
    earning: earnings || null,
    latestCorrection: asArray(latestCorrectionRows)[0] || null,
    ledgerRows: asArray(ledgerRows),
    financeAdjustmentRows: asArray(financeAdjustmentRows),
    attendanceCorrectionRows: asArray(attendanceCorrectionRows),
    correctionLedgerRows: asArray(correctionLedgerRows),
    instanceLocks: asArray(instanceLocks),
    participantLocks: asArray(participantLocks),
    claimBatches: asArray(claimBatches),
  };
}

async function loadRateMap(tenantClient, pairs) {
  const uniquePairs = Array.from(new Set(asArray(pairs)
    .map((pair) => buildRateKey(pair.employeeId, pair.serviceId))
    .filter((key) => key !== ':')));

  const rateMap = new Map();
  if (uniquePairs.length === 0) {
    return rateMap;
  }

  const employeeIds = Array.from(new Set(uniquePairs.map((key) => key.split(':')[0]).filter(Boolean)));
  const serviceIds = Array.from(new Set(uniquePairs.map((key) => key.split(':')[1]).filter(Boolean)));

  const { data, error } = await tenantClient
    .from('instructor_service_capabilities')
    .select('employee_id, service_id, base_rate')
    .in('employee_id', employeeIds)
    .in('service_id', serviceIds);

  if (error) {
    throw error;
  }

  for (const row of asArray(data)) {
    rateMap.set(buildRateKey(row.employee_id, row.service_id), Number.isFinite(Number(row.base_rate)) ? Number(row.base_rate) : 0);
  }

  return rateMap;
}

function buildChargeMap(ledgerRows) {
  const map = new Map();
  for (const row of asArray(ledgerRows)) {
    const participantRef = normalizeString(row?.lesson_participant_id || row?.metadata?.original_participant_id);
    if (!participantRef) continue;
    const signedAmount = normalizeString(row.direction).toUpperCase() === 'CREDIT'
      ? -Math.abs(coerceAgorot(row.amount))
      : Math.abs(coerceAgorot(row.amount));
    const nextAmount = roundCurrency((map.get(participantRef) || 0) + signedAmount);
    map.set(participantRef, nextAmount);
  }
  return map;
}

export async function buildInstanceCorrectionPreview(tenantClient, options) {
  const originalInstanceId = normalizeString(options?.originalInstanceId);
  if (!originalInstanceId) {
    throw new Error('missing_original_instance_id');
  }

  const context = await loadCorrectionContext(tenantClient, originalInstanceId);
  if (!context) {
    return null;
  }

  const correctionMode = normalizeCorrectionMode(options?.correctionMode);
  const instancePatch = normalizePatchObject(options?.instancePatch);
  const participantPatches = asArray(options?.participantPatches).map((patch) => normalizePatchObject(patch));
  const policies = await loadFinancePolicies(tenantClient, context.instance?.org_id || context.originalInstance?.org_id);
  const currentInstance = context.latestCorrection?.effective_state?.instance || context.instance;
  const currentParticipants = asArray(context.latestCorrection?.effective_state?.participants).length > 0
    ? context.latestCorrection.effective_state.participants
    : context.participants;
  const effectiveInstance = applyInstancePatch(currentInstance, instancePatch);
  const effectiveParticipants = applyParticipantPatches(currentParticipants, participantPatches);
  effectiveInstance.status = normalizeLessonInstanceStatus(effectiveInstance.status);
  validateCorrectionEffectiveState(effectiveInstance, effectiveParticipants);

  const rateMap = await loadRateMap(tenantClient, [
    { employeeId: context.instance.instructor_employee_id, serviceId: context.instance.service_id },
    { employeeId: currentInstance.instructor_employee_id, serviceId: currentInstance.service_id },
    { employeeId: effectiveInstance.instructor_employee_id, serviceId: effectiveInstance.service_id },
  ]);
  const serviceMap = await loadServicesMap(tenantClient, [
    context.instance.service_id,
    currentInstance.service_id,
    effectiveInstance.service_id,
  ]);

  const originalRate = rateMap.get(buildRateKey(context.instance.instructor_employee_id, context.instance.service_id)) || 0;
  const currentRate = rateMap.get(buildRateKey(currentInstance.instructor_employee_id, currentInstance.service_id)) || 0;
  const proposedRate = rateMap.get(buildRateKey(effectiveInstance.instructor_employee_id, effectiveInstance.service_id)) || 0;
  const baseCurrentPayout = shouldInstructorEarn(context.instance, context.participants, policies)
    ? computeLessonInstructorPayoutAmount(context.instance, originalRate)
    : 0;
  const correctionPayrollDelta = roundCurrency(
    context.financeAdjustmentRows.reduce((sum, row) => sum + coerceAgorot(row.amount), 0),
  );
  const currentPayout = roundCurrency(baseCurrentPayout + correctionPayrollDelta);
  const proposedPayout = shouldInstructorEarn(effectiveInstance, effectiveParticipants, policies)
    ? computeLessonInstructorPayoutAmount(effectiveInstance, proposedRate)
    : 0;

  const currentWorkedMinutes = computeWorkedMinutes(context.instance, context.participants, policies)
    + context.attendanceCorrectionRows.reduce((sum, row) => sum + Number(row.worked_minutes || 0), 0);
  const proposedWorkedMinutes = computeWorkedMinutes(effectiveInstance, effectiveParticipants, policies);
  const currentChargeMap = buildChargeMap([...context.ledgerRows, ...context.correctionLedgerRows]);

  const participantImpact = await Promise.all(effectiveParticipants.map(async (participant) => {
    const originalParticipant = currentParticipants.find((row) => row.id === participant.id) || participant;
    const currentCharge = roundCurrency(currentChargeMap.get(participant.id) || 0);
    const proposedDecision = await computeParticipantChargeDecision(
      tenantClient,
      effectiveInstance,
      participant,
      serviceMap,
      policies,
    );
    const proposedCharge = proposedDecision.shouldCharge ? roundCurrency(proposedDecision.chargeAmount) : 0;
    const delta = roundCurrency(proposedCharge - currentCharge);
    const participantClaimLocks = context.participantLocks.filter((lock) => lock.lesson_participant_id === participant.id && lock.lock_source_type === 'claim_batch');
    const paidClaimBatchIds = participantClaimLocks
      .map((lock) => context.claimBatches.find((batch) => batch.id === lock.lock_source_id))
      .filter((batch) => batch?.status === 'paid')
      .map((batch) => batch.id);

    return {
      participant_id: participant.id,
      client_profile_id: participant.client_profile_id || null,
      student_id: participant.student_id,
      original_status: originalParticipant.participant_status,
      proposed_status: participant.participant_status,
      current_charge: currentCharge,
      proposed_charge: proposedCharge,
      delta_amount: delta,
      billing_mode: participant.student_id ? 'student_commitment' : 'direct_client',
      billing_status: proposedDecision.billingStatus || null,
      billing_reason: proposedDecision.billingReason || null,
      paid_claim_batch_ids: paidClaimBatchIds,
    };
  }));

  const paidClaimBatchIds = Array.from(new Set([
    ...context.instanceLocks
      .filter((lock) => lock.lock_source_type === 'claim_batch')
      .map((lock) => context.claimBatches.find((batch) => batch.id === lock.lock_source_id))
      .filter((batch) => batch?.status === 'paid')
      .map((batch) => batch.id),
    ...participantImpact.flatMap((participant) => participant.paid_claim_batch_ids),
  ]));

  const billingDeltaTotal = roundCurrency(
    participantImpact.reduce((sum, participant) => sum + coerceAgorot(participant.delta_amount), 0),
  );

  return {
    original_instance_id: originalInstanceId,
    correction_mode: correctionMode,
    instance_version: currentInstance.version,
    blocked_by_paid_claim: paidClaimBatchIds.length > 0,
    paid_claim_batch_ids: paidClaimBatchIds,
    requires_impact_warning: true,
    instance_patch: instancePatch,
    participant_patches: participantPatches,
    effective_state: {
      instance: effectiveInstance,
      participants: effectiveParticipants,
    },
    impact_snapshot: {
      payroll: {
        current_rate: currentRate,
        proposed_rate: proposedRate,
        current_payout: currentPayout,
        proposed_payout: proposedPayout,
        delta_amount: roundCurrency(proposedPayout - currentPayout),
      },
      operational: {
        attendance_date: toDateKey(currentInstance.datetime_start),
        current_worked_minutes: currentWorkedMinutes,
        proposed_worked_minutes: proposedWorkedMinutes,
        delta_minutes: proposedWorkedMinutes - currentWorkedMinutes,
      },
      billing: {
        total_delta_amount: billingDeltaTotal,
        affected_participants: participantImpact.filter((participant) => participant.delta_amount !== 0),
      },
      locks: {
        instance_locks: context.instanceLocks,
        participant_locks: context.participantLocks,
      },
    },
  };
}

export async function enrichInstancesWithCorrectionState(tenantClient, instances = []) {
  const rows = asArray(instances);
  if (rows.length === 0) {
    return rows;
  }

  const instanceIds = rows.map((row) => row.id).filter(Boolean);
  const participantIds = rows.flatMap((row) => asArray(row.participants).map((participant) => participant.id).filter(Boolean));

  const [{ data: instanceLocks, error: instanceLocksError }, { data: participantLocks, error: participantLocksError }, { data: corrections, error: correctionsError }] = await Promise.all([
    tenantClient
      .from('instance_locks')
      .select('id, lesson_instance_id, lock_source_type, lock_source_id, lock_reason, created_at, metadata')
      .in('lesson_instance_id', instanceIds),
    participantIds.length > 0
      ? tenantClient
        .from('participant_locks')
        .select('id, lesson_participant_id, lock_source_type, lock_source_id, lock_reason, created_at, metadata')
        .in('lesson_participant_id', participantIds)
      : Promise.resolve({ data: [], error: null }),
    tenantClient
      .from('calendar_instance_corrections')
      .select('id, original_instance_id, correction_mode, reason_code, reason_text, status, effective_state, impact_snapshot, created_at, metadata')
      .in('original_instance_id', instanceIds)
      .eq('status', 'applied')
      .order('created_at', { ascending: false }),
  ]);

  if (instanceLocksError) {
    throw instanceLocksError;
  }
  if (participantLocksError) {
    throw participantLocksError;
  }
  if (correctionsError) {
    throw correctionsError;
  }

  const claimBatchIds = Array.from(new Set([
    ...asArray(instanceLocks)
      .filter((lock) => lock.lock_source_type === 'claim_batch')
      .map((lock) => lock.lock_source_id),
    ...asArray(participantLocks)
      .filter((lock) => lock.lock_source_type === 'claim_batch')
      .map((lock) => lock.lock_source_id),
  ].filter(Boolean)));

  let claimBatchStatusById = new Map();
  if (claimBatchIds.length > 0) {
    const { data: claimBatches, error: claimBatchesError } = await tenantClient
      .from('claim_batches')
      .select('id, status, paid_at')
      .in('id', claimBatchIds);

    if (claimBatchesError) {
      throw claimBatchesError;
    }

    claimBatchStatusById = new Map(asArray(claimBatches).map((row) => [row.id, row]));
  }

  const instanceLocksById = new Map();
  for (const lock of asArray(instanceLocks)) {
    if (!instanceLocksById.has(lock.lesson_instance_id)) {
      instanceLocksById.set(lock.lesson_instance_id, []);
    }
    instanceLocksById.get(lock.lesson_instance_id).push(lock);
  }

  const participantLocksById = new Map();
  for (const lock of asArray(participantLocks)) {
    if (!participantLocksById.has(lock.lesson_participant_id)) {
      participantLocksById.set(lock.lesson_participant_id, []);
    }
    participantLocksById.get(lock.lesson_participant_id).push(lock);
  }

  const latestCorrectionByInstanceId = new Map();
  for (const correction of asArray(corrections)) {
    if (!latestCorrectionByInstanceId.has(correction.original_instance_id)) {
      latestCorrectionByInstanceId.set(correction.original_instance_id, correction);
    }
  }

  return rows.map((row) => {
    const instanceLockRows = (instanceLocksById.get(row.id) || []).map((lock) => {
      const claimBatch = lock.lock_source_type === 'claim_batch'
        ? claimBatchStatusById.get(lock.lock_source_id) || null
        : null;
      return {
        ...lock,
        claim_batch_status: claimBatch?.status || null,
        claim_batch_paid_at: claimBatch?.paid_at || null,
      };
    });

    const participantRows = asArray(row.participants).map((participant) => ({
      ...participant,
      locks: (participantLocksById.get(participant.id) || []).map((lock) => {
        const claimBatch = lock.lock_source_type === 'claim_batch'
          ? claimBatchStatusById.get(lock.lock_source_id) || null
          : null;
        return {
          ...lock,
          claim_batch_status: claimBatch?.status || null,
          claim_batch_paid_at: claimBatch?.paid_at || null,
        };
      }),
    }));

    const participantLockRows = participantRows.flatMap((participant) => participant.locks);
    const paidClaimBatchIds = Array.from(new Set([
      ...instanceLockRows
        .filter((lock) => lock.lock_source_type === 'claim_batch' && lock.claim_batch_status === 'paid')
        .map((lock) => lock.lock_source_id),
      ...participantLockRows
        .filter((lock) => lock.lock_source_type === 'claim_batch' && lock.claim_batch_status === 'paid')
        .map((lock) => lock.lock_source_id),
    ].filter(Boolean)));

    const hasInstanceFinanceLocks = instanceLockRows.some((lock) => lock.lock_source_type === 'payroll_run' || lock.lock_source_type === 'claim_batch');
    const hasParticipantFinanceLocks = participantRows.some((participant) => participant.locks.some((lock) => lock.lock_source_type === 'payroll_run' || lock.lock_source_type === 'claim_batch'));
    const latestCorrection = latestCorrectionByInstanceId.get(row.id) || null;
    return {
      ...row,
      participants: participantRows,
      is_locked: hasInstanceFinanceLocks || hasParticipantFinanceLocks,
      hard_blocked_by_paid_claim: paidClaimBatchIds.length > 0,
      paid_claim_batch_ids: paidClaimBatchIds,
      locks: {
        instance: instanceLockRows,
        participants: participantLockRows,
      },
      latest_correction: latestCorrection,
    };
  });
}
