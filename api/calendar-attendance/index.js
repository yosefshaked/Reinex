/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  fetchLessonMutationState,
  isLockedState,
  parseExpectedVersion,
  resolveActorInstructorId,
  respondWithLockedMutation,
  respondWithVersionConflict,
} from '../_shared/calendar-editing.js';
import {
  ensureMembership,
  isAdminRole,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import {
  computeLessonInstructorPayoutAmount,
  lessonHasInstructorCompensation,
  loadFinancePolicies,
  syncLessonInstructorEarnings,
  syncInstructorAttendanceFromLessons,
  validateInstructorRateForLesson,
} from '../_shared/employee-finance.js';
import { buildBillingDecision, loadCommitmentsMap, syncLessonBillingArtifacts } from '../_shared/student-billing.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { AUDIT_CATEGORIES, logAuditEvent } from '../_shared/audit-log.js';
import { createDashboardTask } from '../_shared/dashboard-tasks.js';
import { listDashboardTasks, resolveDashboardTask } from '../_shared/dashboard-tasks.js';
import { mergeParticipantWorkflowMetadata, syncLessonClosureState } from '../_shared/calendar-workflow.js';
import { normalizeWorkflowDecision } from '../_shared/calendar-workflow-decisions.js';

const MAX_BODY_BYTES = 64 * 1024;

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function getAttendanceStatusRequirements(tenantClient, participantStatus) {
  const normalizedStatus = typeof participantStatus === 'string'
    ? participantStatus.trim().toLowerCase()
    : '';
  const policies = await loadFinancePolicies(tenantClient);
  const studentBillingApplies = Boolean(policies?.billingConsumptionPolicy?.[normalizedStatus]);
  const requiresInstructorCompensationDecision = studentBillingApplies
    && (normalizedStatus === 'no_show' || normalizedStatus === 'cancelled_student' || normalizedStatus === 'cancelled_clinic');

  return {
    participant_status: normalizedStatus,
    student_billing_applies: studentBillingApplies,
    requires_instructor_compensation_decision: requiresInstructorCompensationDecision,
  };
}

/**
 * POST /api/calendar/attendance
 * Body:
 *   - org_id (required)
 *   - instance_id (UUID, required)
 *   - participant_id (UUID, required)
 *   - attended (boolean, optional)
 *   - participant_status (string, optional)
 *
 * Supports attendance status updates
 */
export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('calendar/attendance missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('calendar/attendance missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('calendar/attendance failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'calendar/attendance' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('calendar/attendance failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const isAdmin = isAdminRole(role);

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  return await handleMarkAttendance(context, body, tenantClient, userId, isAdmin, {
    supabase,
    orgId,
    userEmail: authResult.data.user.email || null,
    role,
  });
}

async function handleUpdateReminder(context, body, tenantClient, userId) {
  if (!body.instance_id) {
    return respond(context, 400, { message: 'missing instance_id' });
  }
  if (!body.participant_id) {
    return respond(context, 400, { message: 'missing participant_id' });
  }

  const expectedParticipantVersion = parseExpectedVersion(
    body.participant_version,
    body.participantVersion,
    body.version,
    body.expected_version,
    body.expectedVersion,
  );

  const { error: mutationStateError, result: mutationState } = await fetchLessonMutationState(tenantClient, {
    instanceId: body.instance_id,
    participantId: body.participant_id,
  });

  if (mutationStateError) {
    context.log?.error?.('calendar/attendance failed to load reminder mutation state', { message: mutationStateError.message });
    return respond(context, 500, { message: 'failed_to_load_attendance_state' });
  }

  if (!mutationState.instance || !mutationState.participant) {
    return respond(context, 404, { message: 'attendance_target_not_found' });
  }

  if (isLockedState(mutationState)) {
    return respondWithLockedMutation(context, {
      instanceId: body.instance_id,
      participantId: body.participant_id,
      instanceLocks: mutationState.instanceLocks,
      participantLocks: mutationState.participantLocks,
      closed: mutationState.instance?.is_closed || false,
    });
  }

  if (expectedParticipantVersion !== null && mutationState.participant.version !== expectedParticipantVersion) {
    return respondWithVersionConflict(context, {
      resourceType: 'lesson_participant',
      resourceId: body.participant_id,
      expectedVersion: expectedParticipantVersion,
      currentVersion: mutationState.participant.version,
    });
  }

  const update = {};
  if (typeof body.reminder_sent === 'boolean') {
    update.reminder_sent = body.reminder_sent;
  }
  if (typeof body.reminder_seen === 'boolean') {
    update.reminder_seen = body.reminder_seen;
  }

  if (Object.keys(update).length === 0) {
    return respond(context, 400, { message: 'no reminder fields to update' });
  }

  let updateQuery = tenantClient
    .from('lesson_participants')
    .update(update)
    .eq('id', body.participant_id)
    .eq('lesson_instance_id', body.instance_id);

  if (expectedParticipantVersion !== null) {
    const shouldFilterByVersion = !(
      mutationState.participant?.legacy_null_version
      && expectedParticipantVersion === 1
    );
    if (shouldFilterByVersion) {
      updateQuery = updateQuery.eq('version', expectedParticipantVersion);
    }
  }

  const { data: updatedRow, error } = await updateQuery.select('id, version').maybeSingle();

  if (error) {
    context.log?.error?.('calendar/attendance update-reminder failed', { message: error.message });
    return respond(context, 500, { message: 'failed_to_update_reminder' });
  }

  if (!updatedRow) {
    const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(tenantClient, {
      participantId: body.participant_id,
      instanceId: body.instance_id,
    });
    if (refreshedError) {
      context.log?.error?.('calendar/attendance failed to refresh reminder state after conflict', { message: refreshedError.message });
      return respond(context, 500, { message: 'failed_to_update_reminder' });
    }
    return respondWithVersionConflict(context, {
      resourceType: 'lesson_participant',
      resourceId: body.participant_id,
      expectedVersion: expectedParticipantVersion,
      currentVersion: refreshedState.participant?.version ?? null,
    });
  }

  try {
    await logTenantAuditEvent(tenantClient, {
      actorUserId: userId,
      eventType: 'calendar.lesson_participant.reminder_updated',
      retentionCategory: TENANT_AUDIT_RETENTION.DIAGNOSTIC,
      resourceType: 'lesson_participant',
      resourceId: body.participant_id,
      beforeState: mutationState.participant,
      afterState: {
        ...mutationState.participant,
        ...update,
        version: updatedRow.version,
      },
      details: {
        origin: 'api/calendar-attendance',
        lesson_instance_id: body.instance_id,
      },
    });
  } catch (auditError) {
    context.log?.warn?.('calendar/attendance failed to write tenant audit (reminder)', { message: auditError?.message, participantId: body.participant_id });
  }

  return respond(context, 200, { message: 'reminder updated' });
}

async function buildRestorePreview(tenantClient, body) {
  return buildParticipantStatusPreview(tenantClient, body, {
    targetStatus: 'scheduled',
    requestedInstructorCompensationDecision: 'unknown',
  });
}

async function buildParticipantStatusPreview(tenantClient, body, {
  targetStatus,
  requestedInstructorCompensationDecision = 'unknown',
} = {}) {
  const { error: mutationStateError, result: mutationState } = await fetchLessonMutationState(tenantClient, {
    instanceId: body.instance_id,
    participantId: body.participant_id,
  });

  if (mutationStateError) {
    throw mutationStateError;
  }

  const instance = mutationState.instance;
  const participant = mutationState.participant;
  if (!instance || !participant) {
    return null;
  }

  const resolvedTargetStatus = String(targetStatus || '').trim().toLowerCase();
  if (!resolvedTargetStatus) {
    return null;
  }

  const [{ data: instanceDetail, error: instanceDetailError }, { data: allParticipants, error: participantsError }, { data: lessonEarningRows, error: earningError }, { data: participantLedgerRows, error: ledgerError }, dashboardTasks] = await Promise.all([
    tenantClient
      .from('lesson_instances')
      .select('id, instructor_employee_id, service_id, duration_minutes, status, datetime_start')
      .eq('id', body.instance_id)
      .maybeSingle(),
    tenantClient
      .from('lesson_participants')
      .select('id, student_id, participant_status, lesson_instance_id, commitment_id, price_charged, pricing_breakdown, metadata')
      .eq('lesson_instance_id', body.instance_id),
    tenantClient
      .from('lesson_earnings')
      .select('id, employee_id, rate_used, payout_amount, metadata')
      .eq('lesson_instance_id', body.instance_id),
    tenantClient
      .from('ledger_transactions')
      .select('id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, metadata')
      .eq('source_ref', body.participant_id)
      .in('usage_type', ['standard', 'double', 'cross_service']),
    listDashboardTasks(tenantClient, {
      status: 'open',
      resourceType: 'lesson_participant',
      resourceId: body.participant_id,
    }),
  ]);

  if (instanceDetailError) throw instanceDetailError;
  if (participantsError) throw participantsError;
  if (earningError && earningError.code !== 'PGRST116' && earningError.code !== '42P01') throw earningError;
  if (ledgerError && ledgerError.code !== '42P01') throw ledgerError;
  if (!instanceDetail) return null;

  const currentParticipants = allParticipants || [];
  const projectedParticipants = currentParticipants.map((row) => {
    if (row.id !== body.participant_id) {
      return row;
    }

    const nextMetadata = requestedInstructorCompensationDecision === 'compensated' || requestedInstructorCompensationDecision === 'not_compensated'
      ? {
          ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
          workflow: {
            ...((row.metadata && typeof row.metadata === 'object' && row.metadata.workflow && typeof row.metadata.workflow === 'object')
              ? row.metadata.workflow
              : {}),
            instructor_compensation: {
              ...((row.metadata && typeof row.metadata === 'object' && row.metadata.workflow && typeof row.metadata.workflow === 'object' && row.metadata.workflow.instructor_compensation && typeof row.metadata.workflow.instructor_compensation === 'object')
                ? row.metadata.workflow.instructor_compensation
                : {}),
              decision: requestedInstructorCompensationDecision,
            },
          },
        }
      : row.metadata;

    return {
      ...row,
      participant_status: resolvedTargetStatus,
      metadata: nextMetadata,
    };
  });

  const anyScheduled = projectedParticipants.some((row) => row.participant_status === 'scheduled');
  const allResolved = projectedParticipants.every((row) => (
    row.participant_status === 'attended'
      || row.participant_status === 'no_show'
      || row.participant_status === 'cancelled_student'
      || row.participant_status === 'cancelled_clinic'
  ));
  const projectedInstanceStatus = anyScheduled
    ? 'scheduled'
    : (allResolved ? 'completed' : instance.status);

  const targetParticipantBefore = currentParticipants.find((row) => row.id === body.participant_id) || participant;
  const targetParticipantAfter = projectedParticipants.find((row) => row.id === body.participant_id) || targetParticipantBefore;
  const targetPricingBreakdown = targetParticipantBefore?.pricing_breakdown && typeof targetParticipantBefore.pricing_breakdown === 'object'
    ? targetParticipantBefore.pricing_breakdown
    : null;
  const participantLedgerArtifactId = typeof targetPricingBreakdown?.lesson_entry_id === 'string'
    ? targetPricingBreakdown.lesson_entry_id
    : '';

  let billingArtifactRows = Array.isArray(participantLedgerRows) ? [...participantLedgerRows] : [];
  if (billingArtifactRows.length === 0 && participantLedgerArtifactId) {
    const { data: participantLedgerArtifactRow, error: participantLedgerArtifactError } = await tenantClient
      .from('ledger_transactions')
      .select('id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, metadata')
      .eq('id', participantLedgerArtifactId)
      .maybeSingle();
    if (participantLedgerArtifactError && participantLedgerArtifactError.code !== 'PGRST116' && participantLedgerArtifactError.code !== '42P01') {
      throw participantLedgerArtifactError;
    }
    if (participantLedgerArtifactRow) {
      billingArtifactRows = [participantLedgerArtifactRow];
    }
  }

  const lessonDate = new Date(instanceDetail.datetime_start || Date.now());
  const lessonDateKey = String(instanceDetail.datetime_start || '').slice(0, 10);
  const policiesPromise = loadFinancePolicies(tenantClient);
  const [{ data: dayLessons, error: dayLessonsError }, { data: systemAttendanceRecord, error: attendanceError }, { data: employeeRow, error: employeeError }, { data: studentRow, error: studentError }, { data: capabilityRow, error: capabilityError }, policies] = await Promise.all([
    tenantClient
      .from('lesson_instances')
      .select('id, status, duration_minutes')
      .eq('instructor_employee_id', instanceDetail.instructor_employee_id)
      .gte('datetime_start', `${lessonDateKey}T00:00:00`)
      .lte('datetime_start', `${lessonDateKey}T23:59:59`),
    tenantClient
      .from('employee_attendance_records')
      .select('id, status, worked_minutes, source_type, metadata')
      .eq('employee_id', instanceDetail.instructor_employee_id)
      .eq('attendance_date', lessonDateKey)
      .in('source_type', ['manual', 'import', 'system'])
      .maybeSingle(),
    tenantClient
      .from('Employees')
      .select('id, first_name, middle_name, last_name')
      .eq('id', instanceDetail.instructor_employee_id)
      .maybeSingle(),
    tenantClient
      .from('students')
      .select('id, first_name, middle_name, last_name')
      .eq('id', participant.student_id)
      .maybeSingle(),
    tenantClient
      .from('instructor_service_capabilities')
      .select('base_rate')
      .eq('employee_id', instanceDetail.instructor_employee_id)
      .eq('service_id', instanceDetail.service_id)
      .maybeSingle(),
    policiesPromise,
  ]);

  if (dayLessonsError) throw dayLessonsError;
  if (attendanceError && attendanceError.code !== 'PGRST116' && attendanceError.code !== '42P01') throw attendanceError;
  if (employeeError && employeeError.code !== 'PGRST116') throw employeeError;
  if (studentError && studentError.code !== 'PGRST116') throw studentError;
  if (capabilityError && capabilityError.code !== 'PGRST116' && capabilityError.code !== '42P01') throw capabilityError;
  const commitmentMap = await loadCommitmentsMap(
    tenantClient,
    targetParticipantBefore?.commitment_id ? [targetParticipantBefore.commitment_id] : [],
  );
  const commitmentRow = targetParticipantBefore?.commitment_id
    ? (commitmentMap.get(targetParticipantBefore.commitment_id) || null)
    : null;

  const currentShouldInstructorEarn = Array.isArray(lessonEarningRows) && lessonEarningRows.length > 0;
  const projectedShouldInstructorEarn = lessonHasInstructorCompensation(projectedParticipants, policies);

  const allDayLessons = dayLessons || [];
  const dayLessonIds = allDayLessons.map((row) => row.id).filter(Boolean);
  const { data: dayParticipants, error: dayParticipantsError } = dayLessonIds.length > 0
    ? await tenantClient
      .from('lesson_participants')
      .select('lesson_instance_id, participant_status, metadata')
      .in('lesson_instance_id', dayLessonIds)
    : { data: [], error: null };
  if (dayParticipantsError && dayParticipantsError.code !== '42P01') throw dayParticipantsError;

  const participantsByLesson = new Map();
  for (const row of dayParticipants || []) {
    if (!participantsByLesson.has(row.lesson_instance_id)) {
      participantsByLesson.set(row.lesson_instance_id, []);
    }
    participantsByLesson.get(row.lesson_instance_id).push(row);
  }

  const projectedAttendanceLessons = allDayLessons.filter((lesson) => {
    const lessonParticipants = lesson.id === body.instance_id
      ? projectedParticipants.map((row) => ({
          lesson_instance_id: body.instance_id,
          participant_status: row.participant_status,
          metadata: row.metadata,
        }))
      : (participantsByLesson.get(lesson.id) || []);
    return lessonHasInstructorCompensation(lessonParticipants, policies);
  });

  const projectedWorkedMinutes = projectedAttendanceLessons.reduce((sum, row) => sum + Number(row.duration_minutes || 0), 0);
  const currentAttendanceWorkedMinutes = Number(systemAttendanceRecord?.worked_minutes || 0);
  const effectiveProjectedWorkedMinutes = projectedWorkedMinutes;

  const openHmoTask = (dashboardTasks || []).find((task) => task.task_type === 'hmo_claim_submission' && task.status === 'open') || null;
  const storedLessonEarningAmount = roundCurrency((lessonEarningRows || []).reduce((sum, row) => sum + Number(row?.payout_amount || 0), 0));
  const inferredLessonEarningAmount = computeLessonInstructorPayoutAmount(instanceDetail, capabilityRow?.base_rate || 0);
  const lessonEarningAmount = storedLessonEarningAmount;
  const ledgerAmount = roundCurrency((billingArtifactRows || []).reduce((sum, row) => {
    if (row.transaction_type === 'DEBIT') return sum + Number(row.amount || 0);
    if (row.transaction_type === 'CREDIT') return sum - Number(row.amount || 0);
    return sum;
  }, 0));
  const projectedBillingDecision = buildBillingDecision({
    participant: targetParticipantAfter,
    instance: {
      ...instanceDetail,
      status: projectedInstanceStatus,
    },
    commitment: commitmentRow || null,
    policies,
  });
  const projectedChargeAmount = roundCurrency(Number(projectedBillingDecision?.chargeAmount || 0));

  const instructorName = [employeeRow?.first_name, employeeRow?.middle_name, employeeRow?.last_name].filter(Boolean).join(' ').trim() || 'המדריך';
  const studentName = [studentRow?.first_name, studentRow?.middle_name, studentRow?.last_name].filter(Boolean).join(' ').trim() || 'התלמיד';
  const monthLabel = lessonDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

  const impacts = [];
  if (targetParticipantBefore.participant_status !== resolvedTargetStatus) {
    impacts.push({
      type: 'participant_status',
      message: `סטטוס התלמיד ישתנה מ-${targetParticipantBefore.participant_status} ל-${resolvedTargetStatus}.`,
    });
  }
  if (requestedInstructorCompensationDecision === 'compensated' || requestedInstructorCompensationDecision === 'not_compensated') {
    impacts.push({
      type: 'instructor_compensation_decision',
      decision: requestedInstructorCompensationDecision,
      message: requestedInstructorCompensationDecision === 'compensated'
        ? `הפעולה תשמור שהמדריך יקבל פיצוי עבור ${studentName}.`
        : `הפעולה תשמור שהמדריך לא יקבל פיצוי עבור ${studentName}.`,
    });
  }
  if (projectedInstanceStatus !== instance.status) {
    impacts.push({
      type: 'lesson_status',
      message: `סטטוס השיעור ישתנה מ-${instance.status} ל-${projectedInstanceStatus}.`,
    });
  }
  if (ledgerAmount > 0 && projectedChargeAmount <= 0) {
    impacts.push({
      type: 'billing_reversal',
      amount: ledgerAmount,
      message: `₪${ledgerAmount} יוחזרו ליתרה של ${studentName}.`,
    });
  } else if (ledgerAmount <= 0 && projectedChargeAmount > 0) {
    impacts.push({
      type: 'billing_charge',
      amount: projectedChargeAmount,
      message: `₪${projectedChargeAmount} יחויבו ליתרה של ${studentName}.`,
    });
  } else if (ledgerAmount > 0 && projectedChargeAmount > 0 && ledgerAmount !== projectedChargeAmount) {
    impacts.push({
      type: 'billing_update',
      amount_before: ledgerAmount,
      amount_after: projectedChargeAmount,
      message: `חיוב היתרה של ${studentName} יעודכן מ-₪${ledgerAmount} ל-₪${projectedChargeAmount}.`,
    });
  }
  if (currentShouldInstructorEarn && !projectedShouldInstructorEarn && lessonEarningAmount !== 0) {
    impacts.push({
      type: 'instructor_earning_reversal',
      amount: lessonEarningAmount,
      message: `₪${lessonEarningAmount} יוסרו מהשכר של ${instructorName} עבור ${monthLabel}.`,
    });
  } else if (!currentShouldInstructorEarn && projectedShouldInstructorEarn && inferredLessonEarningAmount !== 0) {
    impacts.push({
      type: 'instructor_earning_add',
      amount: inferredLessonEarningAmount,
      message: `₪${inferredLessonEarningAmount} יתווספו לשכר של ${instructorName} עבור ${monthLabel}.`,
    });
  } else if (currentShouldInstructorEarn && projectedShouldInstructorEarn && lessonEarningAmount !== inferredLessonEarningAmount) {
    impacts.push({
      type: 'instructor_earning_update',
      amount_before: lessonEarningAmount,
      amount_after: inferredLessonEarningAmount,
      message: `שכר השיעור של ${instructorName} עבור ${monthLabel} יעודכן מ-₪${lessonEarningAmount} ל-₪${inferredLessonEarningAmount}.`,
    });
  }
  if (systemAttendanceRecord?.source_type === 'system') {
    if (currentAttendanceWorkedMinutes > 0 && effectiveProjectedWorkedMinutes === 0) {
      impacts.push({
        type: 'instructor_attendance_remove',
        message: `נוכחות המדריך של ${instructorName} בתאריך ${lessonDateKey} תוסר.`,
      });
    } else if (currentAttendanceWorkedMinutes !== effectiveProjectedWorkedMinutes) {
      impacts.push({
        type: 'instructor_attendance_update',
        message: `נוכחות המדריך של ${instructorName} בתאריך ${lessonDateKey} תשתנה ל-${effectiveProjectedWorkedMinutes} דקות.`,
      });
    }
  } else if (!systemAttendanceRecord && projectedWorkedMinutes > 0) {
    impacts.push({
      type: 'instructor_attendance_add',
      message: `נוכחות מערכתית של ${instructorName} בתאריך ${lessonDateKey} תיווצר עם ${projectedWorkedMinutes} דקות.`,
    });
  }
  if (openHmoTask && resolvedTargetStatus === 'scheduled') {
    impacts.push({
      type: 'hmo_task_resolve',
      message: `משימת הגשת התביעה עבור ${studentName} תסומן כטופלה.`,
      task_id: openHmoTask.id,
    });
  }

  return {
    participant_id: participant.id,
    participant_status_before: participant.participant_status,
    participant_status_after: resolvedTargetStatus,
    lesson_instance_id: instance.id,
    lesson_status_before: instance.status,
    lesson_status_after: projectedInstanceStatus,
    impacts,
    projected: {
      billing_amount_before: ledgerAmount,
      billing_amount_after: projectedChargeAmount,
      billing_amount_reversed: ledgerAmount > 0 && projectedChargeAmount <= 0 ? ledgerAmount : 0,
      billing_amount_added: ledgerAmount <= 0 && projectedChargeAmount > 0 ? projectedChargeAmount : 0,
      instructor_earning_before: lessonEarningAmount,
      instructor_earning_after: projectedShouldInstructorEarn ? inferredLessonEarningAmount : 0,
      instructor_earning_removed: currentShouldInstructorEarn && !projectedShouldInstructorEarn && lessonEarningAmount !== 0 ? lessonEarningAmount : 0,
      instructor_earning_added: !currentShouldInstructorEarn && projectedShouldInstructorEarn && inferredLessonEarningAmount !== 0 ? inferredLessonEarningAmount : 0,
      instructor_attendance_worked_minutes_before: currentAttendanceWorkedMinutes > 0 ? currentAttendanceWorkedMinutes : null,
      instructor_attendance_worked_minutes: effectiveProjectedWorkedMinutes > 0 ? effectiveProjectedWorkedMinutes : null,
      hmo_task_id_to_resolve: resolvedTargetStatus === 'scheduled' ? (openHmoTask?.id || null) : null,
      instructor_compensation_decision: requestedInstructorCompensationDecision === 'unknown' ? null : requestedInstructorCompensationDecision,
    },
  };
}

async function buildAttendanceTransitionAuditChanges(preview) {
  if (!preview) {
    return [];
  }

  const changes = [
    {
      field: 'participant_status',
      before: preview.participant_status_before,
      after: preview.participant_status_after,
    },
  ];

  if (preview.lesson_status_before !== preview.lesson_status_after) {
    changes.push({
      field: 'lesson_status',
      before: preview.lesson_status_before,
      after: preview.lesson_status_after,
    });
  }

  if (Number(preview.projected?.billing_amount_reversed || 0) > 0) {
    changes.push({
      field: 'billing_amount_reversed',
      before: 0,
      after: roundCurrency(preview.projected.billing_amount_reversed),
    });
  }
  if (Number(preview.projected?.billing_amount_added || 0) > 0) {
    changes.push({
      field: 'billing_amount_added',
      before: 0,
      after: roundCurrency(preview.projected.billing_amount_added),
    });
  }

  const instructorEarningBefore = roundCurrency(preview.projected?.instructor_earning_before || 0);
  const instructorEarningAfter = roundCurrency(preview.projected?.instructor_earning_after || 0);
  if (Number(preview.projected?.instructor_earning_removed || 0) > 0) {
    changes.push({
      field: 'instructor_earning_removed',
      before: 0,
      after: roundCurrency(preview.projected.instructor_earning_removed),
    });
  }
  if (Number(preview.projected?.instructor_earning_added || 0) > 0) {
    changes.push({
      field: 'instructor_earning_added',
      before: 0,
      after: roundCurrency(preview.projected.instructor_earning_added),
    });
  }
  if (
    instructorEarningBefore > 0
    && instructorEarningAfter > 0
    && instructorEarningBefore !== instructorEarningAfter
  ) {
    changes.push({
      field: 'instructor_earning_amount',
      before: instructorEarningBefore,
      after: instructorEarningAfter,
    });
  }

  const attendanceImpact = (preview.impacts || []).some((impact) => (
    impact?.type === 'instructor_attendance_remove'
      || impact?.type === 'instructor_attendance_update'
      || impact?.type === 'instructor_attendance_add'
  ));
  if (attendanceImpact) {
    changes.push({
      field: 'instructor_attendance_worked_minutes',
      before: preview.projected?.instructor_attendance_worked_minutes_before,
      after: preview.projected?.instructor_attendance_worked_minutes,
    });
  }

  if (preview.projected?.hmo_task_id_to_resolve) {
    changes.push({
      field: 'hmo_task_resolved',
      before: false,
      after: true,
    });
  }

  return changes;
}

async function handleMarkAttendance(context, body, tenantClient, userId, isAdmin, auditContext = {}) {
  if (body.action === 'update-reminder') {
    return handleUpdateReminder(context, body, tenantClient, userId);
  }
  if (body.action === 'status-requirements') {
    const requestedStatus = typeof body.participant_status === 'string'
      ? body.participant_status.trim().toLowerCase()
      : '';
    if (!requestedStatus) {
      return respond(context, 400, { message: 'missing participant_status' });
    }
    try {
      const requirements = await getAttendanceStatusRequirements(tenantClient, requestedStatus);
      return respond(context, 200, requirements);
    } catch (error) {
      context.log?.error?.('calendar/attendance failed to load status requirements', {
        message: error?.message,
        participantStatus: requestedStatus,
      });
      return respond(context, 500, { message: 'failed_to_load_status_requirements' });
    }
  }
  const isRestorePreviewAction = body.action === 'preview-restore-to-scheduled';
  const isStatusChangePreviewAction = body.action === 'preview-participant-status-change';

  // Validate required fields
  if (!body.instance_id) {
    return respond(context, 400, { message: 'missing instance_id' });
  }
  if (!body.participant_id) {
    return respond(context, 400, { message: 'missing participant_id' });
  }

  const hasAttendedFlag = typeof body.attended === 'boolean';
  const requestedParticipantStatus = typeof body.participant_status === 'string'
    ? body.participant_status.trim().toLowerCase()
    : '';
  const hasParticipantStatus = Boolean(requestedParticipantStatus);
  const expectedInstanceVersion = parseExpectedVersion(
    body.instance_version,
    body.instanceVersion,
    body.lesson_instance_version,
    body.lessonInstanceVersion,
  );
  const expectedParticipantVersion = parseExpectedVersion(
    body.participant_version,
    body.participantVersion,
    body.version,
    body.expected_version,
    body.expectedVersion,
  );

  if (!isRestorePreviewAction && !isStatusChangePreviewAction && !hasAttendedFlag && !hasParticipantStatus) {
    return respond(context, 400, {
      message: 'missing update payload (expected attended or participant_status)',
    });
  }

  // Fetch instance to verify permissions
  const { error: mutationStateError, result: mutationState } = await fetchLessonMutationState(tenantClient, {
    instanceId: body.instance_id,
    participantId: body.participant_id,
  });

  if (mutationStateError) {
    context.log?.error?.('calendar/attendance failed to load mutation state', { message: mutationStateError.message });
    return respond(context, 500, { message: 'failed_to_load_attendance_state' });
  }

  const instance = mutationState.instance;
  const participant = mutationState.participant;

  if (!instance || !participant) {
    return respond(context, 404, { message: 'instance not found' });
  }

  if (isLockedState(mutationState)) {
    return respondWithLockedMutation(context, {
      instanceId: body.instance_id,
      participantId: body.participant_id,
      instanceLocks: mutationState.instanceLocks,
      participantLocks: mutationState.participantLocks,
      closed: mutationState.instance?.is_closed || false,
    });
  }

  if (expectedInstanceVersion !== null && instance.version !== expectedInstanceVersion) {
    return respondWithVersionConflict(context, {
      resourceType: 'lesson_instance',
      resourceId: body.instance_id,
      expectedVersion: expectedInstanceVersion,
      currentVersion: instance.version,
    });
  }

  if (expectedParticipantVersion !== null && participant.version !== expectedParticipantVersion) {
    return respondWithVersionConflict(context, {
      resourceType: 'lesson_participant',
      resourceId: body.participant_id,
      expectedVersion: expectedParticipantVersion,
      currentVersion: participant.version,
    });
  }

  // Non-admin users can only mark attendance for their own lessons
  if (!isAdmin) {
    const { instructorId, error: instructorError } = await resolveActorInstructorId(tenantClient, userId);
    if (instructorError) {
      context.log?.error?.('calendar/attendance failed to resolve actor instructor', { message: instructorError.message, userId });
      return respond(context, 500, { message: 'failed_to_resolve_actor_instructor' });
    }

    if (!instructorId || instructorId !== instance.instructor_employee_id) {
      return respond(context, 403, { message: 'forbidden: can only mark attendance for your own lessons' });
    }
  }

  if (isRestorePreviewAction) {
    try {
      const preview = await buildRestorePreview(tenantClient, body);
      if (!preview) {
        return respond(context, 404, { message: 'instance not found' });
      }
      return respond(context, 200, preview);
    } catch (error) {
      context.log?.error?.('calendar/attendance failed to build restore preview', {
        message: error?.message,
        instanceId: body.instance_id,
        participantId: body.participant_id,
      });
      return respond(context, 500, { message: 'failed_to_build_restore_preview' });
    }
  }

  if (isStatusChangePreviewAction) {
    const previewTargetStatus = typeof body.target_participant_status === 'string'
      ? body.target_participant_status.trim().toLowerCase()
      : '';
    const requestedDecision = normalizeWorkflowDecision(
      body.instructor_compensation_decision ?? body.instructorCompensationDecision,
      'unknown',
    );
    if (!previewTargetStatus) {
      return respond(context, 400, { message: 'missing target_participant_status' });
    }
    try {
      const preview = await buildParticipantStatusPreview(tenantClient, body, {
        targetStatus: previewTargetStatus,
        requestedInstructorCompensationDecision: requestedDecision,
      });
      if (!preview) {
        return respond(context, 404, { message: 'instance not found' });
      }
      return respond(context, 200, preview);
    } catch (error) {
      context.log?.error?.('calendar/attendance failed to build participant status preview', {
        message: error?.message,
        instanceId: body.instance_id,
        participantId: body.participant_id,
        targetStatus: previewTargetStatus,
      });
      return respond(context, 500, { message: 'failed_to_build_status_change_preview' });
    }
  }

  // Instructor rate pre-flight: block attendance marking if the instructor has no base_rate
  // for this service. Skip the check when the lesson is already cancelled by the clinic
  // (in that case instructor earnings are not triggered regardless).
  if (instance.status !== 'cancelled_clinic') {
    const rateError = await validateInstructorRateForLesson(tenantClient, {
      instructorEmployeeId: instance.instructor_employee_id,
      serviceId: instance.service_id,
    });
    if (rateError) {
      return respond(context, 422, {
        message: 'לא ניתן לעדכן נוכחות: תעריף המדריך לשירות זה לא הוגדר. יש להגדיר תעריף בכרטיס המדריך.',
        code: rateError.code,
        instructor_employee_id: rateError.instructor_employee_id,
        service_id: rateError.service_id,
      });
    }
  }

  const participantUpdate = {};
  let transitionAuditPreview = null;
  let requestedInstructorCompensationDecision = 'unknown';

  if (hasAttendedFlag || hasParticipantStatus) {
    const allowedParticipantStatuses = new Set(['scheduled', 'attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);
    const participantStatus = hasAttendedFlag
      ? (body.attended ? 'attended' : 'no_show')
      : requestedParticipantStatus;

    if (!allowedParticipantStatuses.has(participantStatus)) {
      return respond(context, 400, { message: 'invalid participant_status' });
    }

    participantUpdate.participant_status = participantStatus;
    participantUpdate.updated_by = userId;
    requestedInstructorCompensationDecision = normalizeWorkflowDecision(
      body.instructor_compensation_decision ?? body.instructorCompensationDecision,
      'unknown',
    );

    if (participantStatus !== 'scheduled' && participantStatus !== 'attended') {
      const statusRequirements = await getAttendanceStatusRequirements(tenantClient, participantStatus);

      if (statusRequirements.requires_instructor_compensation_decision && !['compensated', 'not_compensated'].includes(requestedInstructorCompensationDecision)) {
        return respond(context, 400, {
          message: 'missing_instructor_compensation_decision',
          code: 'missing_instructor_compensation_decision',
          participant_status: participantStatus,
        });
      }
    }

    if (participantStatus === 'scheduled') {
      try {
        transitionAuditPreview = await buildRestorePreview(tenantClient, body);
      } catch (previewError) {
        context.log?.warn?.('calendar/attendance failed to capture restore preview for audit', {
          message: previewError?.message,
          instanceId: body.instance_id,
          participantId: body.participant_id,
        });
      }

      // Restoring a participant reopens the attendance/reminder workflow.
      participantUpdate.reminder_sent = false;
      participantUpdate.reminder_seen = false;
      participantUpdate.attendance_confirmed_at = null;
      participantUpdate.attendance_confirmed_by = null;
    } else {
      participantUpdate.attendance_confirmed_at = new Date().toISOString();
      participantUpdate.attendance_confirmed_by = userId;
    }

    if (!transitionAuditPreview && participant.participant_status !== participantStatus) {
      try {
        transitionAuditPreview = await buildParticipantStatusPreview(tenantClient, body, {
          targetStatus: participantStatus,
          requestedInstructorCompensationDecision,
        });
      } catch (previewError) {
        context.log?.warn?.('calendar/attendance failed to capture status transition preview for audit', {
          message: previewError?.message,
          instanceId: body.instance_id,
          participantId: body.participant_id,
          targetStatus: participantStatus,
        });
      }
    }

    // Persist optional notes into metadata.notes
    const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
    if (notes !== null) {
      // Fetch existing metadata to merge (avoids clobbering unrelated keys)
      const { data: existing } = await tenantClient
        .from('lesson_participants')
        .select('metadata')
        .eq('id', body.participant_id)
        .eq('lesson_instance_id', body.instance_id)
        .maybeSingle();

      const existingMeta = (existing?.metadata && typeof existing.metadata === 'object') ? existing.metadata : {};
      participantUpdate.metadata = { ...existingMeta, notes: notes || null };
    }
  }

  let participantUpdateQuery = tenantClient
    .from('lesson_participants')
    .update(participantUpdate)
    .eq('id', body.participant_id)
    .eq('lesson_instance_id', body.instance_id);

  if (expectedParticipantVersion !== null) {
    const shouldFilterByVersion = !(
      participant?.legacy_null_version
      && expectedParticipantVersion === 1
    );
    if (shouldFilterByVersion) {
      participantUpdateQuery = participantUpdateQuery.eq('version', expectedParticipantVersion);
    }
  }

  const { data: updatedParticipant, error: updateError } = await participantUpdateQuery
    .select('id, version')
    .maybeSingle();

  if (updateError) {
    context.log?.error?.('calendar/attendance failed to update participant', { 
      message: updateError.message,
    });
    return respond(context, 500, { message: 'failed_to_update_attendance' });
  }

  if (!updatedParticipant) {
    const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(tenantClient, {
      instanceId: body.instance_id,
      participantId: body.participant_id,
    });
    if (refreshedError) {
      context.log?.error?.('calendar/attendance failed to refresh participant after conflict', { message: refreshedError.message });
      return respond(context, 500, { message: 'failed_to_update_attendance' });
    }
    return respondWithVersionConflict(context, {
      resourceType: 'lesson_participant',
      resourceId: body.participant_id,
      expectedVersion: expectedParticipantVersion,
      currentVersion: refreshedState.participant?.version ?? null,
    });
  }

  try {
    await logTenantAuditEvent(tenantClient, {
      actorUserId: userId,
      eventType: 'calendar.lesson_participant.attendance_updated',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'lesson_participant',
      resourceId: body.participant_id,
      beforeState: participant,
      afterState: {
        ...participant,
        ...participantUpdate,
        version: updatedParticipant.version,
      },
      details: {
        origin: 'api/calendar-attendance',
        lesson_instance_id: body.instance_id,
      },
    });
  } catch (auditError) {
    context.log?.warn?.('calendar/attendance failed to write tenant audit (attendance)', { message: auditError?.message, participantId: body.participant_id });
  }

  if (participantUpdate.participant_status) {
    try {
      const policies = await loadFinancePolicies(tenantClient);
      const currentMetadata = mutationState.instance?.metadata && typeof mutationState.instance.metadata === 'object'
        ? mutationState.instance.metadata
        : {};
      const existingSnapshots = currentMetadata.attendance_resolution_snapshots && typeof currentMetadata.attendance_resolution_snapshots === 'object'
        ? currentMetadata.attendance_resolution_snapshots
        : {};

      await tenantClient
        .from('lesson_instances')
        .update({
          metadata: {
            ...currentMetadata,
            attendance_resolution_snapshots: {
              ...existingSnapshots,
              [body.participant_id]: {
                evaluated_at: new Date().toISOString(),
                participant_status: participantUpdate.participant_status,
                billing_consumption_policy: policies.billingConsumptionPolicy,
                instructor_earnings_policy: policies.instructorEarningsPolicy,
                instructor_compensation_decision:
                  requestedInstructorCompensationDecision === 'unknown'
                    ? null
                    : requestedInstructorCompensationDecision,
              },
            },
          },
        })
        .eq('id', body.instance_id);
    } catch (snapshotError) {
      context.log?.warn?.('calendar/attendance failed to persist attendance decision snapshot', {
        message: snapshotError?.message,
        instanceId: body.instance_id,
        participantId: body.participant_id,
      });
    }

    try {
      const workflowPatch = participantUpdate.participant_status === 'scheduled'
        ? {
            student_billing: {
              decision: 'unknown',
              decided_at: new Date().toISOString(),
              decided_by: userId,
              reason: 'restored_to_scheduled',
            },
            instructor_compensation: {
              decision: 'unknown',
              decided_at: new Date().toISOString(),
              decided_by: userId,
              reason: 'restored_to_scheduled',
            },
            hmo_claim: {
              decision: 'unknown',
              decided_at: new Date().toISOString(),
              decided_by: userId,
              reason: 'restored_to_scheduled',
            },
          }
        : {
            student_billing: {
              decision: 'pending',
              decided_at: new Date().toISOString(),
              decided_by: userId,
              reason: participantUpdate.participant_status,
            },
            instructor_compensation: {
              decision: participantUpdate.participant_status === 'attended'
                ? 'compensated'
                : (requestedInstructorCompensationDecision === 'compensated' || requestedInstructorCompensationDecision === 'not_compensated'
                  ? requestedInstructorCompensationDecision
                  : 'pending'),
              decided_at: new Date().toISOString(),
              decided_by: userId,
              reason: participantUpdate.participant_status,
            },
            hmo_claim: {
              decision: participantUpdate.participant_status === 'attended' ? 'pending' : 'not_required',
              decided_at: new Date().toISOString(),
              decided_by: userId,
              reason: participantUpdate.participant_status,
            },
          };

      const mergedWorkflowMetadata = mergeParticipantWorkflowMetadata(participantUpdate.metadata ?? participant.metadata, workflowPatch);
      const metadataPayload = participantUpdate.metadata && typeof participantUpdate.metadata === 'object'
        ? { ...participantUpdate.metadata, workflow: mergedWorkflowMetadata.workflow }
        : mergedWorkflowMetadata;

      const { error: workflowUpdateError } = await tenantClient
        .from('lesson_participants')
        .update({ metadata: metadataPayload })
        .eq('id', body.participant_id)
        .eq('lesson_instance_id', body.instance_id);

      if (workflowUpdateError) {
        throw workflowUpdateError;
      }
    } catch (workflowError) {
      context.log?.warn?.('calendar/attendance failed to persist participant workflow metadata', {
        message: workflowError?.message,
        instanceId: body.instance_id,
        participantId: body.participant_id,
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(participantUpdate, 'participant_status')) {
    // Check if all participants have attendance statuses so instance can be marked completed.
    const { data: allParticipants, error: fetchError } = await tenantClient
      .from('lesson_participants')
      .select('participant_status')
      .eq('lesson_instance_id', body.instance_id);

    if (fetchError) {
      context.log?.error?.('calendar/attendance failed to fetch participants', { message: fetchError.message });
    } else if (allParticipants) {
      const allMarked = allParticipants.every((p) => (
        p.participant_status === 'attended'
          || p.participant_status === 'no_show'
          || p.participant_status === 'cancelled_student'
          || p.participant_status === 'cancelled_clinic'
      ));

      if (allMarked) {
        let instanceUpdateQuery = tenantClient
          .from('lesson_instances')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
            updated_by: userId,
          })
          .eq('id', body.instance_id);

        if (expectedInstanceVersion !== null) {
          const shouldFilterByVersion = !(
            instance?.legacy_null_version
            && expectedInstanceVersion === 1
          );
          if (shouldFilterByVersion) {
            instanceUpdateQuery = instanceUpdateQuery.eq('version', expectedInstanceVersion);
          }
        }

        await instanceUpdateQuery;
      } else if (instance.status === 'completed') {
        let instanceUpdateQuery = tenantClient
          .from('lesson_instances')
          .update({
            status: 'scheduled',
            updated_at: new Date().toISOString(),
            updated_by: userId,
          })
          .eq('id', body.instance_id);

        if (expectedInstanceVersion !== null) {
          const shouldFilterByVersion = !(
            instance?.legacy_null_version
            && expectedInstanceVersion === 1
          );
          if (shouldFilterByVersion) {
            instanceUpdateQuery = instanceUpdateQuery.eq('version', expectedInstanceVersion);
          }
        }

        await instanceUpdateQuery;
      }
    }
  }

  let billingWarnings = [];
  try {
    const billingResult = await syncLessonBillingArtifacts(tenantClient, body.instance_id, userId);
    await syncLessonInstructorEarnings(tenantClient, body.instance_id, userId);
    await syncInstructorAttendanceFromLessons(tenantClient, body.instance_id, userId);
    billingWarnings = billingResult?.attention_required || [];
  } catch (syncError) {
    context.log?.error?.('calendar/attendance failed to sync financial artifacts', {
      message: syncError?.message,
      instanceId: body.instance_id,
    });
    return respond(context, 500, { message: 'failed_to_sync_financial_artifacts' });
  }

  // HMO claim workflow task: when a participant is marked attended on an HMO commitment,
  // create a dashboard task prompting the clinic to submit the claim.
  if (participantUpdate.participant_status === 'attended') {
    try {
      const [{ data: participantDetail }, { data: instanceDetail }] = await Promise.all([
        tenantClient
          .from('lesson_participants')
          .select('student_id, commitment_id')
          .eq('id', body.participant_id)
          .maybeSingle(),
        tenantClient
          .from('lesson_instances')
          .select('datetime_start')
          .eq('id', body.instance_id)
          .maybeSingle(),
      ]);

      if (participantDetail?.commitment_id) {
        const { data: commitment } = await tenantClient
          .from('commitments')
          .select('commitment_type, hmo_provider_id, is_active')
          .eq('id', participantDetail.commitment_id)
          .maybeSingle();

        const isHmo = commitment?.is_active !== false
          && (commitment?.commitment_type === 'hmo' || Boolean(commitment?.hmo_provider_id));

        if (isHmo) {
          const { data: student } = await tenantClient
            .from('students')
            .select('first_name, last_name')
            .eq('id', participantDetail.student_id)
            .maybeSingle();

          const studentName = [student?.first_name, student?.last_name].filter(Boolean).join(' ') || 'תלמיד';
          const lessonDate = instanceDetail?.datetime_start
            ? new Date(instanceDetail.datetime_start).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '';
          const description = lessonDate
            ? `שיעור של ${studentName} בתאריך ${lessonDate} דורש הגשת תביעה.`
            : `שיעור של ${studentName} דורש הגשת תביעה.`;

          await createDashboardTask(tenantClient, {
            taskType: 'hmo_claim_submission',
            title: 'הגשת תביעה לביטוח לאומי',
            description,
            priority: 'medium',
            resourceType: 'lesson_participant',
            resourceId: body.participant_id,
            createdBy: userId,
            metadata: {
              lesson_instance_id: body.instance_id,
              student_id: participantDetail.student_id,
              commitment_id: participantDetail.commitment_id,
            },
          });
        }
      }
    } catch (hmoTaskError) {
      context.log?.warn?.('calendar/attendance failed to create HMO claim task', {
        message: hmoTaskError?.message,
        participantId: body.participant_id,
      });
    }
  }

  if (participantUpdate.participant_status === 'scheduled') {
    try {
      const openTasks = await listDashboardTasks(tenantClient, {
        status: 'open',
        resourceType: 'lesson_participant',
        resourceId: body.participant_id,
      });
      const hmoTask = (openTasks || []).find((task) => task.task_type === 'hmo_claim_submission');
      if (hmoTask?.id) {
        await resolveDashboardTask(tenantClient, {
          taskId: hmoTask.id,
          resolvedBy: userId,
          metadata: {
            ...(hmoTask.metadata && typeof hmoTask.metadata === 'object' ? hmoTask.metadata : {}),
            resolved_by_restore_to_scheduled: true,
          },
        });
      }
    } catch (taskResolveError) {
      context.log?.warn?.('calendar/attendance failed to resolve HMO task on restore', {
        message: taskResolveError?.message,
        participantId: body.participant_id,
      });
    }
  }

  if (participantUpdate.participant_status === 'scheduled' && participant?.student_id) {
    const auditDetails = {
      action_label_he: 'שוחזרה נוכחות תלמיד לשיעור מתוכנן',
      lesson_instance_id: body.instance_id,
      participant_id: body.participant_id,
      previous_status: participant.participant_status,
      next_status: 'scheduled',
      impacts: transitionAuditPreview?.impacts || [],
      projected: transitionAuditPreview?.projected || null,
      changes: await buildAttendanceTransitionAuditChanges(transitionAuditPreview),
      requested_instructor_compensation_decision:
        requestedInstructorCompensationDecision === 'unknown'
          ? null
          : requestedInstructorCompensationDecision,
    };

    try {
      if (auditContext?.supabase && auditContext?.orgId && auditContext?.userEmail && auditContext?.role) {
        await logAuditEvent(auditContext.supabase, {
          orgId: auditContext.orgId,
          userId,
          userEmail: auditContext.userEmail,
          userRole: auditContext.role,
          actionType: 'student.lesson_attendance_restored',
          actionCategory: AUDIT_CATEGORIES.STUDENTS,
          resourceType: 'student',
          resourceId: participant.student_id,
          details: auditDetails,
        });
      }
    } catch (auditError) {
      context.log?.warn?.('calendar/attendance failed to write control audit (restore)', {
        message: auditError?.message,
        participantId: body.participant_id,
      });
    }

    try {
      await logTenantAuditEvent(tenantClient, {
        actorUserId: userId,
        eventType: 'calendar.lesson_participant.restored_to_scheduled',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'lesson_participant',
        resourceId: body.participant_id,
        beforeState: participant,
        afterState: {
          ...participant,
          ...participantUpdate,
        },
        details: {
          origin: 'api/calendar-attendance',
          ...auditDetails,
        },
      });
    } catch (auditError) {
      context.log?.warn?.('calendar/attendance failed to write tenant audit (restore)', {
        message: auditError?.message,
        participantId: body.participant_id,
      });
    }
  }

  if (
    participantUpdate.participant_status
    && participantUpdate.participant_status !== 'scheduled'
    && participant?.student_id
    && participant.participant_status !== participantUpdate.participant_status
  ) {
    const auditDetails = {
      action_label_he: 'עודכן סטטוס נוכחות תלמיד',
      lesson_instance_id: body.instance_id,
      participant_id: body.participant_id,
      previous_status: participant.participant_status,
      next_status: participantUpdate.participant_status,
      impacts: transitionAuditPreview?.impacts || [],
      projected: transitionAuditPreview?.projected || null,
      changes: await buildAttendanceTransitionAuditChanges(transitionAuditPreview),
      requested_instructor_compensation_decision:
        requestedInstructorCompensationDecision === 'unknown'
          ? null
          : requestedInstructorCompensationDecision,
    };

    try {
      if (auditContext?.supabase && auditContext?.orgId && auditContext?.userEmail && auditContext?.role) {
        await logAuditEvent(auditContext.supabase, {
          orgId: auditContext.orgId,
          userId,
          userEmail: auditContext.userEmail,
          userRole: auditContext.role,
          actionType: 'student.lesson_attendance_changed',
          actionCategory: AUDIT_CATEGORIES.STUDENTS,
          resourceType: 'student',
          resourceId: participant.student_id,
          details: auditDetails,
        });
      }
    } catch (auditError) {
      context.log?.warn?.('calendar/attendance failed to write control audit (status transition)', {
        message: auditError?.message,
        participantId: body.participant_id,
      });
    }

    try {
      await logTenantAuditEvent(tenantClient, {
        actorUserId: userId,
        eventType: 'calendar.lesson_participant.status_transition_applied',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'lesson_participant',
        resourceId: body.participant_id,
        beforeState: participant,
        afterState: {
          ...participant,
          ...participantUpdate,
        },
        details: {
          origin: 'api/calendar-attendance',
          ...auditDetails,
        },
      });
    } catch (auditError) {
      context.log?.warn?.('calendar/attendance failed to write tenant audit (status transition)', {
        message: auditError?.message,
        participantId: body.participant_id,
      });
    }
  }

  try {
    await syncLessonClosureState(tenantClient, body.instance_id, userId);
  } catch (closureError) {
    context.log?.warn?.('calendar/attendance failed to sync lesson closure state', {
      message: closureError?.message,
      instanceId: body.instance_id,
    });
  }

  return respond(context, 200, {
    message: 'participant updated successfully',
    ...(billingWarnings.length > 0 ? { billing_warnings: billingWarnings } : {}),
  });
}
