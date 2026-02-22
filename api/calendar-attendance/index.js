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

const MAX_BODY_BYTES = 64 * 1024;

/**
 * POST /api/calendar/attendance
 * Body:
 *   - org_id (required)
 *   - instance_id (UUID, required)
 *   - participant_id (UUID, required)
 *   - attended (boolean, required)
 *
 * Updates participant status and instance status based on attendance
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

async function handleMarkAttendance(context, body, tenantClient, userId, isAdmin) {
  // Validate required fields
  if (!body.instance_id) {
    return respond(context, 400, { message: 'missing instance_id' });
  }
  if (!body.participant_id) {
    return respond(context, 400, { message: 'missing participant_id' });
  }
  if (typeof body.attended !== 'boolean') {
    return respond(context, 400, { message: 'missing or invalid attended field (must be boolean)' });
  }

  // Fetch instance to verify permissions
  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .select('id, instructor_employee_id, status')
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

  // Update participant status
  const participantStatus = body.attended ? 'attended' : 'no_show';
  
  const { error: updateError } = await tenantClient
    .from('lesson_participants')
    .update({ 
      participant_status: participantStatus,
    })
    .eq('id', body.participant_id);

  if (updateError) {
    context.log?.error?.('calendar/attendance failed to update participant', { 
      message: updateError.message,
    });
    return respond(context, 500, { message: 'failed_to_update_attendance' });
  }

  // Check if all participants have been marked
  const { data: allParticipants, error: fetchError } = await tenantClient
    .from('lesson_participants')
    .select('participant_status')
    .eq('lesson_instance_id', body.instance_id);

  if (fetchError) {
    context.log?.error?.('calendar/attendance failed to fetch participants', { message: fetchError.message });
    // Don't fail the request, just log the error
  } else if (allParticipants) {
    const allMarked = allParticipants.every(
      p => p.participant_status === 'attended' || p.participant_status === 'no_show'
    );

    // Update instance status if all participants are marked
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

  return respond(context, 200, { message: 'attendance marked successfully' });
}
