/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
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

const MAX_BODY_BYTES = 128 * 1024;
const INSTANCE_STATUSES = new Set(['scheduled', 'completed', 'cancelled_student', 'cancelled_clinic', 'no_show']);

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
  const startDateParam = normalizeString(queryParams.start_date);
  const endDateParam = normalizeString(queryParams.end_date);
  const instructorIdParam = normalizeString(queryParams.instructor_id);
  const studentIdParam = normalizeString(queryParams.student_id);

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
  const participantsJoin = studentIdParam ? 'lesson_participants!inner' : 'lesson_participants';

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
      created_source,
      metadata,
      created_at,
      updated_at,
      participants:${participantsJoin}(
        id,
        student_id,
        participant_status,
        price_charged,
        pricing_breakdown,
        commitment_id,
        documentation_ref,
        reminder_sent,
        reminder_seen,
        attendance_confirmed_at,
        documented_at,
        student:students(
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

  // Non-admin/office users: filter by their instructor record
  if (!canManageAll) {
    // Find instructor record for this user
    const { data: instructors, error: instructorError } = await tenantClient
      .from('Employees')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if (instructorError) {
      context.log?.error?.('calendar/instances failed to find instructor', { message: instructorError.message });
      return respond(context, 500, { message: 'failed_to_load_instructor' });
    }

    if (!instructors || instructors.length === 0) {
      // User is not an instructor, return empty array
      return respond(context, 200, []);
    }

    instancesQuery = instancesQuery.eq('instructor_employee_id', instructors[0].id);
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

  const studentIds = Array.from(new Set(
    (instances || []).flatMap((instance) => (
      Array.isArray(instance.participants)
        ? instance.participants.map((participant) => participant?.student_id).filter(Boolean)
        : []
    )),
  ));

  const primaryGuardianLinkByStudent = new Map();
  if (studentIds.length > 0) {
    const { data: studentGuardianLinks, error: linksError } = await tenantClient
      .from('student_guardians')
      .select('student_id, guardian_id, relationship, is_primary, created_at')
      .in('student_id', studentIds)
      .order('student_id', { ascending: true })
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (linksError) {
      context.log?.warn?.('calendar/instances failed to fetch student_guardians links', {
        message: linksError.message,
      });
    } else {
      for (const link of studentGuardianLinks || []) {
        if (!link?.student_id || !link?.guardian_id) continue;
        if (!primaryGuardianLinkByStudent.has(link.student_id)) {
          primaryGuardianLinkByStudent.set(link.student_id, link);
        }
      }
    }
  }

  const guardianIds = Array.from(new Set(
    Array.from(primaryGuardianLinkByStudent.values()).map((link) => link.guardian_id).filter(Boolean),
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
          student_id: p.student_id,
          participant_status: p.participant_status,
          price_charged: p.price_charged,
          pricing_breakdown: p.pricing_breakdown,
          commitment_id: p.commitment_id,
          documentation_ref: p.documentation_ref,
          reminder_sent: p.reminder_sent,
          reminder_seen: p.reminder_seen,
          attendance_confirmed_at: p.attendance_confirmed_at,
          documented_at: p.documented_at,
          student: p.student ? {
            id: p.student.id,
            first_name: p.student.first_name,
            middle_name: p.student.middle_name,
            last_name: p.student.last_name,
            full_name: [p.student.first_name, p.student.middle_name, p.student.last_name]
              .filter(Boolean)
              .join(' '),
            phone: p.student.phone ?? null,
            email: p.student.email ?? null,
            default_notification_method: p.student.default_notification_method ?? 'whatsapp',
            primary_guardian: (() => {
              const link = primaryGuardianLinkByStudent.get(p.student_id);
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

  return respond(context, 200, transformedInstances);
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
  if (!body.student_ids || !Array.isArray(body.student_ids) || body.student_ids.length === 0) {
    return respond(context, 400, { message: 'missing or invalid student_ids array' });
  }

  const requestedStatus = typeof body.status === 'string' ? body.status.trim().toLowerCase() : 'scheduled';
  if (!INSTANCE_STATUSES.has(requestedStatus)) {
    return respond(context, 400, { message: 'invalid status' });
  }

  // Non-admin users can only create lessons for themselves
  if (!isAdmin) {
    const { data: instructors } = await tenantClient
      .from('Employees')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    
    if (!instructors || instructors.length === 0 || instructors[0].id !== body.instructor_employee_id) {
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
    metadata: body.metadata || {},
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
  const participantData = body.student_ids.map(studentId => ({
    lesson_instance_id: instance.id,
    student_id: studentId,
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
        student_ids: body.student_ids,
        created_source: instance.created_source,
      },
    });
  } catch (auditError) {
    context.log?.error?.('calendar/instances failed to write audit event (create)', {
      message: auditError?.message,
      instanceId: instance?.id,
    });
  }

  try {
    await syncLessonBillingArtifacts(tenantClient, instance.id, userId);
    await syncLessonInstructorEarnings(tenantClient, instance.id, userId);
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

  // Fetch existing instance
  const { data: existingInstance, error: fetchError } = await tenantClient
    .from('lesson_instances')
    .select('id, instructor_employee_id, service_id, datetime_start, status, closed_reason')
    .eq('id', body.id)
    .single();

  if (fetchError || !existingInstance) {
    return respond(context, 404, { message: 'instance not found' });
  }

  // Instructors (non-admin/office) can only update their own lessons
  if (!canManageAll) {
    const { data: instructors } = await tenantClient
      .from('Employees')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if (!instructors || instructors.length === 0 || instructors[0].id !== existingInstance.instructor_employee_id) {
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
  if (targetInstructorId && targetDate) {
    const leaveConflict = await assertNoLeaveForLesson(tenantClient, {
      employeeId: targetInstructorId,
      date: targetDate,
    });

    if (leaveConflict) {
      return respond(context, 409, leaveConflict);
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
  if (body.metadata !== undefined) updateData.metadata = body.metadata;
  
  updateData.updated_at = new Date().toISOString();

  if ((updateData.status === 'cancelled_student' || updateData.status === 'cancelled_clinic' || updateData.status === 'no_show') &&
      updateData.closed_reason === undefined &&
      existingInstance.closed_reason) {
    updateData.closed_reason = existingInstance.closed_reason;
  }

  // Billing policy will hang off these statuses later:
  // - cancelled_clinic: never charge
  // - no_show: charge by default, with explicit override support
  // - cancelled_student: charge only after grace-threshold logic + approval flow
  // The current schema can represent the status and closed_reason, but not the eventual
  // financial decision trail yet. That should be modeled in the future billing layer.

  // Update instance
  const { error: updateError } = await tenantClient
    .from('lesson_instances')
    .update(updateData)
    .eq('id', body.id);

  if (updateError) {
    context.log?.error?.('calendar/instances failed to update instance', { 
      message: updateError.message,
      code: updateError.code,
    });
    return respond(context, 500, { message: 'failed_to_update_instance' });
  }

  const normalizedStatus = typeof updateData.status === 'string' ? updateData.status.trim().toLowerCase() : '';
  const isCancellationUpdate = normalizedStatus.startsWith('cancelled');

  // When the lesson is marked completed, promote any still-scheduled participants to
  // 'attended' so that the billing sync can process them (billing gates on participant status).
  if (normalizedStatus === 'completed') {
    const { error: promoteError } = await tenantClient
      .from('lesson_participants')
      .update({ participant_status: 'attended' })
      .eq('lesson_instance_id', body.id)
      .eq('participant_status', 'scheduled');

    if (promoteError) {
      context.log?.error?.('calendar/instances failed to promote scheduled participants to attended', {
        message: promoteError.message,
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
      },
    });
  } catch (auditError) {
    context.log?.error?.('calendar/instances failed to write audit event (update)', {
      message: auditError?.message,
      instanceId: body?.id,
    });
  }

  let billingWarnings = [];
  try {
    const billingResult = await syncLessonBillingArtifacts(tenantClient, body.id, userId);
    await syncLessonInstructorEarnings(tenantClient, body.id, userId);
    await syncInstructorAttendanceFromLessons(tenantClient, body.id, userId);
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
