/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
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
 *   - student_ids (array, optional)
 *   - client_profile_ids (array, optional)
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
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('calendar/conflicts failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'calendar/conflicts' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
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

  return await handleConflictCheck(context, body, supabase, orgId);
}

async function handleConflictCheck(context, body, supabase, orgId) {
  // Validate required fields
  if (!body.datetime_start) {
    return respond(context, 400, { message: 'missing_datetime_start' });
  }
  if (!body.duration_minutes || body.duration_minutes <= 0) {
    return respond(context, 400, { message: 'missing_or_invalid_duration_minutes' });
  }
  if (!body.instructor_employee_id) {
    return respond(context, 400, { message: 'missing_instructor_employee_id' });
  }
  const studentIds = Array.isArray(body.student_ids) ? body.student_ids.filter(Boolean) : [];
  const clientProfileIds = Array.isArray(body.client_profile_ids || body.clientProfileIds)
    ? (body.client_profile_ids || body.clientProfileIds).filter(Boolean)
    : [];
  if (studentIds.length === 0 && clientProfileIds.length === 0) {
    return respond(context, 400, { message: 'missing_or_invalid_participants' });
  }

  const startTime = new Date(body.datetime_start);
  const endTime = new Date(startTime.getTime() + body.duration_minutes * 60000);
  
  // Fetch overlapping instances
  const { data: instances, error } = await withOrgScope(supabase, 'lesson_instances', orgId)
    .select(`
      id,
      datetime_start,
      duration_minutes,
      instructor_employee_id,
      service_id,
      status,
      lesson_participants (
        client_profile_id,
        student_id,
        student:students (
          client_profile_id,
          client_profile:client_profiles (
            first_name,
            middle_name,
            last_name
          )
        ),
        client_profile:client_profiles (
          first_name,
          middle_name,
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
    const instanceStudentIds = (instance.lesson_participants || []).map(p => p.student_id).filter(Boolean);
    const overlappingStudents = studentIds.filter(id => instanceStudentIds.includes(id));

    if (overlappingStudents.length > 0) {
      overlappingStudents.forEach(studentId => {
        const participant = instance.lesson_participants.find(p => p.student_id === studentId);
        const studentProfile = participant?.student?.client_profile || participant?.client_profile || null;
        const studentName = studentProfile
          ? [studentProfile.first_name, studentProfile.middle_name, studentProfile.last_name].filter(Boolean).join(' ').trim()
          : 'לא ידוע';

        conflicts.push({
          type: 'student_overlap',
          instance_id: instance.id,
          student_id: studentId,
          message: `${studentName || 'הלקוח/ה'} כבר משובץ/ת לשיעור אחר בזמן זה`,
          datetime_start: instance.datetime_start,
          duration_minutes: instance.duration_minutes,
        });
      });
    }

    const instanceClientProfileIds = (instance.lesson_participants || []).map(p => p.client_profile_id).filter(Boolean);
    const overlappingClientProfiles = clientProfileIds.filter(id => instanceClientProfileIds.includes(id));

    if (overlappingClientProfiles.length > 0) {
      overlappingClientProfiles.forEach(clientProfileId => {
        const participant = instance.lesson_participants.find(p => p.client_profile_id === clientProfileId);
        const clientProfile = participant?.client_profile || participant?.student?.client_profile || null;
        const clientName = clientProfile
          ? [clientProfile.first_name, clientProfile.middle_name, clientProfile.last_name].filter(Boolean).join(' ').trim()
          : 'לא ידוע';

        conflicts.push({
          type: 'client_profile_overlap',
          instance_id: instance.id,
          client_profile_id: clientProfileId,
          message: `${clientName || 'הלקוח/ה'} כבר משובץ/ת לשיעור אחר בזמן זה`,
          datetime_start: instance.datetime_start,
          duration_minutes: instance.duration_minutes,
        });
      });
    }
  });

  // Check capacity (if instructor_service_capabilities exists)
  if (body.service_id) {
    const { data: capability } = await withOrgScope(supabase, 'instructor_service_capabilities', orgId)
      .select('max_students')
      .eq('employee_id', body.instructor_employee_id)
      .eq('service_id', body.service_id)
      .single();

    const participantCount = studentIds.length + clientProfileIds.length;
    if (capability && capability.max_students && participantCount > capability.max_students) {
      conflicts.push({
        type: 'capacity_exceeded',
        message: `מספר המשתתפים (${participantCount}) עולה על הקיבולת המקסימלית (${capability.max_students})`,
        current_count: participantCount,
        max_capacity: capability.max_students,
      });
    }
  }

  return respond(context, 200, { conflicts, has_conflicts: conflicts.length > 0 });
}
