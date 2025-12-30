/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantPublicClient,
  parseRequestBody,
} from '../_shared/org-bff.js';

async function handleGet(context, tenantClient, req) {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return respond(context, 400, { error: 'missing_date_range' });
  }

  const { data, error } = await tenantClient
    .from('lesson_instances')
    .select(`
      *,
      lesson_participants (*)
    `)
    .gte('datetime_start', startDate)
    .lte('datetime_start', endDate)
    .order('datetime_start');

  if (error) {
    context.log.error('Failed to fetch lesson instances', error);
    return respond(context, 500, { error: 'database_error' });
  }

  return respond(context, 200, { data });
}

async function handlePost(context, tenantClient, req) {
  const body = parseRequestBody(req);
  const { participants, ...instanceData } = body;

  if (!instanceData.datetime_start || !instanceData.instructor_employee_id || !instanceData.service_id) {
    return respond(context, 400, { error: 'missing_required_fields' });
  }

  // Insert instance
  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .insert(instanceData)
    .select()
    .single();

  if (instanceError) {
    context.log.error('Failed to create lesson instance', instanceError);
    return respond(context, 500, { error: 'database_error_instance' });
  }

  // Insert participants if any
  if (participants && Array.isArray(participants) && participants.length > 0) {
    const participantsData = participants.map(p => ({
      ...p,
      lesson_instance_id: instance.id
    }));

    const { error: participantsError } = await tenantClient
      .from('lesson_participants')
      .insert(participantsData);

    if (participantsError) {
      context.log.error('Failed to create lesson participants', participantsError);
      // Note: In a real production scenario, we might want to rollback the instance creation here
      // or use a stored procedure for atomicity.
      return respond(context, 500, { error: 'database_error_participants', instanceId: instance.id });
    }
  }

  // Fetch complete object to return
  const { data: result, error: fetchError } = await tenantClient
    .from('lesson_instances')
    .select(`
      *,
      lesson_participants (*)
    `)
    .eq('id', instance.id)
    .single();

  if (fetchError) {
     return respond(context, 200, { data: instance, warning: 'failed_to_fetch_complete_object' });
  }

  return respond(context, 201, { data: result });
}

async function handlePut(context, tenantClient, req) {
  const body = parseRequestBody(req);
  const { id, ...updates } = body;

  if (!id) {
    return respond(context, 400, { error: 'missing_id' });
  }

  const { data, error } = await tenantClient
    .from('lesson_instances')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    context.log.error('Failed to update lesson instance', error);
    return respond(context, 500, { error: 'database_error' });
  }

  return respond(context, 200, { data });
}

export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  const supabase = createSupabaseAdminClient(adminConfig);

  const authorization = resolveBearerAuthorization(req);
  const orgId = resolveOrgId(req);

  if (!authorization?.token) {
    return respond(context, 401, { error: 'missing_auth' });
  }

  if (!orgId) {
    return respond(context, 400, { error: 'missing_org_id' });
  }

  const membership = await ensureMembership(supabase, authorization.token, orgId);
  if (!membership) {
    return respond(context, 403, { error: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantPublicClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  switch (req.method.toLowerCase()) {
    case 'get':
      return handleGet(context, tenantClient, req);
    case 'post':
      return handlePost(context, tenantClient, req);
    case 'put':
      return handlePut(context, tenantClient, req);
    default:
      return respond(context, 405, { error: 'method_not_allowed' });
  }
}
