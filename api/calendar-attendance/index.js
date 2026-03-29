/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
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

async function handleUpdateReminder(context, body, tenantClient) {
  if (!body.instance_id) {
    return respond(context, 400, { message: 'missing instance_id' });
  }
  if (!body.participant_id) {
    return respond(context, 400, { message: 'missing participant_id' });
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

  const { error } = await tenantClient
    .from('lesson_participants')
    .update(update)
    .eq('id', body.participant_id)
    .eq('lesson_instance_id', body.instance_id);

  if (error) {
    context.log?.error?.('calendar/attendance update-reminder failed', { message: error.message });
    return respond(context, 500, { message: 'failed_to_update_reminder' });
  }

  return respond(context, 200, { message: 'reminder updated' });
}

async function handleMarkAttendance(context, body, tenantClient, userId, isAdmin) {
  if (body.action === 'update-reminder') {
    return handleUpdateReminder(context, body, tenantClient);
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

  if (!hasAttendedFlag && !hasParticipantStatus) {
    return respond(context, 400, {
      message: 'missing update payload (expected attended or participant_status)',
    });
  }

  // Fetch instance to verify permissions
  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .select('id, instructor_employee_id, service_id, status')
    .eq('id', body.instance_id)
    .single();

  if (instanceError || !instance) {
    return respond(context, 404, { message: 'instance not found' });
  }

  // Non-admin users can only mark attendance for their own lessons
  if (!isAdmin) {
    const { data: instructors } = await tenantClient
      .from('Employees')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    
    if (!instructors || instructors.length === 0 || instructors[0].id !== instance.instructor_employee_id) {
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

  const { error: updateError } = await tenantClient
    .from('lesson_participants')
    .update(participantUpdate)
    .eq('id', body.participant_id)
    .eq('lesson_instance_id', body.instance_id);

  if (updateError) {
    context.log?.error?.('calendar/attendance failed to update participant', { 
      message: updateError.message,
    });
    return respond(context, 500, { message: 'failed_to_update_attendance' });
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
        await tenantClient
          .from('lesson_instances')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.instance_id);
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

  return respond(context, 200, {
    message: 'participant updated successfully',
    ...(billingWarnings.length > 0 ? { billing_warnings: billingWarnings } : {}),
  });
}
