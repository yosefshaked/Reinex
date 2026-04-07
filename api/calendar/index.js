/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import {
  fetchLessonMutationState,
  isLockedState,
  parseExpectedVersion,
  resolveActorInstructorId,
  respondWithLockedMutation,
  respondWithVersionConflict,
} from '../_shared/calendar-editing.js';
import { enrichInstancesWithCorrectionState } from '../_shared/calendar-corrections.js';
import {
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { assertNoLeaveForLesson, loadFinancePolicies, syncInstructorAttendanceFromLessons, syncLessonInstructorEarnings, toDateKey, validateInstructorRateForLesson } from '../_shared/employee-finance.js';
import { syncLessonBillingArtifacts } from '../_shared/student-billing.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { mergeParticipantWorkflowMetadata, syncLessonClosureState } from '../_shared/calendar-workflow.js';
import { createDashboardTask } from '../_shared/dashboard-tasks.js';
import {
  extractScheduleSlotFromIso,
  hasConfiguredAvailability,
  isWithinAvailabilityWindows,
} from '../_shared/instructor-availability.js';

const MAX_BODY_BYTES = 128 * 1024;
const INSTANCE_STATUSES = new Set(['scheduled', 'completed', 'cancelled_student', 'cancelled_clinic', 'no_show']);

async function promoteScheduledParticipantsForCompletedLesson(tenantClient, {
  instanceId,
  userId,
  instanceMetadata,
  instanceDateTimeStart,
}) {
  const { data: scheduledParticipants, error: scheduledParticipantsError } = await tenantClient
    .from('lesson_participants')
    .select('id, student_id, commitment_id, metadata')
    .eq('lesson_instance_id', instanceId)
    .eq('participant_status', 'scheduled');

  if (scheduledParticipantsError) {
    throw scheduledParticipantsError;
  }

  const participantsToPromote = Array.isArray(scheduledParticipants) ? scheduledParticipants : [];
  if (participantsToPromote.length === 0) {
    return;
  }

  const nowIso = new Date().toISOString();
  const { error: promoteError } = await tenantClient
    .from('lesson_participants')
    .update({
      participant_status: 'attended',
      attendance_confirmed_at: nowIso,
      attendance_confirmed_by: userId,
      updated_by: userId,
    })
    .eq('lesson_instance_id', instanceId)
    .eq('participant_status', 'scheduled');

  if (promoteError) {
    throw promoteError;
  }

  const policies = await loadFinancePolicies(tenantClient);
  const currentMetadata = instanceMetadata && typeof instanceMetadata === 'object' ? instanceMetadata : {};
  const existingSnapshots = currentMetadata.attendance_resolution_snapshots && typeof currentMetadata.attendance_resolution_snapshots === 'object'
    ? currentMetadata.attendance_resolution_snapshots
    : {};
  const nextSnapshots = { ...existingSnapshots };

  for (const participant of participantsToPromote) {
    const mergedWorkflowMetadata = mergeParticipantWorkflowMetadata(participant.metadata, {
      student_billing: {
        decision: 'pending',
        decided_at: nowIso,
        decided_by: userId,
        reason: 'attended',
      },
      instructor_compensation: {
        decision: 'compensated',
        decided_at: nowIso,
        decided_by: userId,
        reason: 'attended',
      },
      hmo_claim: {
        decision: 'pending',
        decided_at: nowIso,
        decided_by: userId,
        reason: 'attended',
      },
    });

    const { error: metadataUpdateError } = await tenantClient
      .from('lesson_participants')
      .update({ metadata: mergedWorkflowMetadata })
      .eq('id', participant.id)
      .eq('lesson_instance_id', instanceId);

    if (metadataUpdateError) {
      throw metadataUpdateError;
    }

    nextSnapshots[participant.id] = {
      evaluated_at: nowIso,
      participant_status: 'attended',
      billing_consumption_policy: policies.billingConsumptionPolicy,
      instructor_earnings_policy: policies.instructorEarningsPolicy,
      instructor_compensation_decision: 'compensated',
    };
  }

  const { error: snapshotUpdateError } = await tenantClient
    .from('lesson_instances')
    .update({
      metadata: {
        ...currentMetadata,
        attendance_resolution_snapshots: nextSnapshots,
      },
    })
    .eq('id', instanceId);

  if (snapshotUpdateError) {
    throw snapshotUpdateError;
  }

  const participantIdsWithCommitments = participantsToPromote
    .filter((participant) => participant?.commitment_id)
    .map((participant) => participant.id);

  if (participantIdsWithCommitments.length === 0) {
    return;
  }

  const commitmentIds = Array.from(new Set(
    participantsToPromote.map((participant) => participant?.commitment_id).filter(Boolean),
  ));
  const studentIds = Array.from(new Set(
    participantsToPromote.map((participant) => participant?.student_id).filter(Boolean),
  ));

  const [{ data: commitments, error: commitmentsError }, { data: students, error: studentsError }] = await Promise.all([
    tenantClient
      .from('commitments')
      .select('id, commitment_type, hmo_provider_id, is_active')
      .in('id', commitmentIds),
    studentIds.length > 0
      ? tenantClient
        .from('students')
        .select('id, client_profile:client_profiles(first_name, last_name)')
        .in('id', studentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (commitmentsError) {
    throw commitmentsError;
  }
  if (studentsError) {
    throw studentsError;
  }

  const commitmentById = new Map((commitments || []).map((row) => [row.id, row]));
  const studentById = new Map((students || []).map((row) => [row.id, row]));
  const lessonDate = instanceDateTimeStart
    ? new Date(instanceDateTimeStart).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  for (const participant of participantsToPromote) {
    const commitment = participant?.commitment_id ? commitmentById.get(participant.commitment_id) || null : null;
    const isHmo = commitment?.is_active !== false
      && (commitment?.commitment_type === 'hmo' || Boolean(commitment?.hmo_provider_id));
    if (!isHmo) {
      continue;
    }

    const student = participant?.student_id ? studentById.get(participant.student_id) || null : null;
    const studentProfile = student?.client_profile || null;
    const studentName = [studentProfile?.first_name, studentProfile?.last_name].filter(Boolean).join(' ') || 'תלמיד';
    const description = lessonDate
      ? `שיעור של ${studentName} בתאריך ${lessonDate} דורש הגשת תביעה.`
      : `שיעור של ${studentName} דורש הגשת תביעה.`;

    await createDashboardTask(tenantClient, {
      taskType: 'hmo_claim_submission',
      title: 'הגשת תביעה לביטוח לאומי',
      description,
      priority: 'medium',
      resourceType: 'lesson_participant',
      resourceId: participant.id,
      createdBy: userId,
      metadata: {
        lesson_instance_id: instanceId,
        student_id: participant.student_id,
        commitment_id: participant.commitment_id,
      },
    });
  }
}

function normalizeSchedulingOverrideMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { metadata: {}, override: null };
  }

  const nextMetadata = { ...metadata };
  const rawOverride = metadata.scheduling_override;
  if (!rawOverride || typeof rawOverride !== 'object' || Array.isArray(rawOverride)) {
    return { metadata: nextMetadata, override: null };
  }

  const reason = normalizeString(rawOverride.reason);
  if (!reason) {
    delete nextMetadata.scheduling_override;
    return { metadata: nextMetadata, override: null };
  }

  const normalizedOverride = {
    type: 'one_time_exception',
    reason,
    ...(normalizeString(rawOverride.reason_code) ? { reason_code: normalizeString(rawOverride.reason_code) } : {}),
    created_by_ui: rawOverride.created_by_ui === true,
    created_at: normalizeString(rawOverride.created_at) || new Date().toISOString(),
  };

  nextMetadata.scheduling_override = normalizedOverride;
  return { metadata: nextMetadata, override: normalizedOverride };
}

function buildSchedulingOverrideAuditDetails(metadata) {
  const reason = normalizeString(metadata?.scheduling_override?.reason);
  return {
    scheduling_override_used: Boolean(reason),
    ...(reason ? { scheduling_override_reason: reason } : {}),
  };
}

async function validateLessonInstanceAvailability(tenantClient, {
  instructorEmployeeId,
  serviceId,
  datetimeStart,
  durationMinutes,
  metadata,
}) {
  const { data, error } = await tenantClient
    .from('instructor_service_capabilities')
    .select('employee_id, service_id, availability_windows')
    .eq('employee_id', instructorEmployeeId)
    .eq('service_id', serviceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return { ok: false, code: 'missing_instructor_service_capability' };
  }

  const { override } = normalizeSchedulingOverrideMetadata(metadata);
  if (override) {
    return { ok: true, code: null, override };
  }

  if (!hasConfiguredAvailability(data.availability_windows)) {
    return { ok: false, code: 'missing_instructor_service_availability' };
  }

  const slot = extractScheduleSlotFromIso(datetimeStart);
  if (!slot) {
    return { ok: false, code: 'invalid_datetime_start' };
  }

  if (!isWithinAvailabilityWindows({
    availabilityWindows: data.availability_windows,
    day: slot.day,
    startTime: slot.startTime,
    durationMinutes,
  })) {
    return { ok: false, code: 'outside_instructor_service_availability' };
  }

  return { ok: true, code: null, override: null };
}

/**
 * GET /api/calendar/instances
 * Query params:
 *   - org_id (required)
 *   - date (YYYY-MM-DD, optional, defaults to today)
 *   - start_date (YYYY-MM-DD, optional, for range queries)
 *   - end_date (YYYY-MM-DD, optional, for range queries)
 *   - instructor_id (UUID, optional, filter by instructor)
 *
 * Returns: Array of lesson instances with embedded participants, students, services, and instructors
 */
export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('calendar/instances missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('calendar/instances missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('calendar/instances failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'calendar/instances' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('calendar/instances failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const canManageAll = isAdminOrOffice(role);

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    return await handleGetInstances(context, req, tenantClient, userId, canManageAll);
  }

  if (method === 'POST') {
    return await handleCreateInstance(context, body, tenantClient, supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      role,
      canManageAll,
    });
  }

  if (method === 'PUT') {
    return await handleUpdateInstance(context, body, tenantClient, supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      role,
      canManageAll,
    });
  }

  return respond(context, 405, { message: 'method not allowed' });
}

async function handleGetInstances(context, req, tenantClient, userId, canManageAll) {
  const queryParams = req.query || {};
  
  // Parse date parameters
  const dateParam = normalizeString(queryParams.date);
  const startDateParam = normalizeString(queryParams.start_date || queryParams.start);
  const endDateParam = normalizeString(queryParams.end_date || queryParams.end);
  const instructorIdParam = normalizeString(queryParams.instructor_id);
  const studentIdParam = normalizeString(queryParams.student_id);
  const clientProfileIdParam = normalizeString(queryParams.client_profile_id || queryParams.clientProfileId);

  // Determine date range
  let startDate, endDate;
  
  if (startDateParam && endDateParam) {
    // Range query
    startDate = startDateParam;
    endDate = endDateParam;
  } else if (dateParam) {
    // Single date query (day view)
    startDate = dateParam;
    endDate = dateParam;
  } else {
    // Default to today
    const today = new Date().toISOString().split('T')[0];
    startDate = today;
    endDate = today;
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return respond(context, 400, { message: 'invalid date format, use YYYY-MM-DD' });
  }

  // Build query
  const participantsJoin = studentIdParam || clientProfileIdParam ? 'lesson_participants!inner' : 'lesson_participants';

  let instancesQuery = tenantClient
    .from('lesson_instances')
    .select(`
      id,
      template_id,
      datetime_start,
      duration_minutes,
      instructor_employee_id,
      service_id,
      status,
      documentation_status,
      closed_reason,
      version,
      created_source,
      metadata,
      created_at,
      updated_at,
      participants:${participantsJoin}(
        id,
        client_profile_id,
        student_id,
        participant_status,
        version,
        price_charged,
        pricing_breakdown,
        commitment_id,
        documentation_ref,
        reminder_sent,
        reminder_seen,
        attendance_confirmed_at,
        documented_at,
        metadata,
        student:students(
          id,
          client_profile_id
        ),
        client_profile:client_profiles(
          id,
          first_name,
          middle_name,
          last_name,
          phone,
          email,
          default_notification_method
        )
      ),
      service:Services(
        id,
        name,
        color,
        is_active
      ),
      instructor:Employees(
        id,
        first_name,
        middle_name,
        last_name,
        email
      )
    `)
    .gte('datetime_start', `${startDate}T00:00:00`)
    .lte('datetime_start', `${endDate}T23:59:59`)
    .order('datetime_start', { ascending: true });

  // Filter by instructor if provided
  if (instructorIdParam) {
    instancesQuery = instancesQuery.eq('instructor_employee_id', instructorIdParam);
  }

  if (studentIdParam) {
    instancesQuery = instancesQuery.eq('participants.student_id', studentIdParam);
  }
  if (clientProfileIdParam) {
    instancesQuery = instancesQuery.eq('participants.client_profile_id', clientProfileIdParam);
  }

  // Non-admin/office users: filter by their instructor record
  if (!canManageAll) {
    const { instructorId, error: instructorError } = await resolveActorInstructorId(tenantClient, userId);

    if (instructorError) {
      context.log?.error?.('calendar/instances failed to find instructor', { message: instructorError.message });
      return respond(context, 500, { message: 'failed_to_load_instructor' });
    }

    if (!instructorId) {
      // User is not an instructor, return empty array
      return respond(context, 200, []);
    }

    instancesQuery = instancesQuery.eq('instructor_employee_id', instructorId);
  }

  const { data: instances, error } = await instancesQuery;

  if (error) {
    context.log?.error?.('calendar/instances failed to fetch instances', { 
      message: error.message,
      code: error.code,
      details: error.details,
    });
    return respond(context, 500, { 
      message: 'failed_to_load_instances',
      error: error.message,
      details: error.details,
    });
  }

  const clientProfileIds = Array.from(new Set(
    (instances || []).flatMap((instance) => (
      Array.isArray(instance.participants)
        ? instance.participants.map((participant) => participant?.client_profile_id).filter(Boolean)
        : []
    )),
  ));

  const clientProfileIdByStudentId = new Map();
  for (const instance of instances || []) {
    for (const participant of Array.isArray(instance?.participants) ? instance.participants : []) {
      if (participant?.student_id && participant?.client_profile_id) {
        clientProfileIdByStudentId.set(participant.student_id, participant.client_profile_id);
      }
    }
  }

  const primaryGuardianLinkByClientProfile = new Map();
  if (clientProfileIds.length > 0) {
    const { data: clientGuardianLinks, error: linksError } = await tenantClient
      .from('client_guardians')
      .select('client_profile_id, guardian_id, relationship, is_primary, created_at')
      .in('client_profile_id', clientProfileIds)
      .order('client_profile_id', { ascending: true })
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (linksError) {
      context.log?.warn?.('calendar/instances failed to fetch client_guardians links', {
        message: linksError.message,
      });
    } else {
      for (const link of clientGuardianLinks || []) {
        if (!link?.client_profile_id || !link?.guardian_id) continue;
        if (!primaryGuardianLinkByClientProfile.has(link.client_profile_id)) {
          primaryGuardianLinkByClientProfile.set(link.client_profile_id, link);
        }
      }
    }
  }

  const guardianIds = Array.from(new Set(
    Array.from(primaryGuardianLinkByClientProfile.values()).map((link) => link.guardian_id).filter(Boolean),
  ));
  const guardiansById = new Map();

  if (guardianIds.length > 0) {
    const { data: guardians, error: guardiansError } = await tenantClient
      .from('guardians')
      .select('id, first_name, middle_name, last_name, phone, email')
      .in('id', guardianIds);

    if (guardiansError) {
      context.log?.warn?.('calendar/instances failed to fetch guardians', {
        message: guardiansError.message,
      });
    } else {
      for (const guardian of guardians || []) {
        if (!guardian?.id) continue;
        guardiansById.set(guardian.id, guardian);
      }
    }
  }

  // Transform data for frontend consumption
  const transformedInstances = (instances || []).map(instance => {
    const participants = Array.isArray(instance.participants) 
      ? instance.participants.map(p => ({
          id: p.id,
          client_profile_id: p.client_profile_id,
          student_id: p.student_id,
          participant_status: p.participant_status,
          version: p.version ?? 1,
          price_charged: p.price_charged,
          pricing_breakdown: p.pricing_breakdown,
          commitment_id: p.commitment_id,
          documentation_ref: p.documentation_ref,
          reminder_sent: p.reminder_sent,
          reminder_seen: p.reminder_seen,
          attendance_confirmed_at: p.attendance_confirmed_at,
          documented_at: p.documented_at,
          client_profile: p.client_profile ? {
            id: p.client_profile.id,
            first_name: p.client_profile.first_name,
            middle_name: p.client_profile.middle_name,
            last_name: p.client_profile.last_name,
            full_name: [p.client_profile.first_name, p.client_profile.middle_name, p.client_profile.last_name]
              .filter(Boolean)
              .join(' '),
            phone: p.client_profile.phone ?? null,
            email: p.client_profile.email ?? null,
            default_notification_method: p.client_profile.default_notification_method ?? 'whatsapp',
            primary_guardian: (() => {
              const link = primaryGuardianLinkByClientProfile.get(p.client_profile_id);
              if (!link) return null;
              const guardian = guardiansById.get(link.guardian_id);
              if (!guardian) return null;
              return {
                id: guardian.id,
                first_name: guardian.first_name,
                middle_name: guardian.middle_name,
                last_name: guardian.last_name,
                phone: guardian.phone ?? null,
                email: guardian.email ?? null,
                relationship: link.relationship ?? null,
                is_primary: link.is_primary ?? true,
              };
            })(),
          } : null,
          student: p.student ? {
            id: p.student.id,
            client_profile_id: p.student.client_profile_id || p.client_profile_id || p.client_profile?.id || null,
            first_name: p.client_profile?.first_name || '',
            middle_name: p.client_profile?.middle_name || null,
            last_name: p.client_profile?.last_name || '',
            full_name: [p.client_profile?.first_name, p.client_profile?.middle_name, p.client_profile?.last_name]
              .filter(Boolean)
              .join(' '),
            phone: p.client_profile?.phone ?? null,
            email: p.client_profile?.email ?? null,
            default_notification_method: p.client_profile?.default_notification_method ?? 'whatsapp',
            primary_guardian: (() => {
      const link = primaryGuardianLinkByClientProfile.get(clientProfileIdByStudentId.get(p.student_id));
              if (!link) return null;
              const guardian = guardiansById.get(link.guardian_id);
              if (!guardian) return null;
              return {
                id: guardian.id,
                first_name: guardian.first_name,
                middle_name: guardian.middle_name,
                last_name: guardian.last_name,
                phone: guardian.phone ?? null,
                email: guardian.email ?? null,
                relationship: link.relationship ?? null,
                is_primary: link.is_primary ?? true,
              };
            })(),
          } : null,
        }))
      : [];

    return {
      id: instance.id,
      template_id: instance.template_id,
      datetime_start: instance.datetime_start,
      duration_minutes: instance.duration_minutes,
      instructor_employee_id: instance.instructor_employee_id,
      service_id: instance.service_id,
      status: instance.status,
      documentation_status: instance.documentation_status,
      closed_reason: instance.closed_reason || null,
      version: instance.version ?? 1,
      created_source: instance.created_source,
      metadata: instance.metadata,
      created_at: instance.created_at,
      updated_at: instance.updated_at,
      participants,
      service: instance.service ? {
        id: instance.service.id,
        service_name: instance.service.name,
        color: instance.service.color,
        is_active: instance.service.is_active,
      } : null,
      instructor: instance.instructor ? {
        id: instance.instructor.id,
        first_name: instance.instructor.first_name,
        middle_name: instance.instructor.middle_name,
        last_name: instance.instructor.last_name,
        full_name: [instance.instructor.first_name, instance.instructor.middle_name, instance.instructor.last_name]
          .filter(Boolean)
          .join(' '),
        email: instance.instructor.email,
      } : null,
    };
  });

  const enrichedInstances = await enrichInstancesWithCorrectionState(tenantClient, transformedInstances);
  return respond(context, 200, enrichedInstances);
}

async function handleCreateInstance(context, body, tenantClient, supabase, authContext) {
  const { orgId, userId, userEmail, role, canManageAll: isAdmin } = authContext;
  // Validate required fields
  if (!body.datetime_start) {
    return respond(context, 400, { message: 'missing datetime_start' });
  }
  if (!body.duration_minutes || body.duration_minutes <= 0) {
    return respond(context, 400, { message: 'missing or invalid duration_minutes' });
  }
  if (!body.instructor_employee_id) {
    return respond(context, 400, { message: 'missing instructor_employee_id' });
  }
  if (!body.service_id) {
    return respond(context, 400, { message: 'missing service_id' });
  }
  const studentIds = Array.isArray(body.student_ids) ? body.student_ids.filter(Boolean) : [];
  const clientProfileIds = Array.isArray(body.client_profile_ids || body.clientProfileIds)
    ? (body.client_profile_ids || body.clientProfileIds).filter(Boolean)
    : [];
  if (studentIds.length === 0 && clientProfileIds.length === 0) {
    return respond(context, 400, { message: 'missing_or_invalid_participants' });
  }

  const requestedStatus = typeof body.status === 'string' ? body.status.trim().toLowerCase() : 'scheduled';
  const normalizedSchedulingMetadata = normalizeSchedulingOverrideMetadata(body.metadata);
  if (!INSTANCE_STATUSES.has(requestedStatus)) {
    return respond(context, 400, { message: 'invalid status' });
  }

  // Non-admin users can only create lessons for themselves
  if (!isAdmin) {
    const { instructorId, error: instructorError } = await resolveActorInstructorId(tenantClient, userId);
    if (instructorError) {
      context.log?.error?.('calendar/instances failed to resolve actor instructor', { message: instructorError.message, userId });
      return respond(context, 500, { message: 'failed_to_resolve_actor_instructor' });
    }

    if (!instructorId || instructorId !== body.instructor_employee_id) {
      return respond(context, 403, { message: 'forbidden: can only create lessons for yourself' });
    }
  }

  // Verify instructor exists
  const { data: instructor, error: instructorError } = await tenantClient
    .from('Employees')
    .select('id')
    .eq('id', body.instructor_employee_id)
    .eq('is_active', true)
    .single();

  if (instructorError || !instructor) {
    return respond(context, 400, { message: 'invalid instructor_employee_id' });
  }

  // Verify service exists
  const { data: service, error: serviceError } = await tenantClient
    .from('Services')
    .select('id')
    .eq('id', body.service_id)
    .eq('is_active', true)
    .single();

  if (serviceError || !service) {
    return respond(context, 400, { message: 'invalid service_id' });
  }

  const leaveConflict = await assertNoLeaveForLesson(tenantClient, {
    employeeId: body.instructor_employee_id,
    date: toDateKey(body.datetime_start),
  });

  if (leaveConflict) {
    return respond(context, 409, leaveConflict);
  }

  try {
    const availabilityValidation = await validateLessonInstanceAvailability(tenantClient, {
      instructorEmployeeId: body.instructor_employee_id,
      serviceId: body.service_id,
      datetimeStart: body.datetime_start,
      durationMinutes: body.duration_minutes,
      metadata: normalizedSchedulingMetadata.metadata,
    });

    if (!availabilityValidation.ok) {
      return respond(context, 409, { message: availabilityValidation.code });
    }
  } catch (availabilityError) {
    context.log?.error?.('calendar/instances failed to validate instructor availability on create', {
      message: availabilityError?.message,
      instructorEmployeeId: body.instructor_employee_id,
      serviceId: body.service_id,
    });
    return respond(context, 500, { message: 'failed_to_validate_instructor_availability' });
  }

  // Create lesson instance
  const instanceData = {
    template_id: body.template_id || null,
    datetime_start: body.datetime_start,
    duration_minutes: body.duration_minutes,
    instructor_employee_id: body.instructor_employee_id,
    service_id: body.service_id,
    status: requestedStatus,
    documentation_status: body.documentation_status || 'undocumented',
    created_source: body.created_source || 'manual',
    metadata: normalizedSchedulingMetadata.metadata,
    created_by: userId,
    updated_by: userId,
  };

  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .insert(instanceData)
    .select()
    .single();

  if (instanceError) {
    context.log?.error?.('calendar/instances failed to create instance', { 
      message: instanceError.message,
      code: instanceError.code,
      details: instanceError.details,
      hint: instanceError.hint,
    });
    return respond(context, 500, {
      message: 'failed_to_create_instance',
      error: instanceError.code || 'instance_insert_failed',
      details: instanceError.message,
    });
  }

  // Create participants
  const participantRecords = [
    ...studentIds.map((studentId) => ({
      client_profile_id: null,
      student_id: studentId,
    })),
    ...clientProfileIds.map((clientProfileId) => ({
      client_profile_id: clientProfileId,
      student_id: null,
    })),
  ];

  if (clientProfileIds.length > 0) {
    const { data: linkedStudents } = await tenantClient
      .from('students')
      .select('id, client_profile_id')
      .in('client_profile_id', clientProfileIds);
    const linkedStudentByClientProfile = new Map((linkedStudents || []).map((row) => [row.client_profile_id, row.id]));
    participantRecords.forEach((record) => {
      if (!record.student_id && record.client_profile_id) {
        record.student_id = linkedStudentByClientProfile.get(record.client_profile_id) || null;
      }
    });
  }

  const participantData = participantRecords.map((participant) => ({
    lesson_instance_id: instance.id,
    client_profile_id: participant.client_profile_id || null,
    student_id: participant.student_id || null,
    participant_status: 'scheduled',
    price_charged: null,
    pricing_breakdown: null,
    commitment_id: null,
    documentation_ref: null,
    metadata: {},
  }));

  const { error: participantsError } = await tenantClient
    .from('lesson_participants')
    .insert(participantData);

  if (participantsError) {
    context.log?.error?.('calendar/instances failed to create participants', { 
      message: participantsError.message,
      code: participantsError.code,
      details: participantsError.details,
      hint: participantsError.hint,
    });
    // Rollback instance creation
    await tenantClient.from('lesson_instances').delete().eq('id', instance.id);
    return respond(context, 500, {
      message: 'failed_to_create_participants',
      error: participantsError.code || 'participants_insert_failed',
      details: participantsError.message,
    });
  }

  try {
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: AUDIT_ACTIONS.CALENDAR_INSTANCE_CREATED,
      actionCategory: AUDIT_CATEGORIES.CALENDAR,
      resourceType: 'lesson_instance',
      resourceId: instance.id,
      details: {
        action_label_he: 'נוצר שיעור',
        datetime_start: instance.datetime_start,
        duration_minutes: instance.duration_minutes,
        instructor_employee_id: instance.instructor_employee_id,
        service_id: instance.service_id,
        student_ids: studentIds,
        client_profile_ids: clientProfileIds,
        created_source: instance.created_source,
        ...buildSchedulingOverrideAuditDetails(normalizedSchedulingMetadata.metadata),
      },
    });
  } catch (auditError) {
    context.log?.error?.('calendar/instances failed to write audit event (create)', {
      message: auditError?.message,
      instanceId: instance?.id,
    });
  }

  try {
    await logTenantAuditEvent(tenantClient, {
      actorUserId: userId,
      eventType: 'calendar.instance.created',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'lesson_instance',
      resourceId: instance.id,
      afterState: instance,
      details: {
        origin: 'api/calendar',
        student_ids: studentIds,
        client_profile_ids: clientProfileIds,
        ...buildSchedulingOverrideAuditDetails(normalizedSchedulingMetadata.metadata),
      },
    });
  } catch (auditError) {
    context.log?.warn?.('calendar/instances failed to write tenant audit event (create)', {
      message: auditError?.message,
      instanceId: instance?.id,
    });
  }

  try {
    await syncLessonBillingArtifacts(tenantClient, instance.id, userId);
    await syncLessonInstructorEarnings(tenantClient, instance.id, userId);
    await syncLessonClosureState(tenantClient, instance.id, userId);
  } catch (syncError) {
    context.log?.error?.('calendar/instances failed to sync financial artifacts after create', {
      message: syncError?.message,
      instanceId: instance?.id,
    });
  }

  return respond(context, 201, { id: instance.id, message: 'instance created successfully' });
}

async function handleUpdateInstance(context, body, tenantClient, supabase, authContext) {
  const { orgId, userId, userEmail, role, canManageAll } = authContext;
  if (!body.id) {
    return respond(context, 400, { message: 'missing instance id' });
  }

  const expectedVersion = parseExpectedVersion(body.version, body.expected_version, body.expectedVersion);

  const { error: mutationStateError, result: mutationState } = await fetchLessonMutationState(tenantClient, {
    instanceId: body.id,
  });

  if (mutationStateError) {
    context.log?.error?.('calendar/instances failed to load mutation state', { message: mutationStateError.message, instanceId: body.id });
    return respond(context, 500, { message: 'failed_to_load_instance' });
  }

  const existingInstance = mutationState.instance;

  if (!existingInstance) {
    return respond(context, 404, { message: 'instance not found' });
  }

  if (isLockedState(mutationState)) {
    return respondWithLockedMutation(context, {
      instanceId: body.id,
      instanceLocks: mutationState.instanceLocks,
      closed: mutationState.instance?.is_closed || false,
    });
  }

  if (expectedVersion !== null && existingInstance.version !== expectedVersion) {
    return respondWithVersionConflict(context, {
      resourceType: 'lesson_instance',
      resourceId: body.id,
      expectedVersion,
      currentVersion: existingInstance.version,
    });
  }

  // Instructors (non-admin/office) can only update their own lessons
  if (!canManageAll) {
    const { instructorId, error: instructorError } = await resolveActorInstructorId(tenantClient, userId);
    if (instructorError) {
      context.log?.error?.('calendar/instances failed to resolve actor instructor', { message: instructorError.message, userId });
      return respond(context, 500, { message: 'failed_to_resolve_actor_instructor' });
    }

    if (!instructorId || instructorId !== existingInstance.instructor_employee_id) {
      return respond(context, 403, { message: 'forbidden: can only update your own lessons' });
    }

    const allowedStatusUpdates = new Set(['completed', 'no_show']);
    const requestedStatus = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
    const hasOtherUpdates = [
      'datetime_start',
      'duration_minutes',
      'instructor_employee_id',
      'service_id',
      'closed_reason',
      'documentation_status',
      'metadata',
    ].some((field) => Object.prototype.hasOwnProperty.call(body, field));

    if (hasOtherUpdates) {
      return respond(context, 403, { message: 'forbidden: instructors can only report attendance status' });
    }

    if (!allowedStatusUpdates.has(requestedStatus)) {
      return respond(context, 400, { message: 'invalid status update' });
    }

    if (existingInstance.status !== 'scheduled') {
      return respond(context, 409, { message: 'instance not in reportable state' });
    }

    body.status = requestedStatus;
  }

  if (body.status !== undefined) {
    const normalizedStatus = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
    if (!INSTANCE_STATUSES.has(normalizedStatus)) {
      return respond(context, 400, { message: 'invalid status' });
    }
    body.status = normalizedStatus;
  }

  const targetInstructorId = body.instructor_employee_id || existingInstance.instructor_employee_id;
  const targetDate = toDateKey(body.datetime_start || existingInstance.datetime_start);
  const targetServiceId = body.service_id || existingInstance.service_id;
  const targetDurationMinutes = body.duration_minutes || existingInstance.duration_minutes;
  const targetMetadata = body.metadata !== undefined
    ? normalizeSchedulingOverrideMetadata(body.metadata).metadata
    : (existingInstance.metadata || {});
  const scheduleChanged = [
    'datetime_start',
    'duration_minutes',
    'instructor_employee_id',
    'service_id',
    'metadata',
  ].some((field) => Object.prototype.hasOwnProperty.call(body, field));

  if (targetInstructorId && targetDate) {
    const leaveConflict = await assertNoLeaveForLesson(tenantClient, {
      employeeId: targetInstructorId,
      date: targetDate,
    });

    if (leaveConflict) {
      return respond(context, 409, leaveConflict);
    }
  }

  if (scheduleChanged) {
    try {
      const availabilityValidation = await validateLessonInstanceAvailability(tenantClient, {
        instructorEmployeeId: targetInstructorId,
        serviceId: targetServiceId,
        datetimeStart: body.datetime_start || existingInstance.datetime_start,
        durationMinutes: targetDurationMinutes,
        metadata: targetMetadata,
      });

      if (!availabilityValidation.ok) {
        return respond(context, 409, { message: availabilityValidation.code });
      }
    } catch (availabilityError) {
      context.log?.error?.('calendar/instances failed to validate instructor availability on update', {
        message: availabilityError?.message,
        instanceId: body.id,
        instructorEmployeeId: targetInstructorId,
        serviceId: targetServiceId,
      });
      return respond(context, 500, { message: 'failed_to_validate_instructor_availability' });
    }
  }

  // Instructor rate pre-flight: block completion/no_show if no base_rate is configured.
  // Other statuses (cancellations) do not trigger instructor earnings so no check needed.
  const EARNING_STATUSES = new Set(['completed', 'no_show']);
  const newStatus = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
  if (EARNING_STATUSES.has(newStatus)) {
    const rateError = await validateInstructorRateForLesson(tenantClient, {
      instructorEmployeeId: body.instructor_employee_id || existingInstance.instructor_employee_id,
      serviceId: body.service_id || existingInstance.service_id,
    });
    if (rateError) {
      return respond(context, 422, {
        message: 'לא ניתן להשלים את השיעור: תעריף המדריך לשירות זה לא הוגדר. יש להגדיר תעריף בכרטיס המדריך.',
        code: rateError.code,
        instructor_employee_id: rateError.instructor_employee_id,
        service_id: rateError.service_id,
      });
    }
  }

  // Build update object (only update provided fields)
  const updateData = {};
  
  if (body.datetime_start !== undefined) updateData.datetime_start = body.datetime_start;
  if (body.duration_minutes !== undefined) updateData.duration_minutes = body.duration_minutes;
  if (body.instructor_employee_id !== undefined) updateData.instructor_employee_id = body.instructor_employee_id;
  if (body.service_id !== undefined) updateData.service_id = body.service_id;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.closed_reason !== undefined) updateData.closed_reason = body.closed_reason;
  if (body.documentation_status !== undefined) updateData.documentation_status = body.documentation_status;
  if (body.metadata !== undefined) updateData.metadata = targetMetadata;
  updateData.updated_by = userId;
  
  updateData.updated_at = new Date().toISOString();

  if ((updateData.status === 'cancelled_student' || updateData.status === 'cancelled_clinic' || updateData.status === 'no_show') &&
      updateData.closed_reason === undefined &&
      existingInstance.closed_reason) {
    updateData.closed_reason = existingInstance.closed_reason;
  }

  // Attendance status still drives the lesson instance itself, but downstream billing,
  // instructor compensation, and closure are handled by the shared workflow syncs below.

  // Update instance
  let updateQuery = tenantClient
    .from('lesson_instances')
    .update(updateData)
    .eq('id', body.id);

  if (expectedVersion !== null) {
    const shouldFilterByVersion = !(
      existingInstance?.legacy_null_version
      && expectedVersion === 1
    );
    if (shouldFilterByVersion) {
      updateQuery = updateQuery.eq('version', expectedVersion);
    }
  }

  const { data: updatedRow, error: updateError } = await updateQuery
    .select('id, version')
    .maybeSingle();

  if (updateError) {
    context.log?.error?.('calendar/instances failed to update instance', { 
      message: updateError.message,
      code: updateError.code,
    });
    return respond(context, 500, { message: 'failed_to_update_instance' });
  }

  if (!updatedRow) {
    const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(tenantClient, {
      instanceId: body.id,
    });
    if (refreshedError) {
      context.log?.error?.('calendar/instances failed to refresh instance after conflict', { message: refreshedError.message, instanceId: body.id });
      return respond(context, 500, { message: 'failed_to_update_instance' });
    }
    return respondWithVersionConflict(context, {
      resourceType: 'lesson_instance',
      resourceId: body.id,
      expectedVersion,
      currentVersion: refreshedState.instance?.version ?? null,
    });
  }

  const normalizedStatus = typeof updateData.status === 'string' ? updateData.status.trim().toLowerCase() : '';
  const isCancellationUpdate = normalizedStatus.startsWith('cancelled');

  // When the lesson is marked completed, promote any still-scheduled participants to
  // 'attended' so that the billing sync can process them (billing gates on participant status).
  if (normalizedStatus === 'completed') {
    try {
      await promoteScheduledParticipantsForCompletedLesson(tenantClient, {
        instanceId: body.id,
        userId,
        instanceMetadata: updateData.metadata !== undefined ? updateData.metadata : existingInstance.metadata,
        instanceDateTimeStart: updateData.datetime_start || existingInstance.datetime_start,
      });
    } catch (promoteError) {
      context.log?.error?.('calendar/instances failed to promote scheduled participants to attended', {
        message: promoteError?.message,
        instanceId: body.id,
      });
      // Non-fatal — continue; billing sync will just see pending_attendance for those participants
    }
  }

  try {
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: isCancellationUpdate
        ? AUDIT_ACTIONS.CALENDAR_INSTANCE_CANCELLED
        : AUDIT_ACTIONS.CALENDAR_INSTANCE_UPDATED,
      actionCategory: AUDIT_CATEGORIES.CALENDAR,
      resourceType: 'lesson_instance',
      resourceId: body.id,
      details: {
        action_label_he: isCancellationUpdate ? 'בוטל שיעור' : 'עודכן שיעור',
        previous_status: existingInstance.status,
        updated_fields: Object.keys(updateData),
        datetime_start: updateData.datetime_start || null,
        duration_minutes: updateData.duration_minutes || null,
        instructor_employee_id: updateData.instructor_employee_id || null,
        service_id: updateData.service_id || null,
        status: updateData.status || null,
        closed_reason: updateData.closed_reason || null,
        ...buildSchedulingOverrideAuditDetails(targetMetadata),
      },
    });
  } catch (auditError) {
    context.log?.error?.('calendar/instances failed to write audit event (update)', {
      message: auditError?.message,
      instanceId: body?.id,
    });
  }

  try {
    await logTenantAuditEvent(tenantClient, {
      actorUserId: userId,
      eventType: 'calendar.instance.updated',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'lesson_instance',
      resourceId: body.id,
      beforeState: existingInstance,
      afterState: {
        ...existingInstance,
        ...updateData,
        version: updatedRow?.version ?? existingInstance.version,
      },
      details: {
        origin: 'api/calendar',
        updated_fields: Object.keys(updateData),
        ...buildSchedulingOverrideAuditDetails(targetMetadata),
      },
    });
  } catch (auditError) {
    context.log?.warn?.('calendar/instances failed to write tenant audit event (update)', {
      message: auditError?.message,
      instanceId: body?.id,
    });
  }

  let billingWarnings = [];
  try {
    const billingResult = await syncLessonBillingArtifacts(tenantClient, body.id, userId);
    await syncLessonInstructorEarnings(tenantClient, body.id, userId);
    await syncInstructorAttendanceFromLessons(tenantClient, body.id, userId);
    await syncLessonClosureState(tenantClient, body.id, userId);
    billingWarnings = billingResult?.attention_required || [];
  } catch (syncError) {
    context.log?.error?.('calendar/instances failed to sync financial artifacts after update', {
      message: syncError?.message,
      instanceId: body?.id,
    });
    return respond(context, 500, { message: 'failed_to_sync_financial_artifacts' });
  }

  return respond(context, 200, {
    message: 'instance updated successfully',
    ...(billingWarnings.length > 0 ? { billing_warnings: billingWarnings } : {}),
  });
}
