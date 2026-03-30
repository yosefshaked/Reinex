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
import { syncLessonInstructorEarnings, syncInstructorAttendanceFromLessons, validateInstructorRateForLesson } from '../_shared/employee-finance.js';
import { syncLessonBillingArtifacts } from '../_shared/student-billing.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { createDashboardTask } from '../_shared/dashboard-tasks.js';

const MAX_BODY_BYTES = 64 * 1024;

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

  return await handleMarkAttendance(context, body, tenantClient, userId, isAdmin);
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

async function handleMarkAttendance(context, body, tenantClient, userId, isAdmin) {
  if (body.action === 'update-reminder') {
    return handleUpdateReminder(context, body, tenantClient, userId);
  }

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

  if (!hasAttendedFlag && !hasParticipantStatus) {
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

  if (hasAttendedFlag || hasParticipantStatus) {
    const allowedParticipantStatuses = new Set(['scheduled', 'attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);
    const participantStatus = hasAttendedFlag
      ? (body.attended ? 'attended' : 'no_show')
      : requestedParticipantStatus;

    if (!allowedParticipantStatuses.has(participantStatus)) {
      return respond(context, 400, { message: 'invalid participant_status' });
    }

    participantUpdate.participant_status = participantStatus;
    participantUpdate.attendance_confirmed_at = new Date().toISOString();
    participantUpdate.attendance_confirmed_by = userId;
    participantUpdate.updated_by = userId;

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

  return respond(context, 200, {
    message: 'participant updated successfully',
    ...(billingWarnings.length > 0 ? { billing_warnings: billingWarnings } : {}),
  });
}
