/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';

/**
 * GET /api/calendar/instructors
 * Query params:
 *   - org_id (required)
 *   - include_inactive (boolean, optional, defaults to false)
 *
 * Returns: Array of instructors (Employees) with service capabilities for calendar display
 */
export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('calendar/instructors missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('calendar/instructors missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('calendar/instructors failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const orgId = resolveOrgId(req, null);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('calendar/instructors failed to verify membership', {
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

  const query = req.query || {};
  const includeInactive = normalizeString(query.include_inactive).toLowerCase() === 'true';

  // Build query for instructors
  let instructorsQuery = tenantClient
    .from('Employees')
    .select('id, first_name, middle_name, last_name, email, metadata')
    .order('first_name', { ascending: true });

  if (!includeInactive) {
    instructorsQuery = instructorsQuery.eq('is_active', true);
  }

  // Non-admin users can only see their own instructor record
  if (!isAdmin) {
    instructorsQuery = instructorsQuery.eq('user_id', userId);
  }

  const { data: instructors, error: instructorsError } = await instructorsQuery;

  if (instructorsError) {
    context.log?.error?.('calendar/instructors failed to fetch instructors', { 
      message: instructorsError.message,
      code: instructorsError.code,
    });
    return respond(context, 500, { message: 'failed_to_load_instructors' });
  }

  if (!instructors || instructors.length === 0) {
    return respond(context, 200, []);
  }

  // Fetch service capabilities for all instructors
  const instructorIds = instructors.map(i => i.id);
  const { data: capabilities } = await tenantClient
    .from('instructor_service_capabilities')
    .select('employee_id, service_id, max_students, base_rate, metadata')
    .in('employee_id', instructorIds);

  // Build capabilities map
  const capabilitiesMap = new Map();
  (capabilities || []).forEach(cap => {
    if (!capabilitiesMap.has(cap.employee_id)) {
      capabilitiesMap.set(cap.employee_id, []);
    }
    capabilitiesMap.get(cap.employee_id).push({
      service_id: cap.service_id,
      max_students: cap.max_students,
      base_rate: cap.base_rate,
      metadata: cap.metadata,
    });
  });

  // Transform instructors with capabilities
  const transformedInstructors = instructors.map(instructor => ({
    id: instructor.id,
    first_name: instructor.first_name,
    middle_name: instructor.middle_name,
    last_name: instructor.last_name,
    full_name: [instructor.first_name, instructor.middle_name, instructor.last_name]
      .filter(Boolean)
      .join(' '),
    email: instructor.email,
    metadata: instructor.metadata,
    color: instructor.metadata?.color || null,
    service_capabilities: capabilitiesMap.get(instructor.id) || [],
  }));

  return respond(context, 200, transformedInstructors);
}
