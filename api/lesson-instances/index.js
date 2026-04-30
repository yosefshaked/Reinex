/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { enrichInstancesWithCorrectionState } from '../_shared/calendar-corrections.js';
import { enrichLessonInstancesWithHmoCoverage } from '../_shared/calendar-hmo-coverage.js';
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
  withOrgScope,
} from '../_shared/org-bff.js';
import BillingLedgerService from '../_shared/BillingLedgerService.js';
import { syncLessonInstructorEarnings, syncInstructorAttendanceFromLessons } from '../_shared/employee-finance.js';
import { syncLessonClosureState } from '../_shared/calendar-workflow.js';
import { buildUtcBoundsForTimezoneDateRange } from '../_shared/instructor-availability.js';
import {
  ACTIVE_LESSON_INSTANCE_STATUSES,
  cancelLessonInstanceWithParticipants,
  cancelSelectedScheduledParticipantsAndReconcileInstance,
  completeLessonInstanceWithParticipants,
  normalizeLessonInstanceStatus,
} from '../_shared/lesson-instance-status.js';

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function buildUtcRange(dateString) {
  const range = buildUtcBoundsForTimezoneDateRange(dateString, dateString);
  if (!range?.startIso || !range?.endExclusiveIso) {
    return null;
  }
  return {
    start: range.startIso,
    end: range.endExclusiveIso,
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
    'closed_by',
    'closed_at',
    'created_source',
    'created_at',
    'updated_at',
    'version',
    'created_by',
    'updated_by',
    'metadata',
    'instructor:Employees(id, first_name, middle_name, last_name)',
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

  const normalizedStatus = String(instance.status || '').trim().toLowerCase();
  const resolvedStatus = normalizedStatus === 'cancelled_student' || normalizedStatus === 'cancelled_clinic' || normalizedStatus === 'no_show'
    ? 'cancelled'
    : normalizedStatus;

  return {
    ...instance,
    status: resolvedStatus || instance.status,
    participants: Array.isArray(instance.participants)
      ? instance.participants.map(normalizeParticipantPerson)
      : [],
  };
}

function normalizeCancelledParticipantAuditRows(value) {
  return Array.isArray(value)
    ? value.filter((row) => row && typeof row === 'object' && row.participant_id)
    : [];
}

async function enrichLessonInstanceRecordsForResponse(client, orgId, records = []) {
  const normalizedRecords = (Array.isArray(records) ? records : [records])
    .filter(Boolean)
    .map(normalizeLessonInstanceRecord);

  if (normalizedRecords.length === 0) {
    return [];
  }

  const correctionEnriched = await enrichInstancesWithCorrectionState(client, normalizedRecords);
  const coverageEnriched = await enrichLessonInstancesWithHmoCoverage(client, orgId, correctionEnriched);
  return coverageEnriched.map((record) => (
    record?.version !== undefined
      ? { ...record, version: normalizeEntityVersion(record.version) }
      : record
  ));
}

async function loadCreatedInstanceResponse(client, orgId, instanceId, fallbackInstance = null) {
  const loadEnriched = async () => {
    const { data, error } = await withOrgScope(client, 'lesson_instances', orgId)
      .select(buildInstanceSelect())
      .eq('id', instanceId)
      .single();

    if (error) {
      throw error;
    }

    const [enriched] = await enrichLessonInstanceRecordsForResponse(client, orgId, data);
    return enriched || data;
  };

  try {
    return await loadEnriched();
  } catch (firstError) {
    try {
      return await loadEnriched();
    } catch (secondError) {
      if (fallbackInstance) {
        const [enrichedFallback] = await enrichLessonInstanceRecordsForResponse(client, orgId, fallbackInstance);
        return enrichedFallback || fallbackInstance;
      }
      throw secondError || firstError;
    }
  }
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
  const client = supabase;

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

  const billingService = new BillingLedgerService({ tenantClient: supabase, orgId });

  if (!isAdmin) {
    const { instructorId, error: instructorError } = await resolveActorInstructorId(supabase, userId);
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
      let builder = withOrgScope(supabase, 'lesson_instances', orgId)
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

      const [enriched] = await enrichLessonInstanceRecordsForResponse(supabase, orgId, data);
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

    let builder = withOrgScope(supabase, 'lesson_instances', orgId)
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

    const enrichedData = await enrichLessonInstanceRecordsForResponse(supabase, orgId, data || []);
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

    const { data: instanceRow, error: instanceError } = await withOrgScope(supabase, 'lesson_instances', orgId)
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
      .select(`
        id,
        template_id,
        applied_override_id,
        datetime_start,
        duration_minutes,
        instructor_employee_id,
        service_id,
        status,
        documentation_status,
        is_closed,
        closed_by,
        closed_at,
        created_source,
        created_at,
        updated_at,
        version,
        created_by,
        updated_by,
        metadata
      `)
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
      const { data: linkedStudents } = await withOrgScope(supabase, 'students', orgId)
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
      const { data: studentProfiles } = await withOrgScope(supabase, 'students', orgId)
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

    const { data: insertedParticipants, error: participantsError } = await withOrgScope(supabase, 'lesson_participants', orgId)
      .insert(participantsPayload)
      .select(`
        id,
        client_profile_id,
        student_id,
        participant_status,
        version,
        reminder_sent,
        reminder_seen,
        documented_at,
        attendance_confirmed_at,
        metadata
      `);

    if (participantsError) {
      const { error: cleanupError } = await withOrgScope(supabase, 'lesson_instances', orgId)
        .delete()
        .eq('id', instanceRow.id);
      context.log?.error?.('lesson-instances failed to create participants', { message: participantsError.message });
      if (cleanupError) {
        context.log?.error?.('lesson-instances failed to clean up instance after participant create failure', {
          message: cleanupError.message,
          lessonInstanceId: instanceRow.id,
        });
      }
      return respond(context, 500, { message: 'failed_to_create_lesson_participants' });
    }

    try {
      await logTenantAuditEvent(supabase, {
        actorUserId: userId,
        eventType: 'calendar.lesson_instance.created',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'lesson_instance',
        resourceId: instanceRow.id,
        afterState: {
          id: instanceRow.id,
          datetime_start: datetimeStart,
          duration_minutes: durationMinutes,
          instructor_employee_id: instructorEmployeeId,
          service_id: serviceId,
          status: 'scheduled',
          documentation_status: 'undocumented',
          created_source: 'one_time',
        },
        details: {
          origin: 'api/lesson-instances',
          action: 'create',
        },
      });
    } catch (auditError) {
      context.log?.warn?.('lesson-instances failed to write tenant audit (create)', { message: auditError?.message, lessonInstanceId: instanceRow.id });
    }

    let fallbackInstance = null;
    try {
      const [
        { data: participantRows },
        { data: serviceRow },
        { data: instructorRow },
      ] = await Promise.all([
        withOrgScope(supabase, 'lesson_participants', orgId)
          .select(`
            id,
            client_profile_id,
            student_id,
            participant_status,
            version,
            reminder_sent,
            reminder_seen,
            documented_at,
            attendance_confirmed_at,
            metadata,
            student:students(id, client_profile_id),
            client_profile:client_profiles(id, first_name, middle_name, last_name)
          `)
          .eq('lesson_instance_id', instanceRow.id),
        withOrgScope(supabase, 'Services', orgId)
          .select('id, name, color, duration_minutes')
          .eq('id', serviceId)
          .maybeSingle(),
        withOrgScope(supabase, 'Employees', orgId)
          .select('id, first_name, middle_name, last_name, name')
          .eq('id', instructorEmployeeId)
          .maybeSingle(),
      ]);

      fallbackInstance = normalizeLessonInstanceRecord({
        ...instanceRow,
        instructor: instructorRow || null,
        service: serviceRow || null,
        participants: Array.isArray(participantRows) ? participantRows : [],
      });
    } catch (fallbackError) {
      context.log?.warn?.('lesson-instances failed to build created instance fallback', {
        message: fallbackError?.message,
        lessonInstanceId: instanceRow.id,
      });
      fallbackInstance = normalizeLessonInstanceRecord({
        ...instanceRow,
        instructor: null,
        service: null,
        participants: Array.isArray(insertedParticipants) ? insertedParticipants : [],
      });
    }

    try {
      const responseData = await loadCreatedInstanceResponse(supabase, orgId, instanceRow.id, fallbackInstance);
      return respond(context, 201, responseData);
    } catch (loadError) {
      context.log?.error?.('lesson-instances failed to load created instance after successful write', {
        message: loadError?.message,
        lessonInstanceId: instanceRow.id,
      });
      return respond(context, 201, fallbackInstance);
    }
  }

  if (method === 'PUT') {
    const lessonInstanceId = getLessonInstanceId(context, req, body);
    if (!lessonInstanceId) {
      return respond(context, 400, { message: 'missing_lesson_instance_id' });
    }

    const nextStatus = normalizeLessonInstanceStatus(body?.status);
    const nextDocumentationStatus = normalizeString(body?.documentation_status || body?.documentationStatus);
    const expectedVersion = parseExpectedVersion(body?.version, body?.expected_version, body?.expectedVersion);

    if (!nextStatus && !nextDocumentationStatus) {
      return respond(context, 400, { message: 'no_updates_provided' });
    }

    const allowedStatus = ACTIVE_LESSON_INSTANCE_STATUSES;
    const allowedDocumentation = new Set(['undocumented', 'documented']);

    const { error: stateError, result: mutationState } = await fetchLessonMutationState(supabase, {
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
    let updatedRows = null;
    let auditBeforeState = mutationState.instance;
    let cancelledParticipantIds = [];
    let cancelledParticipantAuditRows = [];
    let completedParticipantAuditRows = [];
    let postUpdateData = null;

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

    if (nextStatus) {
      if (!allowedStatus.has(nextStatus)) {
        return respond(context, 400, { message: 'invalid_status' });
      }
      if (nextStatus === 'cancelled') {
        try {
          const cancellationResult = await cancelLessonInstanceWithParticipants(supabase, {
            orgId,
            instanceId: lessonInstanceId,
            userId,
            expectedVersion,
            documentationStatus: nextDocumentationStatus || null,
          });

          if (cancellationResult.outcome === 'attended_conflict') {
            return respond(context, 409, {
              message: 'instance_cancelled_has_attended_participants',
              attended_participants: cancellationResult.attendedParticipants,
            });
          }

          if (cancellationResult.outcome === 'version_conflict') {
            return respondWithVersionConflict(context, {
              resourceType: 'lesson_instance',
              resourceId: lessonInstanceId,
              expectedVersion,
              currentVersion: cancellationResult.instanceVersion,
            });
          }

          if (cancellationResult.outcome === 'not_found') {
            return respond(context, 404, { message: 'lesson_instance_not_found' });
          }

          if (cancellationResult.outcome === 'locked' || cancellationResult.outcome === 'closed') {
            const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(supabase, {
              instanceId: lessonInstanceId,
            });
            if (refreshedError) {
              context.log?.error?.('lesson-instances failed to refresh locked cancellation state', {
                message: refreshedError.message,
                lessonInstanceId,
              });
              return respond(context, 500, { message: 'failed_to_cancel_instance' });
            }
            return respondWithLockedMutation(context, {
              instanceId: lessonInstanceId,
              instanceLocks: refreshedState.instanceLocks,
              closed: refreshedState.instance?.is_closed || cancellationResult.outcome === 'closed',
            });
          }

          if (cancellationResult.outcome !== 'cancelled') {
            context.log?.error?.('lesson-instances received unexpected cancellation outcome', {
              outcome: cancellationResult.outcome,
              lessonInstanceId,
            });
            return respond(context, 500, { message: 'failed_to_cancel_instance' });
          }

          cancelledParticipantIds = cancellationResult.cancelledParticipantIds;
          cancelledParticipantAuditRows = normalizeCancelledParticipantAuditRows(cancellationResult.cancelledParticipantAuditRows);
          updates.status = 'cancelled';
          updates.documentation_status = nextDocumentationStatus || mutationState.instance.documentation_status;
          updates.metadata = cancellationResult.instanceMetadata;
          auditBeforeState = cancellationResult.instanceBeforeState
            ? normalizeLessonInstanceRecord(cancellationResult.instanceBeforeState)
            : mutationState.instance;
          updatedRows = {
            id: lessonInstanceId,
            version: cancellationResult.instanceVersion ?? mutationState.instance.version,
          };
          postUpdateData = cancellationResult.instanceAfterState
            ? normalizeLessonInstanceRecord(cancellationResult.instanceAfterState)
            : {
                ...mutationState.instance,
                ...updates,
                version: updatedRows.version,
              };
        } catch (cancelError) {
          context.log?.error?.('lesson-instances failed to cancel instance atomically', {
            message: cancelError?.message,
            lessonInstanceId,
          });
          return respond(context, 500, { message: 'failed_to_cancel_instance' });
        }
      }
      if (nextStatus === 'completed') {
        try {
          const completionResult = await completeLessonInstanceWithParticipants(supabase, {
            orgId,
            instanceId: lessonInstanceId,
            userId,
            expectedVersion,
            documentationStatus: nextDocumentationStatus || null,
          });

          if (completionResult.outcome === 'version_conflict') {
            return respondWithVersionConflict(context, {
              resourceType: 'lesson_instance',
              resourceId: lessonInstanceId,
              expectedVersion,
              currentVersion: completionResult.instanceVersion,
            });
          }

          if (completionResult.outcome === 'not_found') {
            return respond(context, 404, { message: 'lesson_instance_not_found' });
          }

          if (completionResult.outcome === 'locked' || completionResult.outcome === 'closed') {
            const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(supabase, {
              instanceId: lessonInstanceId,
            });
            if (refreshedError) {
              context.log?.error?.('lesson-instances failed to refresh locked completion state', {
                message: refreshedError.message,
                lessonInstanceId,
              });
              return respond(context, 500, { message: 'failed_to_complete_instance' });
            }
            return respondWithLockedMutation(context, {
              instanceId: lessonInstanceId,
              instanceLocks: refreshedState.instanceLocks,
              closed: refreshedState.instance?.is_closed || completionResult.outcome === 'closed',
            });
          }

          if (completionResult.outcome !== 'completed') {
            context.log?.error?.('lesson-instances received unexpected completion outcome', {
              outcome: completionResult.outcome,
              lessonInstanceId,
            });
            return respond(context, 500, { message: 'failed_to_complete_instance' });
          }

          completedParticipantAuditRows = normalizeCancelledParticipantAuditRows(completionResult.promotedParticipantAuditRows);
          updates.status = 'completed';
          updates.documentation_status = nextDocumentationStatus || mutationState.instance.documentation_status;
          updates.metadata = completionResult.instanceMetadata;
          auditBeforeState = completionResult.instanceBeforeState
            ? normalizeLessonInstanceRecord(completionResult.instanceBeforeState)
            : mutationState.instance;
          updatedRows = {
            id: lessonInstanceId,
            version: completionResult.instanceVersion ?? mutationState.instance.version,
          };
          postUpdateData = completionResult.instanceAfterState
            ? normalizeLessonInstanceRecord(completionResult.instanceAfterState)
            : {
                ...mutationState.instance,
                ...updates,
                version: updatedRows.version,
              };
        } catch (completionError) {
          context.log?.error?.('lesson-instances failed to complete instance atomically', {
            message: completionError?.message,
            lessonInstanceId,
          });
          return respond(context, 500, { message: 'failed_to_complete_instance' });
        }
      }
      if (nextStatus && nextStatus !== 'cancelled' && nextStatus !== 'completed') {
        updates.status = nextStatus;
      }
    }

    if (nextStatus !== 'cancelled' && nextStatus !== 'completed') {
      let updateBuilder = withOrgScope(supabase, 'lesson_instances', orgId)
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

      const { data: updatedInstanceRows, error: updateError } = await updateBuilder
        .select('id, version')
        .maybeSingle();

      if (updateError) {
        context.log?.error?.('lesson-instances failed to update instance', { message: updateError.message });
        return respond(context, 500, { message: 'failed_to_update_lesson_instance' });
      }

      if (!updatedInstanceRows) {
        const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(supabase, {
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

      updatedRows = updatedInstanceRows;
      postUpdateData = {
        ...mutationState.instance,
        ...updates,
        version: updatedRows.version,
      };
    }

    // Sync financial artifacts and instructor attendance when status changes
    if (nextStatus) {
      try {
        await billingService.syncLessonInstanceCharges({
          lessonInstanceId,
          actorUserId: userId,
          reasonCode: 'lesson_updated',
        });
        await syncLessonInstructorEarnings(supabase, lessonInstanceId, userId);
        await syncInstructorAttendanceFromLessons(supabase, lessonInstanceId, userId);
        await syncLessonClosureState(supabase, lessonInstanceId, userId);
      } catch (syncError) {
        context.log?.error?.('lesson-instances failed to sync financial artifacts', {
          message: syncError?.message,
          lessonInstanceId,
        });
        // Non-fatal: status update succeeded, log but continue
      }
    }

    const { data, error } = await withOrgScope(supabase, 'lesson_instances', orgId)
      .select(buildInstanceSelect())
      .eq('id', lessonInstanceId)
      .single();

    if (error) {
      context.log?.error?.('lesson-instances failed to load updated instance', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
    }

    try {
      await logTenantAuditEvent(supabase, {
        actorUserId: userId,
        eventType: 'calendar.lesson_instance.updated',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'lesson_instance',
        resourceId: lessonInstanceId,
        beforeState: auditBeforeState,
        afterState: postUpdateData || data,
        details: {
          origin: 'api/lesson-instances',
          updated_fields: Object.keys(updates),
        },
      });
    } catch (auditError) {
      context.log?.warn?.('lesson-instances failed to write tenant audit (update)', { message: auditError?.message, lessonInstanceId });
    }

    if (nextStatus === 'cancelled' && cancelledParticipantIds.length > 0) {
      try {
        for (const row of cancelledParticipantAuditRows) {
          await logTenantAuditEvent(supabase, {
            actorUserId: userId,
            eventType: 'calendar.lesson_participant.cancelled_by_instance',
            retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
            resourceType: 'lesson_participant',
            resourceId: row.participant_id,
            beforeState: row.before_state || null,
            afterState: row.after_state || null,
            details: {
              origin: 'api/lesson-instances',
              lesson_instance_id: lessonInstanceId,
              cancellation_source: 'instance_cancelled',
            },
          });
        }
      } catch (participantAuditError) {
        context.log?.warn?.('lesson-instances failed to write participant cancellation audit events', {
          message: participantAuditError?.message,
          lessonInstanceId,
        });
      }
    }

    if (nextStatus === 'completed' && completedParticipantAuditRows.length > 0) {
      try {
        for (const row of completedParticipantAuditRows) {
          await logTenantAuditEvent(supabase, {
            actorUserId: userId,
            eventType: 'calendar.lesson_participant.attended_by_instance_completion',
            retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
            resourceType: 'lesson_participant',
            resourceId: row.participant_id,
            beforeState: row.before_state || null,
            afterState: row.after_state || null,
            details: {
              origin: 'api/lesson-instances',
              lesson_instance_id: lessonInstanceId,
              completion_source: 'instance_completed',
            },
          });
        }
      } catch (participantAuditError) {
        context.log?.warn?.('lesson-instances failed to write participant completion audit events', {
          message: participantAuditError?.message,
          lessonInstanceId,
        });
      }
    }

    const [enriched] = await enrichLessonInstanceRecordsForResponse(supabase, orgId, data);
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

      const { error: addStateError, result: addMutationState } = await fetchLessonMutationState(supabase, { instanceId });
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
        const { data: studentRow } = await withOrgScope(supabase, 'students', orgId)
          .select('id, client_profile_id')
          .eq('id', resolvedStudentId)
          .maybeSingle();
        resolvedClientProfileId = studentRow?.client_profile_id || '';
      }
      if (resolvedClientProfileId && !resolvedStudentId) {
        const { data: studentRow } = await withOrgScope(supabase, 'students', orgId)
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
        withOrgScope(supabase, 'lesson_participants', orgId)
          .select('id')
          .eq('lesson_instance_id', instanceId)
          .in('participant_status', ['scheduled', 'attended']),
        withOrgScope(supabase, 'instructor_service_capabilities', orgId)
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

      const { data: newParticipant, error: insertError } = await withOrgScope(supabase, 'lesson_participants', orgId)
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
        await logTenantAuditEvent(supabase, {
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
        await syncLessonClosureState(supabase, instanceId, userId);
      } catch (closureError) {
        context.log?.warn?.('lesson-instances failed to sync lesson closure after add-participant', {
          message: closureError?.message,
          lessonInstanceId: instanceId,
        });
      }

      const { data: addedRefreshed, error: addedRefreshError } = await withOrgScope(supabase, 'lesson_instances', orgId)
        .select(buildInstanceSelect()).eq('id', instanceId).single();
      if (addedRefreshError) return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
      const [addedEnriched] = await enrichLessonInstanceRecordsForResponse(supabase, orgId, addedRefreshed);
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

    const fromBounds = buildUtcBoundsForTimezoneDateRange(fromDate, fromDate);
    if (!fromBounds?.startIso) {
      return respond(context, 400, { message: 'invalid_from_date' });
    }

    // Find all future lesson_instances where this student is a participant and status is 'scheduled'
    let futureParticipantsQuery = withOrgScope(client, 'lesson_participants', orgId)
      .select('id, lesson_instance_id, lesson_instance:lesson_instances(id, datetime_start, status)')
      .gte('lesson_instance.datetime_start', fromBounds.startIso)
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

    const participantsByInstanceId = new Map();
    for (const participant of matchedParticipants) {
      if (!participantsByInstanceId.has(participant.lesson_instance_id)) {
        participantsByInstanceId.set(participant.lesson_instance_id, []);
      }
      participantsByInstanceId.get(participant.lesson_instance_id).push(participant.id);
    }

    const uniqueInstanceIds = [...participantsByInstanceId.keys()];
    const skippedInstances = [];
    const syncedInstanceIds = [];
    let cancelledParticipantCount = 0;

    for (const instId of uniqueInstanceIds) {
      const targetedParticipantIds = participantsByInstanceId.get(instId) || [];

      let cancellationResult;
      try {
        cancellationResult = await cancelSelectedScheduledParticipantsAndReconcileInstance(client, {
          orgId,
          instanceId: instId,
          participantIds: targetedParticipantIds,
          userId,
        });
      } catch (instanceCancelError) {
        context.log?.error?.('lesson-instances bulk-cancel failed to cancel scheduled participants atomically', {
          message: instanceCancelError?.message,
          instanceId: instId,
        });
        return respond(context, 500, { message: 'failed_to_cancel_participants' });
      }

      if (cancellationResult.outcome === 'updated') {
        cancelledParticipantCount += cancellationResult.cancelledParticipantIds.length;
        syncedInstanceIds.push(instId);

        try {
          await logTenantAuditEvent(client, {
            actorUserId: userId,
            eventType: 'calendar.lesson_instance.updated',
            retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
            resourceType: 'lesson_instance',
            resourceId: instId,
            beforeState: cancellationResult.instanceBeforeState
              ? normalizeLessonInstanceRecord(cancellationResult.instanceBeforeState)
              : null,
            afterState: cancellationResult.instanceAfterState
              ? normalizeLessonInstanceRecord(cancellationResult.instanceAfterState)
              : null,
            details: {
              origin: 'api/lesson-instances',
              action: 'bulk-cancel',
              updated_fields: ['status', 'metadata'],
            },
          });
        } catch (instanceAuditError) {
          context.log?.warn?.('lesson-instances bulk-cancel failed to write instance audit event', {
            message: instanceAuditError?.message,
            instanceId: instId,
          });
        }

        try {
          for (const row of normalizeCancelledParticipantAuditRows(cancellationResult.cancelledParticipantAuditRows)) {
            await logTenantAuditEvent(client, {
              actorUserId: userId,
              eventType: 'calendar.lesson_participant.cancelled_student_bulk',
              retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
              resourceType: 'lesson_participant',
              resourceId: row.participant_id,
              beforeState: row.before_state || null,
              afterState: row.after_state || null,
              details: {
                origin: 'api/lesson-instances',
                lesson_instance_id: instId,
                cancellation_source: 'student_bulk_cancel',
              },
            });
          }
        } catch (participantAuditError) {
          context.log?.warn?.('lesson-instances bulk-cancel failed to write participant audit events', {
            message: participantAuditError?.message,
            instanceId: instId,
          });
        }

        try {
          await billingService.syncLessonInstanceCharges({
            lessonInstanceId: instId,
            actorUserId: userId,
            reasonCode: 'lesson_updated',
          });
          await syncLessonInstructorEarnings(client, instId, userId);
          await syncInstructorAttendanceFromLessons(client, instId, userId);
          await syncLessonClosureState(client, instId, userId);
        } catch (syncError) {
          context.log?.error?.('lesson-instances bulk-cancel failed to sync lesson workflow', {
            message: syncError?.message,
            instanceId: instId,
          });
          return respond(context, 500, { message: 'failed_to_sync_financial_artifacts' });
        }

        continue;
      }

      if (['locked', 'closed', 'participant_status_conflict', 'no_target_participants', 'not_found'].includes(cancellationResult.outcome)) {
        skippedInstances.push({
          instance_id: instId,
          reason: cancellationResult.outcome,
          blocking_participants: cancellationResult.blockingParticipants || [],
        });
        continue;
      }

      context.log?.error?.('lesson-instances bulk-cancel received unexpected outcome', {
        outcome: cancellationResult.outcome,
        instanceId: instId,
      });
      return respond(context, 500, { message: 'failed_to_cancel_participants' });
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
        cancelled_count: cancelledParticipantCount,
        instance_ids: syncedInstanceIds,
        skipped_instances: skippedInstances.map((item) => ({
          instance_id: item.instance_id,
          reason: item.reason,
        })),
      },
    });

    return respond(context, 200, {
      cancelled_count: cancelledParticipantCount,
      instance_count: syncedInstanceIds.length,
      skipped_instances: skippedInstances,
    });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
