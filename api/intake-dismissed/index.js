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

function isSchemaError(error) {
  if (!error) {
    return false;
  }
  const code = error.code || error.details;
  if (code === '42703' || code === '42P01') {
    return true;
  }
  const message = String(error.message || error.details || '').toLowerCase();
  return message.includes('column') || message.includes('relation');
}

function buildSchemaResponse(error) {
  return {
    status: 424,
    body: {
      message: 'schema_upgrade_required',
      details: error?.message || 'missing_intake_columns',
      hint: 'Run the latest setup SQL to add intake_responses and needs_intake_approval.',
    },
  };
}

export default async function handler(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('intake-dismissed missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('intake-dismissed failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const orgId = resolveOrgId(req);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, authResult.data.user.id);
  } catch (membershipError) {
    context.log?.error?.('intake-dismissed failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: authResult.data.user.id,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const { data, error } = await tenantClient
    .from('Students')
    .select('*')
    .eq('metadata->intake_dismissal->>active', 'true')
    .order('name', { ascending: true });

  if (error) {
    if (isSchemaError(error)) {
      const schemaResponse = buildSchemaResponse(error);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('intake-dismissed failed to fetch students', { message: error.message });
    return respond(context, 500, { message: 'failed_to_load_dismissed_intakes' });
  }

  return respond(context, 200, Array.isArray(data) ? data : []);
}
