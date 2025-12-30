/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
  UUID_PATTERN,
} from '../_shared/org-bff.js';

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('students-check-id missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('students-check-id missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-check-id failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(null);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-check-id failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'not_a_member' });
  }

  // All org members can check for duplicate national IDs to prevent data quality issues
  // Non-admin members cannot create students, so this is a read-only validation check

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const nationalId = normalizeString(req?.query?.national_id || req?.query?.nationalId || '');
  context.log?.info?.('[students-check-id] Request received', {
    nationalId,
    hasNationalId: !!nationalId,
    orgId,
    userId,
  });

  if (!nationalId) {
    context.log?.info?.('[students-check-id] Empty national ID, returning exists=false');
    return respond(context, 200, { exists: false });
  }

  const excludeIdRaw = normalizeString(req?.query?.exclude_id || req?.query?.excludeId || '');
  const excludeId = excludeIdRaw && UUID_PATTERN.test(excludeIdRaw) ? excludeIdRaw : '';

  context.log?.info?.('[students-check-id] Query params', {
    nationalId,
    excludeId: excludeId || 'none',
    hasExcludeId: !!excludeId,
  });

  let query = tenantClient
    .from('Students')
    .select('id, name, national_id, is_active')
    .eq('national_id', nationalId)
    .limit(1);

  if (excludeId) {
    query = query.neq('id', excludeId);
    context.log?.info?.('[students-check-id] Excluding student ID from search', { excludeId });
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    context.log?.error?.('[students-check-id] Database query failed', {
      message: error.message,
      code: error.code,
      details: error.details,
      orgId,
      nationalId,
    });
    return respond(context, 500, { message: 'failed_to_validate_national_id' });
  }

  if (!data) {
    context.log?.info?.('[students-check-id] No duplicate found', {
      nationalId,
      excludeId: excludeId || 'none',
      result: 'exists=false',
    });
    return respond(context, 200, { exists: false });
  }

  context.log?.info?.('[students-check-id] Duplicate found', {
    nationalId,
    excludeId: excludeId || 'none',
    duplicateStudent: {
      id: data.id,
      name: data.name,
      is_active: data.is_active,
    },
    result: 'exists=true',
  });

  return respond(context, 200, { exists: true, student: data });
}
