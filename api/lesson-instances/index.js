/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { enrichInstancesWithCorrectionState } from '../_shared/calendar-corrections.js';
import {
  fetchLessonMutationState,
  isLockedState,
  normalizeEntityVersion,
  normalizeUuid,
  parseExpectedVersion,
  resolveActorInstructorId,
  respondWithLockedMutation,
  respondWithVersionConflict,
} from '../_shared/calendar-editing.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { syncLessonBillingArtifacts } from '../_shared/student-billing.js';
import { loadFinancePolicies, syncLessonInstructorEarnings, syncInstructorAttendanceFromLessons } from '../_shared/employee-finance.js';
import { mergeParticipantWorkflowMetadata, syncLessonClosureState } from '../_shared/calendar-workflow.js';

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function buildUtcRange(dateString) {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function getLessonInstanceId(context, req, body) {
  const candidate =
    normalizeString(context?.bindingData?.lessonInstanceId) ||
    normalizeString(body?.lesson_instance_id) ||
    normalizeString(body?.lessonInstanceId) ||
    normalizeString(body?.id);

  return normalizeUuid(candidate);
}

function buildInstanceSelect(options = {}) {
  const participantsJoin = options.participantsJoin || 'lesson_participants';

  return [
    'id',
    'template_id',
    'applied_override_id',
    'datetime_start',
    'duration_minutes',
    'instructor_employee_id',
    'service_id',
    'status',
    'documentation_status',
    'is_closed',
    'closed_reason',
    'closed_by',
    'closed_at',
    'created_source',
    'created_at',
    'updated_at',
    'version',
    'created_by',
    'updated_by',
    'metadata',
    'instructor:Employees(id, first_name, middle_name, last_name, name)',
    'service:Services(id, name, color, duration_minutes)',
    `participants:${participantsJoin}(id, client_profile_id, student_id, participant_status, version, reminder_sent, reminder_seen, documented_at, attendance_confirmed_at, metadata, student:students(id, client_profile_id), client_profile:client_profiles(id, first_name, middle_name, last_name))`,
  ].join(',');
}

function normalizeParticipantPerson(participant) {
  if (!participant || typeof participant !== 'object') {
    return participant;
  }

  const clientProfile = participant.client_profile || null;
  return {
    ...participant,
    student: participant.student
      ? {
          id: participant.student.id,
          client_profile_id: participant.student.client_profile_id || participant.client_profile_id || clientProfile?.id || null,
          first_name: clientProfile?.first_name || '',
          middle_name: clientProfile?.middle_name || null,
          last_name: clientProfile?.last_name || '',
        }
      : null,
    client_profile: clientProfile,
  };
}

function normalizeLessonInstanceRecord(instance) {
  if (!instance || typeof instance !== 'object') {
    return instance;
  }

  return {
    ...instance,
    participants: Array.isArray(instance.participants)
      ? instance.participants.map(normalizeParticipantPerson)
      : [],
  };
}

export default async function lessonInstances(context, req) {
  const method = String(req.method || 'GET').toUpperCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('lesson-instances missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('lesson-instances failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('lesson-instances failed to verify membership', {
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
  let actorInstructorId = '';

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (!isAdmin) {
    const { instructorId, error: instructorError } = await resolveActorInstructorId(tenantClient, userId);
    if (instructorError) {
      context.log?.error?.('lesson-instances failed to resolve actor instructor', { message: instructorError.message, userId });
      return respond(context, 500, { message: 'failed_to_resolve_actor_instructor' });
    }
    actorInstructorId = instructorId;
  }

  if (method === 'GET') {
    const lessonInstanceId = getLessonInstanceId(context, req, body);
    const date = normalizeString(req?.query?.date || body?.date);
    const requestedInstructorId = normalizeUuid(req?.query?.instructor_id || req?.query?.instructorId);
    const requestedStudentId = normalizeUuid(req?.query?.student_id || req?.query?.studentId);
    const requestedClientProfileId = normalizeUuid(req?.query?.client_profile_id || req?.query?.clientProfileId);

    if (lessonInstanceId) {
      let builder = tenantClient
        .from('lesson_instances')
        .select(buildInstanceSelect())
        .eq('id', lessonInstanceId);

      if (!isAdmin) {
        if (!actorInstructorId) {
          return respond(context, 404, { message: 'lesson_instance_not_found' });
        }
        builder = builder.eq('instructor_employee_id', actorInstructorId);
      }

      const { data, error } = await builder.maybeSingle();
      if (error) {
        context.log?.error?.('lesson-instances failed to fetch lesson instance', { message: error.message, lessonInstanceId });
        return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
      }
      if (!data) {
        return respond(context, 404, { message: 'lesson_instance_not_found' });
      }

      const [enriched] = await enrichInstancesWithCorrectionState(tenantClient, [normalizeLessonInstanceRecord(data)]);
      if (enriched?.version !== undefined) {
        enriched.version = normalizeEntityVersion(enriched.version);
      }
      return respond(context, 200, enriched || data);
    }

    if (!date || !isIsoDate(date)) {
      return respond(context, 400, { message: 'invalid_date' });
    }

    const range = buildUtcRange(date);
    if (!range) {
      return respond(context, 400, { message: 'invalid_date' });
    }

    const selectClause = requestedStudentId || requestedClientProfileId
      ? buildInstanceSelect({ participantsJoin: 'lesson_participants!inner' })
      : buildInstanceSelect();

    let builder = tenantClient
      .from('lesson_instances')
      .select(selectClause)
      .gte('datetime_start', range.start)
      .lt('datetime_start', range.end)
      .order('datetime_start', { ascending: true });

    if (!isAdmin) {
      if (!actorInstructorId) {
        return respond(context, 200, []);
      }
      builder = builder.eq('instructor_employee_id', actorInstructorId);
    } else if (requestedInstructorId) {
      builder = builder.eq('instructor_employee_id', requestedInstructorId);
    }

    if (requestedStudentId) {
      builder = builder.eq('participants.student_id', requestedStudentId);
    }
    if (requestedClientProfileId) {
      builder = builder.eq('participants.client_profile_id', requestedClientProfileId);
    }

    const { data, error } = await builder;
    if (error) {
      context.log?.error?.('lesson-instances failed to fetch schedule', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_lesson_instances' });
    }

    const enrichedData = await enrichInstancesWithCorrectionState(
      tenantClient,
      (Array.isArray(data) ? data : []).map(normalizeLessonInstanceRecord),
    );
    return respond(context, 200, enrichedData);
  }

  if (method === 'POST') {
    if (!isAdmin) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const datetimeStart = normalizeString(body?.datetime_start || body?.datetimeStart);
    const durationMinutes = Number(body?.duration_minutes ?? body?.durationMinutes);
    const instructorEmployeeId = normalizeUuid(body?.instructor_employee_id || body?.instructorEmployeeId);
    const serviceId = normalizeUuid(body?.service_id || body?.serviceId);
    const studentIds = Array.isArray(body?.student_ids)
      ? body.student_ids
      : Array.isArray(body?.studentIds)
        ? body.studentIds
        : [];
    const clientProfileIds = Array.isArray(body?.client_profile_ids)
      ? body.client_profile_ids
      : Array.isArray(body?.clientProfileIds)
        ? body.clientProfileIds
        : [];

    if (!datetimeStart || Number.isNaN(Date.parse(datetimeStart))) {
      return respond(context, 400, { message: 'invalid_datetime_start' });
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return respond(context, 400, { message: 'invalid_duration_minutes' });
    }

    if (!instructorEmployeeId) {
      return respond(context, 400, { message: 'invalid_instructor_employee_id' });
    }

    if (!serviceId) {
      return respond(context, 400, { message: 'invalid_service_id' });
    }

    const normalizedStudentIds = Array.from(
      new Set(studentIds.map((value) => normalizeUuid(value)).filter(Boolean)),
    );
    const normalizedClientProfileIds = Array.from(
      new Set(clientProfileIds.map((value) => normalizeUuid(value)).filter(Boolean)),
    );

    if (normalizedStudentIds.length === 0 && normalizedClientProfileIds.length === 0) {
      return respond(context, 400, { message: 'missing_participants' });
    }

    const { data: instanceRow, error: instanceError } = await tenantClient
      .from('lesson_instances')
      .insert({
        datetime_start: datetimeStart,
        duration_minutes: durationMinutes,
        instructor_employee_id: instructorEmployeeId,
        service_id: serviceId,
        status: 'scheduled',
        documentation_status: 'undocumented',
        created_source: 'one_time',
        created_by: userId,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (instanceError || !instanceRow?.id) {
      context.log?.error?.('lesson-instances failed to create instance', { message: instanceError?.message });
      return respond(context, 500, { message: 'failed_to_create_lesson_instance' });
    }

    const participantsPayload = [
      ...normalizedStudentIds.map((studentId) => ({
        lesson_instance_id: instanceRow.id,
        client_profile_id: null,
        student_id: studentId,
        participant_status: 'scheduled',
      })),
      ...normalizedClientProfileIds.map((clientProfileId) => ({
        lesson_instance_id: instanceRow.id,
        client_profile_id: clientProfileId,
        student_id: null,
        participant_status: 'scheduled',
      })),
    ];

    if (normalizedClientProfileIds.length > 0) {
      const { data: linkedStudents } = await tenantClient
        .from('students')
        .select('id, client_profile_id')
        .in('client_profile_id', normalizedClientProfileIds);
      const linkedStudentByClientProfile = new Map((linkedStudents || []).map((row) => [row.client_profile_id, row.id]));
      participantsPayload.forEach((participant) => {
        if (!participant.student_id && participant.client_profile_id) {
          participant.student_id = linkedStudentByClientProfile.get(participant.client_profile_id) || null;
        }
      });
    }

    if (normalizedStudentIds.length > 0) {
      const { data: studentProfiles } = await tenantClient
        .from('students')
        .select('id, client_profile_id')
        .in('id', normalizedStudentIds);
      const profileByStudentId = new Map((studentProfiles || []).map((row) => [row.id, row.client_profile_id]));
      participantsPayload.forEach((participant) => {
        if (participant.student_id && !participant.client_profile_id) {
          participant.client_profile_id = profileByStudentId.get(participant.student_id) || null;
        }
      });
    }

    if (participantsPayload.some((participant) => !participant.client_profile_id)) {
      return respond(context, 400, { message: 'invalid_participants_missing_client_profile' });
    }

    const { error: participantsError } = await tenantClient
      .from('lesson_participants')
      .insert(participantsPayload);

    if (participantsError) {
      context.log?.error?.('lesson-instances failed to create participants', { message: participantsError.message });
      return respond(context, 500, { message: 'failed_to_create_lesson_participants' });
    }

    const { data, error } = await tenantClient
      .from('lesson_instances')
      .select(buildInstanceSelect())
      .eq('id', instanceRow.id)
      .single();

    if (error) {
      context.log?.error?.('lesson-instances failed to load created instance', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
    }

    try {
      await logTenantAuditEvent(tenantClient, {
        actorUserId: userId,
        eventType: 'calendar.lesson_instance.created',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'lesson_instance',
        resourceId: instanceRow.id,
        afterState: data,
        details: {
          origin: 'api/lesson-instances',
          action: 'create',
        },
      });
    } catch (auditError) {
      context.log?.warn?.('lesson-instances failed to write tenant audit (create)', { message: auditError?.message, lessonInstanceId: instanceRow.id });
    }

    const [enriched] = await enrichInstancesWithCorrectionState(
      tenantClient,
      data ? [normalizeLessonInstanceRecord(data)] : [],
    );
    return respond(context, 200, enriched || data);
  }

  if (method === 'PUT') {
    const lessonInstanceId = getLessonInstanceId(context, req, body);
    if (!lessonInstanceId) {
      return respond(context, 400, { message: 'missing_lesson_instance_id' });
    }

    const nextStatus = normalizeString(body?.status);
    const nextDocumentationStatus = normalizeString(body?.documentation_status || body?.documentationStatus);
    const expectedVersion = parseExpectedVersion(body?.version, body?.expected_version, body?.expectedVersion);

    if (!nextStatus && !nextDocumentationStatus) {
      return respond(context, 400, { message: 'no_updates_provided' });
    }

    const allowedStatus = new Set(['scheduled', 'completed', 'cancelled_student', 'cancelled_clinic', 'no_show']);
    const allowedDocumentation = new Set(['undocumented', 'documented']);

    const { error: stateError, result: mutationState } = await fetchLessonMutationState(tenantClient, {
      instanceId: lessonInstanceId,
    });

    if (stateError) {
      context.log?.error?.('lesson-instances failed to load mutation state', { message: stateError.message, lessonInstanceId });
      return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
    }

    if (!mutationState.instance) {
      return respond(context, 404, { message: 'lesson_instance_not_found' });
    }

    if (isLockedState(mutationState)) {
      return respondWithLockedMutation(context, {
        instanceId: lessonInstanceId,
        instanceLocks: mutationState.instanceLocks,
        closed: mutationState.instance?.is_closed || false,
      });
    }

    if (expectedVersion !== null && mutationState.instance.version !== expectedVersion) {
      return respondWithVersionConflict(context, {
        resourceType: 'lesson_instance',
        resourceId: lessonInstanceId,
        expectedVersion,
        currentVersion: mutationState.instance.version,
      });
    }

    const updates = { updated_at: new Date().toISOString(), updated_by: userId };

    if (nextStatus) {
      if (!allowedStatus.has(nextStatus)) {
        return respond(context, 400, { message: 'invalid_status' });
      }
      updates.status = nextStatus;
    }

    if (nextDocumentationStatus) {
      if (!allowedDocumentation.has(nextDocumentationStatus)) {
        return respond(context, 400, { message: 'invalid_documentation_status' });
      }
      updates.documentation_status = nextDocumentationStatus;
    }

    // Non-admin users can only update their own lesson instances
    if (!isAdmin) {
      if (!actorInstructorId || mutationState.instance.instructor_employee_id !== actorInstructorId) {
        return respond(context, 403, { message: 'forbidden' });
      }
    }

    // Guard: cannot mark an instance as completed unless all participants have a resolved status
    if (nextStatus === 'completed') {
      const { data: participants, error: participantsErr } = await tenantClient
        .from('lesson_participants')
        .select('id, participant_status')
        .eq('lesson_instance_id', lessonInstanceId);

      if (participantsErr) {
        context.log?.error?.('lesson-instances failed to check participant statuses before completing', {
          message: participantsErr.message,
          lessonInstanceId,
        });
        return respond(context, 500, { message: 'failed_to_check_participant_statuses' });
      }

      const unsetCount = (participants || []).filter((p) => p.participant_status === 'scheduled').length;
      if (unsetCount > 0) {
        return respond(context, 422, {
          message: 'participants_missing_status',
          unset_count: unsetCount,
        });
      }
    }

    let updateBuilder = tenantClient
      .from('lesson_instances')
      .update(updates)
      .eq('id', lessonInstanceId);

    if (expectedVersion !== null) {
      const shouldFilterByVersion = !(
        mutationState.instance?.legacy_null_version
        && expectedVersion === 1
      );
      if (shouldFilterByVersion) {
        updateBuilder = updateBuilder.eq('version', expectedVersion);
      }
    }

    const { data: updatedRows, error: updateError } = await updateBuilder
      .select('id, version')
      .maybeSingle();

    if (updateError) {
      context.log?.error?.('lesson-instances failed to update instance', { message: updateError.message });
      return respond(context, 500, { message: 'failed_to_update_lesson_instance' });
    }

    if (!updatedRows) {
      const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(tenantClient, {
        instanceId: lessonInstanceId,
      });
      if (refreshedError) {
        context.log?.error?.('lesson-instances failed to refresh instance after conflict', { message: refreshedError.message, lessonInstanceId });
        return respond(context, 500, { message: 'failed_to_update_lesson_instance' });
      }
      return respondWithVersionConflict(context, {
        resourceType: 'lesson_instance',
        resourceId: lessonInstanceId,
        expectedVersion,
        currentVersion: refreshedState.instance?.version ?? null,
      });
    }

    // Sync financial artifacts and instructor attendance when status changes
    if (nextStatus) {
      try {
        await syncLessonBillingArtifacts(tenantClient, lessonInstanceId, userId);
        await syncLessonInstructorEarnings(tenantClient, lessonInstanceId, userId);
        await syncInstructorAttendanceFromLessons(tenantClient, lessonInstanceId, userId);
        await syncLessonClosureState(tenantClient, lessonInstanceId, userId);
      } catch (syncError) {
        context.log?.error?.('lesson-instances failed to sync financial artifacts', {
          message: syncError?.message,
          lessonInstanceId,
        });
        // Non-fatal: status update succeeded, log but continue
      }
    }

    const { data, error } = await tenantClient
      .from('lesson_instances')
      .select(buildInstanceSelect())
      .eq('id', lessonInstanceId)
      .single();

    if (error) {
      context.log?.error?.('lesson-instances failed to load updated instance', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
    }

    try {
      await logTenantAuditEvent(tenantClient, {
        actorUserId: userId,
        eventType: 'calendar.lesson_instance.updated',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'lesson_instance',
        resourceId: lessonInstanceId,
        beforeState: mutationState.instance,
        afterState: data,
        details: {
          origin: 'api/lesson-instances',
          updated_fields: Object.keys(updates),
        },
      });
    } catch (auditError) {
      context.log?.warn?.('lesson-instances failed to write tenant audit (update)', { message: auditError?.message, lessonInstanceId });
    }

    const [enriched] = await enrichInstancesWithCorrectionState(
      tenantClient,
      data ? [normalizeLessonInstanceRecord(data)] : [],
    );
    if (enriched?.version !== undefined) {
      enriched.version = normalizeEntityVersion(enriched.version);
    }
    return respond(context, 200, enriched || data);
  }

  // PATCH: Bulk operations (admin only)
  if (method === 'PATCH') {
    if (!isAdmin) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const action = normalizeString(body?.action);
    if (!['bulk-cancel', 'add-participant'].includes(action)) {
      return respond(context, 400, { message: 'invalid_action' });
    }

    // add-participant: Add a student to an existing scheduled instance
    if (action === 'add-participant') {
      const instanceId = normalizeUuid(body?.instance_id || body?.instanceId);
      const studentId = normalizeUuid(body?.student_id || body?.studentId);
      const clientProfileId = normalizeUuid(body?.client_profile_id || body?.clientProfileId);

      if (!instanceId) return respond(context, 400, { message: 'missing_instance_id' });
      if (!studentId && !clientProfileId) return respond(context, 400, { message: 'missing_client_profile_or_student_id' });

      const { error: addStateError, result: addMutationState } = await fetchLessonMutationState(tenantClient, { instanceId });
      if (addStateError) {
        context.log?.error?.('lesson-instances add-participant failed to load state', { message: addStateError.message });
        return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
      }
      if (!addMutationState.instance) return respond(context, 404, { message: 'lesson_instance_not_found' });
      if (isLockedState(addMutationState)) {
        return respondWithLockedMutation(context, {
          instanceId,
          instanceLocks: addMutationState.instanceLocks,
          closed: addMutationState.instance?.is_closed || false,
        });
      }
      if (addMutationState.instance.status !== 'scheduled') {
        return respond(context, 422, { message: 'instance_not_scheduled' });
      }


      let resolvedStudentId = studentId;
      let resolvedClientProfileId = clientProfileId;
      if (resolvedStudentId && !resolvedClientProfileId) {
        const { data: studentRow } = await tenantClient
          .from('students')
          .select('id, client_profile_id')
          .eq('id', resolvedStudentId)
          .maybeSingle();
        resolvedClientProfileId = studentRow?.client_profile_id || '';
      }
      if (resolvedClientProfileId && !resolvedStudentId) {
        const { data: studentRow } = await tenantClient
          .from('students')
          .select('id, client_profile_id')
          .eq('client_profile_id', resolvedClientProfileId)
          .maybeSingle();
        resolvedStudentId = studentRow?.id || '';
      }

      if (!resolvedClientProfileId) {
        return respond(context, 400, { message: 'missing_client_profile_link' });
      }

      // Capacity check: cancelled/absent participants do not count toward max_students
      const [{ data: activeParticipants, error: countError }, { data: capability }] = await Promise.all([
        tenantClient
          .from('lesson_participants')
          .select('id')
          .eq('lesson_instance_id', instanceId)
          .in('participant_status', ['scheduled', 'attended']),
        tenantClient
          .from('instructor_service_capabilities')
          .select('max_students')
          .eq('employee_id', addMutationState.instance.instructor_employee_id)
          .eq('service_id', addMutationState.instance.service_id)
          .maybeSingle(),
      ]);

      if (countError) {
        context.log?.error?.('lesson-instances add-participant capacity check failed', { message: countError.message });
        return respond(context, 500, { message: 'failed_to_check_capacity' });
      }

      if (capability?.max_students) {
        const activeCount = (activeParticipants ?? []).length;
        if (activeCount >= capability.max_students) {
          return respond(context, 422, {
            message: 'capacity_exceeded',
            current_count: activeCount,
            max_capacity: capability.max_students,
          });
        }
      }

      const { data: newParticipant, error: insertError } = await tenantClient
        .from('lesson_participants')
        .insert({
          lesson_instance_id: instanceId,
          client_profile_id: resolvedClientProfileId,
          student_id: resolvedStudentId || null,
          participant_status: 'scheduled',
        })
        .select('id')
        .single();

      if (insertError) {
        if (insertError.code === '23505') return respond(context, 409, { message: 'participant_already_exists' });
        context.log?.error?.('lesson-instances add-participant failed', { message: insertError.message });
        return respond(context, 500, { message: 'failed_to_add_participant' });
      }

      try {
        await logTenantAuditEvent(tenantClient, {
          actorUserId: userId,
          eventType: 'calendar.lesson_participant.added',
          retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
          resourceType: 'lesson_participant',
          resourceId: newParticipant.id,
          afterState: {
            lesson_instance_id: instanceId,
            client_profile_id: resolvedClientProfileId,
            student_id: resolvedStudentId || null,
            participant_status: 'scheduled',
          },
          details: { origin: 'api/lesson-instances', action: 'add-participant' },
        });
      } catch (auditError) {
        context.log?.warn?.('lesson-instances failed to write audit (add-participant)', { message: auditError?.message });
      }

      try {
        await syncLessonClosureState(tenantClient, instanceId, userId);
      } catch (closureError) {
        context.log?.warn?.('lesson-instances failed to sync lesson closure after add-participant', {
          message: closureError?.message,
          lessonInstanceId: instanceId,
        });
      }

      const { data: addedRefreshed, error: addedRefreshError } = await tenantClient
        .from('lesson_instances').select(buildInstanceSelect()).eq('id', instanceId).single();
      if (addedRefreshError) return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
      const [addedEnriched] = await enrichInstancesWithCorrectionState(
        tenantClient,
        addedRefreshed ? [normalizeLessonInstanceRecord(addedRefreshed)] : [],
      );
      return respond(context, 200, addedEnriched || addedRefreshed);
    }

    // bulk-cancel: Cancel all future lesson instances for a student from a given date
    const studentId = normalizeUuid(body?.student_id || body?.studentId);
    const clientProfileId = normalizeUuid(body?.client_profile_id || body?.clientProfileId);
    const fromDate = normalizeString(body?.from_date || body?.fromDate);

    if (!studentId && !clientProfileId) {
      return respond(context, 400, { message: 'missing_client_profile_or_student_id' });
    }
    if (!fromDate || !isIsoDate(fromDate)) {
      return respond(context, 400, { message: 'invalid_from_date' });
    }

    const fromDatetime = `${fromDate}T00:00:00.000Z`;

    // Find all future lesson_instances where this student is a participant and status is 'scheduled'
    let futureParticipantsQuery = tenantClient
      .from('lesson_participants')
      .select('id, lesson_instance_id, lesson_instance:lesson_instances(id, datetime_start, status)')
      .gte('lesson_instance.datetime_start', fromDatetime)
      .eq('lesson_instance.status', 'scheduled');

    futureParticipantsQuery = studentId
      ? futureParticipantsQuery.eq('student_id', studentId)
      : futureParticipantsQuery.eq('client_profile_id', clientProfileId);

    const { data: futureInstances, error: fetchErr } = await futureParticipantsQuery;

    if (fetchErr) {
      context.log?.error?.('lesson-instances bulk-cancel failed to find instances', { message: fetchErr.message });
      return respond(context, 500, { message: 'failed_to_find_instances' });
    }

    // Filter out rows where the join didn't match (Supabase returns nulls)
    const matchedParticipants = (futureInstances || []).filter(
      (p) => p.lesson_instance && p.lesson_instance.id
    );

    if (matchedParticipants.length === 0) {
      return respond(context, 200, { cancelled_count: 0, message: 'no_instances_to_cancel' });
    }

    const instanceIds = matchedParticipants.map((p) => p.lesson_instance_id);
    const participantIds = matchedParticipants.map((p) => p.id);
    const nowIso = new Date().toISOString();

    const { data: participantRows, error: participantRowsError } = await tenantClient
      .from('lesson_participants')
      .select('id, lesson_instance_id, metadata')
      .in('id', participantIds);

    if (participantRowsError) {
      context.log?.error?.('lesson-instances bulk-cancel failed to load participant metadata', { message: participantRowsError.message });
      return respond(context, 500, { message: 'failed_to_load_participants' });
    }

    const policies = await loadFinancePolicies(tenantClient);
    const participantRowById = new Map((participantRows || []).map((row) => [row.id, row]));

    // Update participant status to cancelled
    const { error: participantUpdateErr } = await tenantClient
      .from('lesson_participants')
      .update({
        participant_status: 'cancelled_student',
        attendance_confirmed_at: nowIso,
        attendance_confirmed_by: userId,
      })
      .in('id', participantIds);

    if (participantUpdateErr) {
      context.log?.error?.('lesson-instances bulk-cancel failed to update participants', { message: participantUpdateErr.message });
      return respond(context, 500, { message: 'failed_to_cancel_participants' });
    }

    for (const participantId of participantIds) {
      const participantRow = participantRowById.get(participantId) || null;
      const mergedWorkflowMetadata = mergeParticipantWorkflowMetadata(participantRow?.metadata, {
        student_billing: {
          decision: 'pending',
          decided_at: nowIso,
          decided_by: userId,
          reason: 'cancelled_student',
        },
        instructor_compensation: {
          decision: 'not_compensated',
          decided_at: nowIso,
          decided_by: userId,
          reason: 'student_suspension_bulk_cancel',
        },
        hmo_claim: {
          decision: 'not_required',
          decided_at: nowIso,
          decided_by: userId,
          reason: 'cancelled_student',
        },
      });

      const { error: workflowUpdateError } = await tenantClient
        .from('lesson_participants')
        .update({ metadata: mergedWorkflowMetadata })
        .eq('id', participantId);

      if (workflowUpdateError) {
        context.log?.error?.('lesson-instances bulk-cancel failed to persist workflow metadata', {
          message: workflowUpdateError.message,
          participantId,
        });
        return respond(context, 500, { message: 'failed_to_update_participant_workflow' });
      }
    }

    // For instances where this student was the only scheduled participant, cancel the instance too
    const uniqueInstanceIds = [...new Set(instanceIds)];
    for (const instId of uniqueInstanceIds) {
      const affectedParticipantIds = matchedParticipants
        .filter((participant) => participant.lesson_instance_id === instId)
        .map((participant) => participant.id);
      const { data: instanceRow, error: instanceRowError } = await tenantClient
        .from('lesson_instances')
        .select('metadata')
        .eq('id', instId)
        .maybeSingle();

      if (instanceRowError) {
        context.log?.error?.('lesson-instances bulk-cancel failed to load instance metadata', {
          message: instanceRowError.message,
          instanceId: instId,
        });
        return respond(context, 500, { message: 'failed_to_load_instance' });
      }

      const currentMetadata = instanceRow?.metadata && typeof instanceRow.metadata === 'object' ? instanceRow.metadata : {};
      const existingSnapshots = currentMetadata.attendance_resolution_snapshots && typeof currentMetadata.attendance_resolution_snapshots === 'object'
        ? currentMetadata.attendance_resolution_snapshots
        : {};
      const nextSnapshots = { ...existingSnapshots };
      affectedParticipantIds.forEach((participantId) => {
        nextSnapshots[participantId] = {
          evaluated_at: nowIso,
          participant_status: 'cancelled_student',
          billing_consumption_policy: policies.billingConsumptionPolicy,
          instructor_earnings_policy: policies.instructorEarningsPolicy,
          instructor_compensation_decision: 'not_compensated',
        };
      });

      const { error: snapshotUpdateError } = await tenantClient
        .from('lesson_instances')
        .update({
          metadata: {
            ...currentMetadata,
            attendance_resolution_snapshots: nextSnapshots,
          },
        })
        .eq('id', instId);

      if (snapshotUpdateError) {
        context.log?.error?.('lesson-instances bulk-cancel failed to persist instance snapshots', {
          message: snapshotUpdateError.message,
          instanceId: instId,
        });
        return respond(context, 500, { message: 'failed_to_update_instance_workflow' });
      }

      const { data: remainingParticipants } = await tenantClient
        .from('lesson_participants')
        .select('id')
        .eq('lesson_instance_id', instId)
        .neq('participant_status', 'cancelled_student');

      if (!remainingParticipants || remainingParticipants.length === 0) {
        await tenantClient
          .from('lesson_instances')
          .update({ status: 'cancelled_student', updated_at: new Date().toISOString() })
          .eq('id', instId);
      }

      try {
        await syncLessonBillingArtifacts(tenantClient, instId, userId);
        await syncLessonInstructorEarnings(tenantClient, instId, userId);
        await syncInstructorAttendanceFromLessons(tenantClient, instId, userId);
        await syncLessonClosureState(tenantClient, instId, userId);
      } catch (syncError) {
        context.log?.error?.('lesson-instances bulk-cancel failed to sync lesson workflow', {
          message: syncError?.message,
          instanceId: instId,
        });
        return respond(context, 500, { message: 'failed_to_sync_financial_artifacts' });
      }
    }

    // Audit log
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.STUDENT_LESSONS_BULK_CANCELLED,
      actionCategory: AUDIT_CATEGORIES.CALENDAR,
      resourceType: 'student',
      resourceId: studentId,
      details: {
        from_date: fromDate,
        cancelled_count: matchedParticipants.length,
        instance_ids: uniqueInstanceIds,
      },
    });

    return respond(context, 200, {
      cancelled_count: matchedParticipants.length,
      instance_count: uniqueInstanceIds.length,
    });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
