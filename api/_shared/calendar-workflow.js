/* eslint-env node */
import { loadFinancePolicies } from './employee-finance.js';
import { listDashboardTasks } from './dashboard-tasks.js';
import { normalizeString } from './org-bff.js';
import { loadCommitmentsMap } from './student-billing.js';
import { isPlainObject, readParticipantWorkflowMetadata, shouldParticipantTriggerInstructorCompensation } from './calendar-workflow-decisions.js';
import { coerceAgorot } from './currency.js';

const RESOLVED_PARTICIPANT_STATUSES = new Set(['attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);
const LESSON_BILLING_USAGE_TYPES = ['standard', 'double', 'cross_service'];
const PAYROLL_SETTLED_STATUSES = new Set(['finalized']);
const CLAIM_SETTLED_STATUSES = new Set(['submitted', 'paid']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function roundCurrency(value) {
  return coerceAgorot(value);
}

function normalizeParticipantWorkflowMetadata(metadata) {
  return readParticipantWorkflowMetadata(metadata);
}

export function mergeParticipantWorkflowMetadata(existingMetadata, patch = {}) {
  const normalized = normalizeParticipantWorkflowMetadata(existingMetadata);
  return {
    ...normalized.root,
    workflow: {
      student_billing: {
        ...normalized.student_billing,
        ...(isPlainObject(patch.student_billing) ? patch.student_billing : {}),
      },
      instructor_compensation: {
        ...normalized.instructor_compensation,
        ...(isPlainObject(patch.instructor_compensation) ? patch.instructor_compensation : {}),
      },
      hmo_claim: {
        ...normalized.hmo_claim,
        ...(isPlainObject(patch.hmo_claim) ? patch.hmo_claim : {}),
      },
    },
  };
}

function getParticipantBillingArtifactAmount(ledgerRows) {
  return roundCurrency(asArray(ledgerRows).reduce((sum, row) => {
    const transactionType = normalizeString(row?.transaction_type).toUpperCase();
    if (transactionType === 'DEBIT') return sum + coerceAgorot(row?.amount);
    if (transactionType === 'CREDIT') return sum - coerceAgorot(row?.amount);
    return sum;
  }, 0));
}

function resolvePersistedBillingRequirement(participant, policies, status) {
  const pricingBreakdown = isPlainObject(participant?.pricing_breakdown) ? participant.pricing_breakdown : null;
  const policySnapshot = isPlainObject(pricingBreakdown?.policy_snapshot) ? pricingBreakdown.policy_snapshot : null;
  const billingPolicySnapshot = isPlainObject(policySnapshot?.billing_consumption_policy)
    ? policySnapshot.billing_consumption_policy
    : null;
  const persistedBillingStatus = normalizeString(pricingBreakdown?.billing_status).toLowerCase();
  const persistedLessonStatus = normalizeString(pricingBreakdown?.lesson_status).toLowerCase();

  if (persistedBillingStatus === 'not_chargeable') {
    return false;
  }
  if (pricingBreakdown?.policy_allowed === false) {
    return false;
  }
  if (pricingBreakdown?.policy_allowed === true) {
    return true;
  }
  if (persistedLessonStatus === 'cancelled_clinic' && status === 'cancelled_clinic') {
    return false;
  }

  if (billingPolicySnapshot && Object.prototype.hasOwnProperty.call(billingPolicySnapshot, status)) {
    return Boolean(billingPolicySnapshot[status]);
  }

  return Boolean(policies?.billingConsumptionPolicy?.[status]);
}

function evaluateParticipantSettlement(participant, context) {
  const status = normalizeString(participant?.participant_status).toLowerCase();
  const workflow = normalizeParticipantWorkflowMetadata(participant?.metadata);
  const attendanceResolved = RESOLVED_PARTICIPANT_STATUSES.has(status);
  const billingRequired = attendanceResolved
    && resolvePersistedBillingRequirement(participant, context?.policies, status);
  const ledgerRows = context?.ledgerRowsByParticipant?.get(participant.id) || [];
  const billedAmount = getParticipantBillingArtifactAmount(ledgerRows);
  const pricingBreakdown = isPlainObject(participant?.pricing_breakdown) ? participant.pricing_breakdown : null;
  const persistedBillingResolved = normalizeString(pricingBreakdown?.billing_status).toLowerCase() === 'charged';
  const billingResolved = attendanceResolved && (!billingRequired || billedAmount > 0 || persistedBillingResolved);

  const instructorCompensationRequired = shouldParticipantTriggerInstructorCompensation(participant, context?.policies);

  const openHmoTask = context?.openHmoTaskByParticipant?.get(participant.id) || null;
  const commitment = participant?.commitment_id ? (context?.commitmentById?.get(participant.commitment_id) || null) : null;
  const hmoCommitmentApplies = status === 'attended'
    && commitment
    && commitment.is_active !== false
    && (normalizeString(commitment?.commitment_type) === 'hmo' || Boolean(commitment?.hmo_provider_id));
  const participantLocks = context?.participantLocksByParticipant?.get(participant.id) || [];
  const submittedClaimLock = [
    ...asArray(context?.instanceLocks),
    ...asArray(participantLocks),
  ].some((lock) => {
    if (normalizeString(lock?.lock_source_type) !== 'claim_batch') return false;
    const claimBatch = context?.claimBatchById?.get(lock.lock_source_id) || null;
    return CLAIM_SETTLED_STATUSES.has(normalizeString(claimBatch?.status).toLowerCase());
  });
  const hmoClaimRequired = ['pending', 'required'].includes(workflow.hmo_claim.decision) || Boolean(openHmoTask) || hmoCommitmentApplies;
  const hmoClaimResolved = !hmoClaimRequired || submittedClaimLock;

  return {
    participant_id: participant.id,
    participant_status: status || 'scheduled',
    attendance_resolved: attendanceResolved,
    student_billing_required: billingRequired,
    student_billing_resolved: billingResolved,
    student_billing_amount: billedAmount,
    instructor_compensation_required: instructorCompensationRequired,
    hmo_claim_required: hmoClaimRequired,
    hmo_claim_resolved: hmoClaimResolved,
  };
}

export async function loadLessonWorkflowState(tenantClient, lessonInstanceId) {
  const normalizedLessonInstanceId = normalizeString(lessonInstanceId);
  if (!normalizedLessonInstanceId) {
    return null;
  }

  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .select('id, status, is_closed, closed_at, closed_by, datetime_start, duration_minutes, instructor_employee_id, service_id, metadata')
    .eq('id', normalizedLessonInstanceId)
    .maybeSingle();

  if (instanceError) {
    throw instanceError;
  }
  if (!instance) {
    return null;
  }

  const { data: participants, error: participantsError } = await tenantClient
    .from('lesson_participants')
    .select('id, lesson_instance_id, student_id, participant_status, commitment_id, price_charged, pricing_breakdown, metadata')
    .eq('lesson_instance_id', normalizedLessonInstanceId);

  if (participantsError) {
    throw participantsError;
  }

  const participantRows = asArray(participants);
  const participantIds = participantRows.map((row) => row.id).filter(Boolean);
  const commitmentIds = Array.from(new Set(participantRows.map((row) => row.commitment_id).filter(Boolean)));

  const [
    policies,
    { data: instanceLocks, error: instanceLocksError },
    { data: participantLocks, error: participantLocksError },
    { data: lessonEarnings, error: lessonEarningsError },
    { data: ledgerRows, error: ledgerRowsError },
    openTaskGroups,
  ] = await Promise.all([
    loadFinancePolicies(tenantClient),
    tenantClient
      .from('instance_locks')
      .select('id, lesson_instance_id, lock_source_type, lock_source_id, metadata')
      .eq('lesson_instance_id', normalizedLessonInstanceId),
    participantIds.length > 0
      ? tenantClient
        .from('participant_locks')
        .select('id, lesson_participant_id, lock_source_type, lock_source_id, metadata')
        .in('lesson_participant_id', participantIds)
      : Promise.resolve({ data: [], error: null }),
    tenantClient
      .from('lesson_earnings')
      .select('id, employee_id, lesson_instance_id, payout_amount, metadata')
      .eq('lesson_instance_id', normalizedLessonInstanceId),
    participantIds.length > 0
      ? tenantClient
        .from('ledger_transactions')
        .select('id, source_ref, transaction_type, usage_type, amount, metadata')
        .in('source_ref', participantIds)
        .in('usage_type', LESSON_BILLING_USAGE_TYPES)
      : Promise.resolve({ data: [], error: null }),
    participantIds.length > 0
      ? Promise.all(participantIds.map((participantId) => listDashboardTasks(tenantClient, {
        status: 'open',
        resourceType: 'lesson_participant',
        resourceId: participantId,
      })))
      : Promise.resolve([]),
  ]);

  if (instanceLocksError) throw instanceLocksError;
  if (participantLocksError) throw participantLocksError;
  if (lessonEarningsError && lessonEarningsError.code !== '42P01') throw lessonEarningsError;
  if (ledgerRowsError && ledgerRowsError.code !== '42P01') throw ledgerRowsError;

  const instanceLockRows = asArray(instanceLocks);
  const participantLockRows = asArray(participantLocks);
  const payrollRunIds = Array.from(new Set([
    ...instanceLockRows.filter((lock) => normalizeString(lock?.lock_source_type) === 'payroll_run').map((lock) => lock.lock_source_id),
    ...participantLockRows.filter((lock) => normalizeString(lock?.lock_source_type) === 'payroll_run').map((lock) => lock.lock_source_id),
  ].filter(Boolean)));
  const claimBatchIds = Array.from(new Set([
    ...instanceLockRows.filter((lock) => normalizeString(lock?.lock_source_type) === 'claim_batch').map((lock) => lock.lock_source_id),
    ...participantLockRows.filter((lock) => normalizeString(lock?.lock_source_type) === 'claim_batch').map((lock) => lock.lock_source_id),
  ].filter(Boolean)));

  const [{ data: payrollRuns, error: payrollRunsError }, { data: claimBatches, error: claimBatchesError }] = await Promise.all([
    payrollRunIds.length > 0
      ? tenantClient
        .from('payroll_runs')
        .select('id, status, finalized_at')
        .in('id', payrollRunIds)
      : Promise.resolve({ data: [], error: null }),
    claimBatchIds.length > 0
      ? tenantClient
        .from('claim_batches')
        .select('id, status, submitted_at, paid_at')
        .in('id', claimBatchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (payrollRunsError && payrollRunsError.code !== '42P01') throw payrollRunsError;
  if (claimBatchesError && claimBatchesError.code !== '42P01') throw claimBatchesError;

  const ledgerRowsByParticipant = new Map();
  for (const row of asArray(ledgerRows)) {
    const participantId = normalizeString(row?.source_ref);
    if (!participantId) continue;
    if (!ledgerRowsByParticipant.has(participantId)) {
      ledgerRowsByParticipant.set(participantId, []);
    }
    ledgerRowsByParticipant.get(participantId).push(row);
  }

  const openHmoTaskByParticipant = new Map();
  participantIds.forEach((participantId, index) => {
    const tasks = asArray(openTaskGroups?.[index]);
    const hmoTask = tasks.find((task) => normalizeString(task?.task_type) === 'hmo_claim_submission');
    if (hmoTask) {
      openHmoTaskByParticipant.set(participantId, hmoTask);
    }
  });

  const participantLocksByParticipant = new Map();
  for (const lock of participantLockRows) {
    const participantId = normalizeString(lock?.lesson_participant_id);
    if (!participantId) continue;
    if (!participantLocksByParticipant.has(participantId)) {
      participantLocksByParticipant.set(participantId, []);
    }
    participantLocksByParticipant.get(participantId).push(lock);
  }

  const commitmentById = await loadCommitmentsMap(tenantClient, commitmentIds);

  return {
    instance,
    participants: participantRows,
    policies,
    instanceLocks: instanceLockRows,
    participantLocks: participantLockRows,
    participantLocksByParticipant,
    lessonEarnings: asArray(lessonEarnings),
    ledgerRowsByParticipant,
    openHmoTaskByParticipant,
    commitmentById,
    payrollRunById: new Map(asArray(payrollRuns).map((row) => [row.id, row])),
    claimBatchById: new Map(asArray(claimBatches).map((row) => [row.id, row])),
  };
}

export function evaluateLessonClosureState(state) {
  if (!state?.instance) {
    return {
      should_close: false,
      reasons_open: ['missing_instance'],
      participants: [],
      summary: {},
    };
  }

  const participantEvaluations = asArray(state.participants).map((participant) => evaluateParticipantSettlement(participant, state));
  const allAttendanceResolved = participantEvaluations.every((entry) => entry.attendance_resolved);
  const allStudentBillingResolved = participantEvaluations.every((entry) => entry.student_billing_resolved);
  const allHmoResolved = participantEvaluations.every((entry) => entry.hmo_claim_resolved);
  const finalizedPayrollRunIds = Array.from(new Set([
    ...asArray(state.instanceLocks)
      .filter((lock) => normalizeString(lock?.lock_source_type) === 'payroll_run')
      .map((lock) => state.payrollRunById?.get(lock.lock_source_id))
      .filter((row) => PAYROLL_SETTLED_STATUSES.has(normalizeString(row?.status).toLowerCase()))
      .map((row) => row.id),
    ...asArray(state.participantLocks)
      .filter((lock) => normalizeString(lock?.lock_source_type) === 'payroll_run')
      .map((lock) => state.payrollRunById?.get(lock.lock_source_id))
      .filter((row) => PAYROLL_SETTLED_STATUSES.has(normalizeString(row?.status).toLowerCase()))
      .map((row) => row.id),
  ].filter(Boolean)));
  const settledClaimBatchIds = Array.from(new Set([
    ...asArray(state.instanceLocks)
      .filter((lock) => normalizeString(lock?.lock_source_type) === 'claim_batch')
      .map((lock) => state.claimBatchById?.get(lock.lock_source_id))
      .filter((row) => CLAIM_SETTLED_STATUSES.has(normalizeString(row?.status).toLowerCase()))
      .map((row) => row.id),
    ...asArray(state.participantLocks)
      .filter((lock) => normalizeString(lock?.lock_source_type) === 'claim_batch')
      .map((lock) => state.claimBatchById?.get(lock.lock_source_id))
      .filter((row) => CLAIM_SETTLED_STATUSES.has(normalizeString(row?.status).toLowerCase()))
      .map((row) => row.id),
  ].filter(Boolean)));
  const instructorCompensationRequired = participantEvaluations.some((entry) => entry.instructor_compensation_required);
  const lessonEarningExists = asArray(state.lessonEarnings).length > 0;
  const instructorCompensationResolved = !instructorCompensationRequired || (lessonEarningExists && finalizedPayrollRunIds.length > 0);

  const reasonsOpen = [];
  if (!allAttendanceResolved) reasonsOpen.push('attendance_unresolved');
  if (!allStudentBillingResolved) reasonsOpen.push('student_billing_unresolved');
  if (!instructorCompensationResolved) reasonsOpen.push('instructor_compensation_unresolved');
  if (!allHmoResolved) reasonsOpen.push('hmo_claim_unresolved');

  return {
    should_close: reasonsOpen.length === 0,
    reasons_open: reasonsOpen,
    participants: participantEvaluations,
    summary: {
      all_attendance_resolved: allAttendanceResolved,
      all_student_billing_resolved: allStudentBillingResolved,
      instructor_compensation_required: instructorCompensationRequired,
      instructor_compensation_resolved: instructorCompensationResolved,
      all_hmo_resolved: allHmoResolved,
      has_payroll_lock: finalizedPayrollRunIds.length > 0,
      lesson_earning_exists: lessonEarningExists,
      finalized_payroll_run_ids: finalizedPayrollRunIds,
      settled_claim_batch_ids: settledClaimBatchIds,
    },
  };
}

export async function syncLessonClosureState(tenantClient, lessonInstanceId, actorUserId = null) {
  const state = await loadLessonWorkflowState(tenantClient, lessonInstanceId);
  if (!state?.instance) {
    return null;
  }

  const evaluation = evaluateLessonClosureState(state);
  const currentMetadata = isPlainObject(state.instance.metadata) ? state.instance.metadata : {};
  const nextWorkflowState = {
    reasons_open: evaluation.reasons_open,
    summary: evaluation.summary,
    participants: evaluation.participants,
    evaluated_at: new Date().toISOString(),
  };
  const nextMetadata = {
    ...currentMetadata,
    workflow_state: nextWorkflowState,
  };
  const nextPayload = {
    is_closed: evaluation.should_close,
    metadata: nextMetadata,
    closed_at: evaluation.should_close ? (state.instance.closed_at || new Date().toISOString()) : null,
    closed_by: evaluation.should_close ? (state.instance.closed_by || actorUserId || null) : null,
  };

  const hasChanged = Boolean(
    state.instance.is_closed !== evaluation.should_close
      || normalizeString(state.instance.closed_at) !== normalizeString(nextPayload.closed_at)
      || normalizeString(state.instance.closed_by) !== normalizeString(nextPayload.closed_by)
      || JSON.stringify(currentMetadata.workflow_state || null) !== JSON.stringify(nextWorkflowState),
  );

  if (hasChanged) {
    const { error: updateError } = await tenantClient
      .from('lesson_instances')
      .update(nextPayload)
      .eq('id', lessonInstanceId);

    if (updateError) {
      throw updateError;
    }
  }

  return {
    lesson_instance_id: lessonInstanceId,
    is_closed: evaluation.should_close,
    reasons_open: evaluation.reasons_open,
    summary: evaluation.summary,
    participants: evaluation.participants,
  };
}
