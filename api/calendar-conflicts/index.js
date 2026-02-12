/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * POST /api/calendar/conflicts/check
 * Body:
 *   - org_id (required)
 *   - datetime_start (required)
 *   - duration_minutes (required)
 *   - instructor_employee_id (required)
 *   - student_ids (array, required)
 *   - exclude_instance_id (UUID, optional, for edits)
 *
 * Returns: Array of conflicts with type and details
 */
export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('calendar/conflicts missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('calendar/conflicts missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('calendar/conflicts failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'calendar/conflicts' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('calendar/conflicts failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  return await handleConflictCheck(context, body, tenantClient);
}

async function handleConflictCheck(context, body, tenantClient) {
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
  if (!body.student_ids || !Array.isArray(body.student_ids)) {
    return respond(context, 400, { message: 'missing or invalid student_ids array' });
  }

  const startTime = new Date(body.datetime_start);
  const endTime = new Date(startTime.getTime() + body.duration_minutes * 60000);
  
  // Fetch overlapping instances
  const { data: instances, error } = await tenantClient
    .from('lesson_instances')
    .select(`
      id,
      datetime_start,
      duration_minutes,
      instructor_employee_id,
      service_id,
      status,
      lesson_participants (
        student_id,
        students (
          first_name,
          last_name
        )
      ),
      Employees (
        first_name,
        last_name
      )
    `)
    .gte('datetime_start', new Date(startTime.getTime() - 24 * 60 * 60 * 1000).toISOString()) // 24 hours before
    .lte('datetime_start', new Date(endTime.getTime() + 24 * 60 * 60 * 1000).toISOString()); // 24 hours after

  if (error) {
    context.log?.error?.('calendar/conflicts failed to fetch instances', { message: error.message });
    return respond(context, 500, { message: 'failed_to_check_conflicts' });
  }

  const conflicts = [];

  (instances || []).forEach(instance => {
    // Skip the instance being edited
    if (body.exclude_instance_id && instance.id === body.exclude_instance_id) {
      return;
    }

    // Skip cancelled instances
    if (instance.status && instance.status.startsWith('cancelled')) {
      return;
    }

    const instanceStart = new Date(instance.datetime_start);
    const instanceEnd = new Date(instanceStart.getTime() + instance.duration_minutes * 60000);

    // Check time overlap
    const hasTimeOverlap = startTime < instanceEnd && endTime > instanceStart;
    if (!hasTimeOverlap) {
      return;
    }

    // Check instructor overlap
    if (instance.instructor_employee_id === body.instructor_employee_id) {
      const instructorName = instance.Employees 
        ? `${instance.Employees.first_name} ${instance.Employees.last_name}`
        : 'לא ידוע';
      
      conflicts.push({
        type: 'instructor_overlap',
        instance_id: instance.id,
        message: `המדריך ${instructorName} כבר משובץ לשיעור אחר בזמן זה`,
        datetime_start: instance.datetime_start,
        duration_minutes: instance.duration_minutes,
      });
    }

    // Check student overlap
    const instanceStudentIds = (instance.lesson_participants || []).map(p => p.student_id);
    const overlappingStudents = body.student_ids.filter(id => instanceStudentIds.includes(id));

    if (overlappingStudents.length > 0) {
      overlappingStudents.forEach(studentId => {
        const participant = instance.lesson_participants.find(p => p.student_id === studentId);
        const studentName = participant?.students
          ? `${participant.students.first_name} ${participant.students.last_name}`
          : 'לא ידוע';

        conflicts.push({
          type: 'student_overlap',
          instance_id: instance.id,
          student_id: studentId,
          message: `התלמיד ${studentName} כבר משובץ לשיעור אחר בזמן זה`,
          datetime_start: instance.datetime_start,
          duration_minutes: instance.duration_minutes,
        });
      });
    }
  });

  // Check capacity (if instructor_service_capabilities exists)
  if (body.service_id) {
    const { data: capability } = await tenantClient
      .from('instructor_service_capabilities')
      .select('max_students')
      .eq('employee_id', body.instructor_employee_id)
      .eq('service_id', body.service_id)
      .single();

    if (capability && capability.max_students && body.student_ids.length > capability.max_students) {
      conflicts.push({
        type: 'capacity_exceeded',
        message: `מספר התלמידים (${body.student_ids.length}) עולה על הקיבולת המקסימלית (${capability.max_students})`,
        current_count: body.student_ids.length,
        max_capacity: capability.max_students,
      });
    }
  }

  return respond(context, 200, { conflicts, has_conflicts: conflicts.length > 0 });
}
