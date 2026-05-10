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
  withOrgScope,
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
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-check-id failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(null);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
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

  const identityNumber = normalizeString(
    req?.query?.identity_number || req?.query?.identityNumber || req?.query?.national_id || req?.query?.nationalId || '',
  );
  context.log?.info?.('[students-check-id] Request received', {
    identityNumber,
    hasIdentityNumber: !!identityNumber,
    orgId,
    userId,
  });

  if (!identityNumber) {
    context.log?.info?.('[students-check-id] Empty identity number, returning exists=false');
    return respond(context, 200, { exists: false });
  }

  const excludeIdRaw = normalizeString(req?.query?.exclude_id || req?.query?.excludeId || '');
  const excludeId = excludeIdRaw && UUID_PATTERN.test(excludeIdRaw) ? excludeIdRaw : '';

  context.log?.info?.('[students-check-id] Query params', {
    identityNumber,
    excludeId: excludeId || 'none',
    hasExcludeId: !!excludeId,
  });

  let profileQuery = withOrgScope(supabase, 'client_profiles', orgId)
    .select('id, first_name, last_name, identity_number, is_active')
    .eq('identity_number', identityNumber)
    .limit(1);

  if (excludeId) {
    const { data: excludedStudent, error: excludedStudentError } = await withOrgScope(supabase, 'students', orgId)
      .select('id, client_profile_id')
      .eq('id', excludeId)
      .maybeSingle();

    if (excludedStudentError) {
      context.log?.error?.('[students-check-id] Failed to resolve excluded student profile', {
        message: excludedStudentError.message,
        excludeId,
      });
      return respond(context, 500, { message: 'failed_to_validate_identity_number' });
    }

    if (excludedStudent?.client_profile_id) {
      profileQuery = profileQuery.neq('id', excludedStudent.client_profile_id);
    }
    context.log?.info?.('[students-check-id] Excluding student ID from search', { excludeId });
  }

  const { data: profile, error } = await profileQuery.maybeSingle();

  if (error) {
    context.log?.error?.('[students-check-id] Database query failed', {
      message: error.message,
      code: error.code,
      details: error.details,
      orgId,
      identityNumber,
    });
    return respond(context, 500, { message: 'failed_to_validate_identity_number' });
  }

  if (!profile) {
    context.log?.info?.('[students-check-id] No duplicate found', {
      identityNumber,
      excludeId: excludeId || 'none',
      result: 'exists=false',
    });
    return respond(context, 200, { exists: false });
  }

  const { data: student, error: studentError } = await withOrgScope(supabase, 'students', orgId)
    .select('id, client_profile_id')
    .eq('client_profile_id', profile.id)
    .maybeSingle();

  if (studentError) {
    context.log?.error?.('[students-check-id] Failed to resolve student by client profile', {
      message: studentError.message,
      clientProfileId: profile.id,
    });
    return respond(context, 500, { message: 'failed_to_validate_identity_number' });
  }

  context.log?.info?.('[students-check-id] Duplicate found', {
    identityNumber,
    excludeId: excludeId || 'none',
    duplicateStudent: {
      id: student?.id || null,
      first_name: profile.first_name,
      last_name: profile.last_name,
      is_active: profile.is_active,
    },
    result: 'exists=true',
  });

  return respond(context, 200, {
    exists: true,
    student: {
      id: student?.id || null,
      client_profile_id: profile.id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      identity_number: profile.identity_number,
      is_active: profile.is_active,
    },
  });
}
