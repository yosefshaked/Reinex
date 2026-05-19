/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  fetchMatchingStudentClientProfileIds,
  filterStudentsBySearchTerms,
  parseStudentSearchQuery,
} from '../_shared/student-search.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { fetchStudentIdsByInstructor } from '../_shared/instructor-student-scope.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';

function respondStudentsSearchError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, {
    error,
    metadata,
  });
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('students-search missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('students-search missing bearer token');
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-search failed to validate token', { message: error?.message });
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

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'students-search' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-search failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respondStudentsSearchError(context, 500, 'failed_to_verify_membership', membershipError, {
      action: 'verify_membership',
    });
  }

  if (!role) {
    context.log?.error?.('students-search failed to verify membership', {
      message: 'no_membership_role_found',
      orgId,
      userId,
    });
    return respond(context, 403, { message: 'forbidden' });
  }

  const query = normalizeString(req?.query?.query || req?.query?.q || '');
  if (!query || query.length < 2) {
    return respond(context, 200, []);
  }
  const searchSpec = parseStudentSearchQuery(query);

  // Build query with role-based filtering
  let builder = withOrgScope(supabase, 'students', orgId)
    .select(`
      id,
      client_profile_id,
      client_profile:client_profiles(
        id,
        first_name,
        middle_name,
        last_name,
        identity_number,
        phone,
        email,
        is_active
      )
    `);

  // Member instructors can only see students from their active templates.
  if (!isAdminRole(role)) {
    const { studentIds, error: lessonError } = await fetchStudentIdsByInstructor(supabase, userId);
    if (lessonError) {
      context.log?.error?.('students-search failed to fetch instructor lesson templates', {
        message: lessonError.message,
        orgId,
        userId,
      });
      return respondStudentsSearchError(context, 500, 'failed_to_search_students', lessonError, {
        action: 'load_instructor_student_ids',
      });
    }

    if (!studentIds.length) {
      return respond(context, 200, []);
    }

    builder = builder.in('id', studentIds);
  }

  const { ids: matchingClientProfileIds, error: profileSearchError } = await fetchMatchingStudentClientProfileIds(
    supabase,
    searchSpec,
    { limit: 250 },
  );

  if (profileSearchError) {
    context.log?.error?.('students-search failed to query client profiles', { message: profileSearchError.message, orgId });
    return respondStudentsSearchError(context, 500, 'failed_to_search_students', profileSearchError, {
      action: 'search_client_profiles',
      query_length: query.length,
    });
  }

  if (!matchingClientProfileIds.length) {
    return respond(context, 200, []);
  }

  builder = builder.in('client_profile_id', matchingClientProfileIds).limit(25);

  const { data, error } = await builder;

  if (error) {
    context.log?.error?.('students-search failed to query roster', { message: error.message, orgId });
    return respondStudentsSearchError(context, 500, 'failed_to_search_students', error, {
      action: 'load_search_roster',
      matching_client_profile_count: matchingClientProfileIds.length,
    });
  }

  const results = (Array.isArray(data) ? data : []).map((row) => ({
    id: row.id,
    client_profile_id: row.client_profile_id,
    first_name: row.client_profile?.first_name || '',
    middle_name: row.client_profile?.middle_name || null,
    last_name: row.client_profile?.last_name || '',
    identity_number: row.client_profile?.identity_number || null,
    phone: row.client_profile?.phone || null,
    email: row.client_profile?.email || null,
    is_active: row.client_profile?.is_active !== false,
    client_profile: row.client_profile || null,
  }));
  const filteredResults = filterStudentsBySearchTerms(results, searchSpec)
    .sort((left, right) => {
      const leftName = [left?.first_name, left?.middle_name, left?.last_name].filter(Boolean).join(' ');
      const rightName = [right?.first_name, right?.middle_name, right?.last_name].filter(Boolean).join(' ');
      return leftName.localeCompare(rightName, 'he');
    });

  return respond(context, 200, filteredResults.slice(0, 8));
}
