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
import { assertNoLeaveForLesson, syncInstructorAttendanceFromLessons, syncLessonInstructorEarnings, toDateKey, validateInstructorRateForLesson } from '../_shared/employee-finance.js';
import { syncLessonBillingArtifacts } from '../_shared/student-billing.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { syncLessonClosureState } from '../_shared/calendar-workflow.js';
import {
  buildUtcBoundsForTimezoneDateRange,
  getCurrentDateInTimezone,
  extractScheduleSlotFromIso,
  hasConfiguredAvailability,
  isWithinAvailabilityWindows,
} from '../_shared/instructor-availability.js';
import {
  ACTIVE_LESSON_INSTANCE_STATUSES,
  cancelLessonInstanceWithParticipants,
  completeLessonInstanceWithParticipants,
  normalizeLessonInstanceStatus,
} from '../_shared/lesson-instance-status.js';

const MAX_BODY_BYTES = 128 * 1024;

function normalizeParticipantAuditRows(value) {
  return Array.isArray(value)
    ? value.filter((row) => row && typeof row === 'object' && row.participant_id)
    : [];
}

function normalizeLessonInstanceAuditState(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalizedStatus = normalizeLessonInstanceStatus(value.status);
  return {
    ...value,
    status: normalizedStatus || value.status,
  };
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
    const today = getCurrentDateInTimezone();
    startDate = today;
    endDate = today;
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return respond(context, 400, { message: 'invalid date format, use YYYY-MM-DD' });
  }

  const utcBounds = buildUtcBoundsForTimezoneDateRange(startDate, endDate);
  if (!utcBounds) {
    return respond(context, 400, { message: 'invalid date range' });
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
          client_profile_id,
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
    .gte('datetime_start', utcBounds.startIso)
    .lt('datetime_start', utcBounds.endExclusiveIso || utcBounds.endIso)
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
      ? instance.participants.map((p) => {
          const resolvedProfile = p.client_profile || p.student?.client_profile || null;
          const resolvedClientProfileId = p.client_profile_id || p.student?.client_profile_id || resolvedProfile?.id || null;
          const resolvedGuardianLink = primaryGuardianLinkByClientProfile.get(resolvedClientProfileId);
          const resolvedGuardian = resolvedGuardianLink?.guardian_id ? guardiansById.get(resolvedGuardianLink.guardian_id) : null;

          return {
            id: p.id,
            client_profile_id: resolvedClientProfileId,
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
            client_profile: resolvedProfile ? {
              id: resolvedProfile.id,
              first_name: resolvedProfile.first_name,
              middle_name: resolvedProfile.middle_name,
              last_name: resolvedProfile.last_name,
              full_name: [resolvedProfile.first_name, resolvedProfile.middle_name, resolvedProfile.last_name]
                .filter(Boolean)
                .join(' '),
              phone: resolvedProfile.phone ?? null,
              email: resolvedProfile.email ?? null,
              default_notification_method: resolvedProfile.default_notification_method ?? 'whatsapp',
              primary_guardian: resolvedGuardian ? {
                id: resolvedGuardian.id,
                first_name: resolvedGuardian.first_name,
                middle_name: resolvedGuardian.middle_name,
                last_name: resolvedGuardian.last_name,
                phone: resolvedGuardian.phone ?? null,
                email: resolvedGuardian.email ?? null,
                relationship: resolvedGuardianLink.relationship ?? null,
                is_primary: resolvedGuardianLink.is_primary ?? true,
              } : null,
            } : null,
            student: p.student ? {
              id: p.student.id,
              client_profile_id: resolvedClientProfileId,
              first_name: resolvedProfile?.first_name || '',
              middle_name: resolvedProfile?.middle_name || null,
              last_name: resolvedProfile?.last_name || '',
              full_name: [resolvedProfile?.first_name, resolvedProfile?.middle_name, resolvedProfile?.last_name]
                .filter(Boolean)
                .join(' '),
              phone: resolvedProfile?.phone ?? null,
              email: resolvedProfile?.email ?? null,
              default_notification_method: resolvedProfile?.default_notification_method ?? 'whatsapp',
              primary_guardian: resolvedGuardian ? {
                id: resolvedGuardian.id,
                first_name: resolvedGuardian.first_name,
                middle_name: resolvedGuardian.middle_name,
                last_name: resolvedGuardian.last_name,
                phone: resolvedGuardian.phone ?? null,
                email: resolvedGuardian.email ?? null,
                relationship: resolvedGuardianLink.relationship ?? null,
                is_primary: resolvedGuardianLink.is_primary ?? true,
              } : null,
            } : null,
          };
        })
      : [];

    return {
      id: instance.id,
      template_id: instance.template_id,
      datetime_start: instance.datetime_start,
      duration_minutes: instance.duration_minutes,
      instructor_employee_id: instance.instructor_employee_id,
      service_id: instance.service_id,
      status: normalizeLessonInstanceStatus(instance.status) || instance.status,
      documentation_status: instance.documentation_status,
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

  const requestedStatus = body.status === undefined ? 'scheduled' : normalizeLessonInstanceStatus(body.status);
  const normalizedSchedulingMetadata = normalizeSchedulingOverrideMetadata(body.metadata);
  if (!ACTIVE_LESSON_INSTANCE_STATUSES.has(requestedStatus)) {
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
    .select('id, default_customer_charge_amount')
    .eq('id', body.service_id)
    .eq('is_active', true)
    .single();

  if (serviceError || !service) {
    return respond(context, 400, { message: 'invalid service_id' });
  }

  const hasDirectClientParticipants = clientProfileIds.length > 0;
  const hasDirectClientChargeAmountField = Object.prototype.hasOwnProperty.call(body || {}, 'direct_client_charge_amount')
    || Object.prototype.hasOwnProperty.call(body || {}, 'directClientChargeAmount');
  const rawDirectClientChargeAmount = hasDirectClientChargeAmountField
    ? body?.direct_client_charge_amount ?? body?.directClientChargeAmount
    : undefined;
  const directClientChargeAmount = rawDirectClientChargeAmount === undefined || rawDirectClientChargeAmount === null || rawDirectClientChargeAmount === ''
    ? null
    : Number(rawDirectClientChargeAmount);

  if (directClientChargeAmount !== null && (!Number.isFinite(directClientChargeAmount) || directClientChargeAmount < 0)) {
    return respond(context, 400, { message: 'invalid_direct_client_charge_amount' });
  }

  if (
    hasDirectClientParticipants
    && !Number.isFinite(Number(service.default_customer_charge_amount))
    && directClientChargeAmount === null
  ) {
    return respond(context, 400, { message: 'missing_direct_client_charge_amount' });
  }

  const participantRows = [];

  if (studentIds.length > 0) {
    const { data: studentRows, error: studentRowsError } = await tenantClient
      .from('students')
      .select('id, client_profile_id')
      .in('id', studentIds);

    if (studentRowsError) {
      context.log?.error?.('calendar/instances failed to validate student participants', {
        message: studentRowsError.message,
        orgId,
        studentIds,
      });
      return respond(context, 500, { message: 'failed_to_validate_participants' });
    }

    const studentById = new Map((studentRows || []).map((row) => [row.id, row]));
    const missingStudentId = studentIds.find((studentId) => !studentById.has(studentId) || !studentById.get(studentId)?.client_profile_id);
    if (missingStudentId) {
      return respond(context, 400, { message: 'invalid_student_id' });
    }

    for (const studentId of studentIds) {
      const row = studentById.get(studentId);
      participantRows.push({
        client_profile_id: row.client_profile_id,
        student_id: row.id,
      });
    }
  }

  if (clientProfileIds.length > 0) {
    const { data: clientProfileRows, error: clientProfileRowsError } = await tenantClient
      .from('client_profiles')
      .select('id, is_active')
      .in('id', clientProfileIds);

    if (clientProfileRowsError) {
      context.log?.error?.('calendar/instances failed to validate client participants', {
        message: clientProfileRowsError.message,
        orgId,
        clientProfileIds,
      });
      return respond(context, 500, { message: 'failed_to_validate_participants' });
    }

    const clientProfileById = new Map((clientProfileRows || []).map((row) => [row.id, row]));
    const missingClientProfileId = clientProfileIds.find((clientProfileId) => !clientProfileById.has(clientProfileId));
    if (missingClientProfileId) {
      return respond(context, 400, { message: 'invalid_client_profile_id' });
    }

    const { data: linkedStudents, error: linkedStudentsError } = await tenantClient
      .from('students')
      .select('id, client_profile_id')
      .in('client_profile_id', clientProfileIds);

    if (linkedStudentsError) {
      context.log?.error?.('calendar/instances failed to resolve linked students for client participants', {
        message: linkedStudentsError.message,
        orgId,
        clientProfileIds,
      });
      return respond(context, 500, { message: 'failed_to_validate_participants' });
    }

    const linkedStudentByClientProfile = new Map((linkedStudents || []).map((row) => [row.client_profile_id, row.id]));
    for (const clientProfileId of clientProfileIds) {
      participantRows.push({
        client_profile_id: clientProfileId,
        student_id: linkedStudentByClientProfile.get(clientProfileId) || null,
      });
    }
  }

  const participantByClientProfileId = new Map();
  for (const row of participantRows) {
    if (!row?.client_profile_id || participantByClientProfileId.has(row.client_profile_id)) {
      continue;
    }
    participantByClientProfileId.set(row.client_profile_id, row);
  }

  const resolvedParticipants = Array.from(participantByClientProfileId.values());
  if (resolvedParticipants.length === 0) {
    return respond(context, 400, { message: 'missing_or_invalid_participants' });
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
  const participantData = resolvedParticipants.map((participant) => ({
    lesson_instance_id: instance.id,
    client_profile_id: participant.client_profile_id || null,
    student_id: participant.student_id || null,
    participant_status: 'scheduled',
    price_charged: null,
    pricing_breakdown: null,
    commitment_id: null,
    documentation_ref: null,
    metadata: (!participant.student_id && directClientChargeAmount !== null)
      ? { direct_client_charge_amount_override: directClientChargeAmount }
      : {},
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

    const allowedStatusUpdates = new Set(['completed']);
    const requestedStatus = normalizeLessonInstanceStatus(body.status);
    const hasOtherUpdates = [
      'datetime_start',
      'duration_minutes',
      'instructor_employee_id',
      'service_id',
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
  const normalizedStatus = normalizeLessonInstanceStatus(body.status);
  if (!ACTIVE_LESSON_INSTANCE_STATUSES.has(normalizedStatus)) {
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

  // Instructor rate pre-flight: block completion if no base_rate is configured.
  // Instance cancellation does not trigger instructor earnings; participant-level policies do.
  const EARNING_STATUSES = new Set(['completed']);
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

  if (body.closed_reason !== undefined) {
    return respond(context, 422, { message: 'instance_closed_reason_not_supported' });
  }

  // Build update object (only update provided fields)
  const updateData = {};
  
  if (body.datetime_start !== undefined) updateData.datetime_start = body.datetime_start;
  if (body.duration_minutes !== undefined) updateData.duration_minutes = body.duration_minutes;
  if (body.instructor_employee_id !== undefined) updateData.instructor_employee_id = body.instructor_employee_id;
  if (body.service_id !== undefined) updateData.service_id = body.service_id;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.documentation_status !== undefined) updateData.documentation_status = body.documentation_status;
  if (body.metadata !== undefined) updateData.metadata = targetMetadata;
  updateData.updated_by = userId;
  
  updateData.updated_at = new Date().toISOString();
  const requestedCancellation = normalizeLessonInstanceStatus(updateData.status) === 'cancelled';
  const hasNonCancellationFieldUpdates = requestedCancellation && (
    body.datetime_start !== undefined
    || body.duration_minutes !== undefined
    || body.instructor_employee_id !== undefined
    || body.service_id !== undefined
    || body.metadata !== undefined
  );

  if (hasNonCancellationFieldUpdates) {
    return respond(context, 422, { message: 'cancel_instance_requires_dedicated_action' });
  }

  let postUpdateState = null;
  let auditBeforeState = existingInstance;
  let cancelledParticipantIds = [];
  let cancelledParticipantAuditRows = [];
  let completedParticipantAuditRows = [];

  if (requestedCancellation) {
    try {
      const cancellationResult = await cancelLessonInstanceWithParticipants(tenantClient, {
        instanceId: body.id,
        userId,
        expectedVersion,
        instanceMetadata: null,
        documentationStatus: updateData.documentation_status,
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
          resourceId: body.id,
          expectedVersion,
          currentVersion: cancellationResult.instanceVersion,
        });
      }

      if (cancellationResult.outcome === 'not_found') {
        return respond(context, 404, { message: 'instance not found' });
      }

      if (cancellationResult.outcome === 'locked' || cancellationResult.outcome === 'closed') {
        const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(tenantClient, {
          instanceId: body.id,
        });
        if (refreshedError) {
          context.log?.error?.('calendar/instances failed to refresh locked cancellation state', {
            message: refreshedError.message,
            instanceId: body.id,
          });
          return respond(context, 500, { message: 'failed_to_cancel_instance' });
        }
        return respondWithLockedMutation(context, {
          instanceId: body.id,
          instanceLocks: refreshedState.instanceLocks,
          closed: refreshedState.instance?.is_closed || cancellationResult.outcome === 'closed',
        });
      }

      if (cancellationResult.outcome !== 'cancelled') {
        context.log?.error?.('calendar/instances received unexpected cancellation outcome', {
          outcome: cancellationResult.outcome,
          instanceId: body.id,
        });
        return respond(context, 500, { message: 'failed_to_cancel_instance' });
      }

      cancelledParticipantIds = cancellationResult.cancelledParticipantIds;
      cancelledParticipantAuditRows = normalizeParticipantAuditRows(cancellationResult.cancelledParticipantAuditRows);
      auditBeforeState = cancellationResult.instanceBeforeState
        ? normalizeLessonInstanceAuditState(cancellationResult.instanceBeforeState)
        : existingInstance;
      postUpdateState = cancellationResult.instanceAfterState
        ? normalizeLessonInstanceAuditState(cancellationResult.instanceAfterState)
        : {
            ...existingInstance,
            ...updateData,
            status: 'cancelled',
            documentation_status: updateData.documentation_status || existingInstance.documentation_status,
            metadata: cancellationResult.instanceMetadata,
            version: cancellationResult.instanceVersion ?? existingInstance.version,
          };
    } catch (cancellationError) {
      context.log?.error?.('calendar/instances failed to cancel lesson instance atomically', {
        message: cancellationError?.message,
        instanceId: body.id,
      });
      return respond(context, 500, { message: 'failed_to_cancel_instance' });
    }
  }

  // Attendance status still drives the lesson instance itself, but downstream billing,
  // instructor compensation, and closure are handled by the shared workflow syncs below.
  const requestedCompletion = normalizeLessonInstanceStatus(updateData.status) === 'completed';

  if (requestedCompletion) {
    try {
      const completionResult = await completeLessonInstanceWithParticipants(tenantClient, {
        instanceId: body.id,
        userId,
        expectedVersion,
        documentationStatus: updateData.documentation_status,
      });

      if (completionResult.outcome === 'version_conflict') {
        return respondWithVersionConflict(context, {
          resourceType: 'lesson_instance',
          resourceId: body.id,
          expectedVersion,
          currentVersion: completionResult.instanceVersion,
        });
      }

      if (completionResult.outcome === 'not_found') {
        return respond(context, 404, { message: 'instance not found' });
      }

      if (completionResult.outcome === 'locked' || completionResult.outcome === 'closed') {
        const { error: refreshedError, result: refreshedState } = await fetchLessonMutationState(tenantClient, {
          instanceId: body.id,
        });
        if (refreshedError) {
          context.log?.error?.('calendar/instances failed to refresh locked completion state', {
            message: refreshedError.message,
            instanceId: body.id,
          });
          return respond(context, 500, { message: 'failed_to_complete_instance' });
        }
        return respondWithLockedMutation(context, {
          instanceId: body.id,
          instanceLocks: refreshedState.instanceLocks,
          closed: refreshedState.instance?.is_closed || completionResult.outcome === 'closed',
        });
      }

      if (completionResult.outcome !== 'completed') {
        context.log?.error?.('calendar/instances received unexpected completion outcome', {
          outcome: completionResult.outcome,
          instanceId: body.id,
        });
        return respond(context, 500, { message: 'failed_to_complete_instance' });
      }

      completedParticipantAuditRows = normalizeParticipantAuditRows(completionResult.promotedParticipantAuditRows);
      auditBeforeState = completionResult.instanceBeforeState
        ? normalizeLessonInstanceAuditState(completionResult.instanceBeforeState)
        : existingInstance;
      postUpdateState = completionResult.instanceAfterState
        ? normalizeLessonInstanceAuditState(completionResult.instanceAfterState)
        : {
            ...existingInstance,
            ...updateData,
            status: 'completed',
            documentation_status: updateData.documentation_status || existingInstance.documentation_status,
            metadata: completionResult.instanceMetadata,
            version: completionResult.instanceVersion ?? existingInstance.version,
          };
    } catch (completionError) {
      context.log?.error?.('calendar/instances failed to complete lesson instance atomically', {
        message: completionError?.message,
        instanceId: body.id,
      });
      return respond(context, 500, { message: 'failed_to_complete_instance' });
    }
  }

  if (!requestedCancellation && !requestedCompletion) {
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

    const { data: updatedInstanceRow, error: updateError } = await updateQuery
      .select('id, version')
      .maybeSingle();

    if (updateError) {
      context.log?.error?.('calendar/instances failed to update instance', {
        message: updateError.message,
        code: updateError.code,
      });
      return respond(context, 500, { message: 'failed_to_update_instance' });
    }

    if (!updatedInstanceRow) {
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

    postUpdateState = {
      ...existingInstance,
      ...updateData,
      version: updatedInstanceRow?.version ?? existingInstance.version,
    };
  }

  const normalizedStatus = normalizeLessonInstanceStatus(updateData.status);
  const isCancellationUpdate = normalizedStatus === 'cancelled';
  const isCompletionUpdate = normalizedStatus === 'completed';

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
        previous_status: auditBeforeState?.status || existingInstance.status,
        updated_fields: Object.keys(updateData),
        datetime_start: updateData.datetime_start || null,
        duration_minutes: updateData.duration_minutes || null,
        instructor_employee_id: updateData.instructor_employee_id || null,
        service_id: updateData.service_id || null,
        status: updateData.status || null,
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
      beforeState: auditBeforeState,
      afterState: postUpdateState,
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

  if (isCancellationUpdate && cancelledParticipantIds.length > 0) {
    try {
      for (const row of cancelledParticipantAuditRows) {
        await logTenantAuditEvent(tenantClient, {
          actorUserId: userId,
          eventType: 'calendar.lesson_participant.cancelled_by_instance',
          retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
          resourceType: 'lesson_participant',
          resourceId: row.participant_id,
          beforeState: row.before_state || null,
          afterState: row.after_state || null,
          details: {
            origin: 'api/calendar',
            lesson_instance_id: body.id,
            cancellation_source: 'instance_cancelled',
          },
        });
      }
    } catch (participantAuditError) {
      context.log?.warn?.('calendar/instances failed to write participant cancellation audit events', {
        message: participantAuditError?.message,
        instanceId: body.id,
      });
    }
  }

  if (isCompletionUpdate && completedParticipantAuditRows.length > 0) {
    try {
      for (const row of completedParticipantAuditRows) {
        await logTenantAuditEvent(tenantClient, {
          actorUserId: userId,
          eventType: 'calendar.lesson_participant.attended_by_instance_completion',
          retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
          resourceType: 'lesson_participant',
          resourceId: row.participant_id,
          beforeState: row.before_state || null,
          afterState: row.after_state || null,
          details: {
            origin: 'api/calendar',
            lesson_instance_id: body.id,
            completion_source: 'instance_completed',
          },
        });
      }
    } catch (participantAuditError) {
      context.log?.warn?.('calendar/instances failed to write participant completion audit events', {
        message: participantAuditError?.message,
        instanceId: body.id,
      });
    }
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
