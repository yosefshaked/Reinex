/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';

function buildEmployeeName(row) {
  return [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ').trim();
}

function isMemberRole(role) {
  const normalized = normalizeString(role).toLowerCase();
  return normalized === 'member';
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('session-records missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('session-records missing bearer token');
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('session-records failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(null); // GET carries params only
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('session-records failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const studentId = normalizeString(req?.query?.student_id || req?.query?.studentId);
  if (!studentId || !UUID_PATTERN.test(studentId)) {
    return respond(context, 400, { message: 'invalid_student_id' });
  }

  // For members, verify the student is assigned to them
  if (isMemberRole(role)) {
    const assignCheck = await withOrgScope(supabase, 'Students', orgId)
      .select('assigned_instructor_id')
      .eq('id', studentId)
      .maybeSingle();

    if (assignCheck.error) {
      context.log?.error?.('session-records failed to load student', { message: assignCheck.error.message });
      return respond(context, 500, { message: 'failed_to_load_student' });
    }

    const assigned = normalizeString(assignCheck.data?.assigned_instructor_id) || '';
    if (!assigned || assigned !== normalizeString(userId)) {
      return respond(context, 403, { message: 'student_not_assigned_to_user' });
    }
  }

  const { data, error } = await withOrgScope(supabase, 'SessionRecords', orgId)
    .select('*')
    .eq('student_id', studentId)
    .order('date', { ascending: false });

  if (error) {
    context.log?.error?.('session-records failed to fetch sessions', { message: error.message });
    return respond(context, 500, { message: 'failed_to_load_sessions' });
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    // 404 to match current UI contract where 404 is treated as "no sessions recorded"
    return respond(context, 404, { message: 'no_sessions' });
  }

  const instructorIds = Array.from(new Set(rows.map((row) => row?.instructor_id).filter(Boolean)));
  let instructorMap = new Map();

  if (instructorIds.length > 0) {
    const { data: instructorRows, error: instructorError } = await withOrgScope(supabase, 'Employees', orgId)
      .select('id, first_name, middle_name, last_name, email')
      .in('id', instructorIds);

    if (instructorError) {
      context.log?.error?.('session-records failed to load instructors', { message: instructorError.message });
      return respond(context, 500, { message: 'failed_to_load_instructors' });
    }

    instructorMap = new Map((instructorRows || []).map((row) => [row.id, {
      id: row.id,
      name: buildEmployeeName(row) || null,
      email: row.email || null,
    }]));
  }

  return respond(context, 200, rows.map((row) => ({
    ...row,
    Instructors: instructorMap.get(row.instructor_id) || null,
  })));
}
