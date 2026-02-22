/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';

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

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function getLessonInstanceId(context, req, body) {
  const candidate =
    normalizeString(context?.bindingData?.lessonInstanceId) ||
    normalizeString(body?.lesson_instance_id) ||
    normalizeString(body?.lessonInstanceId) ||
    normalizeString(body?.id);

  if (candidate && UUID_PATTERN.test(candidate)) {
    return candidate;
  }

  return '';
}

function buildInstanceSelect() {
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
    'metadata',
    'instructor:Employees(id, name)',
    'service:Services(id, name, color, duration_minutes)',
    'participants:lesson_participants(id, student_id, participant_status, reminder_sent, reminder_seen, documented_at, attendance_confirmed_at, student:students(id, first_name, middle_name, last_name))',
  ].join(',');
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

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    const date = normalizeString(req?.query?.date || body?.date);
    if (!date || !isIsoDate(date)) {
      return respond(context, 400, { message: 'invalid_date' });
    }

    const range = buildUtcRange(date);
    if (!range) {
      return respond(context, 400, { message: 'invalid_date' });
    }

    const requestedInstructorId = normalizeUuid(req?.query?.instructor_id || req?.query?.instructorId);

    let builder = tenantClient
      .from('lesson_instances')
      .select(buildInstanceSelect())
      .gte('datetime_start', range.start)
      .lt('datetime_start', range.end)
      .order('datetime_start', { ascending: true });

    if (!isAdmin) {
      builder = builder.eq('instructor_employee_id', userId);
    } else if (requestedInstructorId) {
      builder = builder.eq('instructor_employee_id', requestedInstructorId);
    }

    const { data, error } = await builder;
    if (error) {
      context.log?.error?.('lesson-instances failed to fetch schedule', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_lesson_instances' });
    }

    return respond(context, 200, Array.isArray(data) ? data : []);
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

    if (normalizedStudentIds.length === 0) {
      return respond(context, 400, { message: 'missing_student_ids' });
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
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (instanceError || !instanceRow?.id) {
      context.log?.error?.('lesson-instances failed to create instance', { message: instanceError?.message });
      return respond(context, 500, { message: 'failed_to_create_lesson_instance' });
    }

    const participantsPayload = normalizedStudentIds.map((studentId) => ({
      lesson_instance_id: instanceRow.id,
      student_id: studentId,
      participant_status: 'scheduled',
    }));

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

    return respond(context, 200, data);
  }

  if (method === 'PUT') {
    const lessonInstanceId = getLessonInstanceId(context, req, body);
    if (!lessonInstanceId) {
      return respond(context, 400, { message: 'missing_lesson_instance_id' });
    }

    const nextStatus = normalizeString(body?.status);
    const nextDocumentationStatus = normalizeString(body?.documentation_status || body?.documentationStatus);

    if (!nextStatus && !nextDocumentationStatus) {
      return respond(context, 400, { message: 'no_updates_provided' });
    }

    const allowedStatus = new Set(['scheduled', 'completed', 'cancelled_student', 'cancelled_clinic', 'no_show']);
    const allowedDocumentation = new Set(['undocumented', 'documented']);

    const updates = { updated_at: new Date().toISOString() };

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
      const { data: existing, error: existingError } = await tenantClient
        .from('lesson_instances')
        .select('id, instructor_employee_id')
        .eq('id', lessonInstanceId)
        .maybeSingle();

      if (existingError) {
        context.log?.error?.('lesson-instances failed to load instance for permission check', { message: existingError.message });
        return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
      }

      if (!existing) {
        return respond(context, 404, { message: 'lesson_instance_not_found' });
      }

      if (existing.instructor_employee_id !== userId) {
        return respond(context, 403, { message: 'forbidden' });
      }
    }

    const { error: updateError } = await tenantClient
      .from('lesson_instances')
      .update(updates)
      .eq('id', lessonInstanceId);

    if (updateError) {
      context.log?.error?.('lesson-instances failed to update instance', { message: updateError.message });
      return respond(context, 500, { message: 'failed_to_update_lesson_instance' });
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

    return respond(context, 200, data);
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
