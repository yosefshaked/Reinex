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
import { parseJsonBodyWithLimit, validateInstructorCreate, validateInstructorUpdate } from '../_shared/validation.js';
import { ensureInstructorColors } from '../_shared/instructor-colors.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

      // Intentionally ignore profile fetch errors; fallback to provided values.
export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('instructors missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('instructors missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('instructors failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, 96 * 1024, { mode: 'observe', context, endpoint: 'instructors' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('instructors failed to verify membership', {
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

  if (method === 'GET') {
    const colorResult = await ensureInstructorColors(tenantClient, {
      context,
      table: 'Employees',
      columns: 'id, name, metadata',
    });
    if (colorResult?.error) {
      context.log?.error?.('instructors failed to ensure color assignments', { message: colorResult.error.message });
    }

    const includeInactive = normalizeString(req?.query?.include_inactive).toLowerCase() === 'true';

    let builder = tenantClient
      .from('Employees')
      .select('id, first_name, middle_name, last_name, email, phone, is_active, notes, metadata, instructor_types')
      .order('first_name', { ascending: true });

    // Keep the /instructors contract scoped to instructor employees.
    // We treat NULL as instructor as well to ease incremental migrations.
    builder = builder.or('employee_type.is.null,employee_type.eq.instructor');

    if (!includeInactive) {
      builder = builder.eq('is_active', true);
    }

    // Non-admin users can only fetch their own instructor record
    if (!isAdmin) {
      builder = builder.eq('id', userId);
    }

    const { data, error } = await builder;

    if (error) {
      context.log?.error?.('instructors failed to fetch roster', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_instructors' });
    }

    return respond(context, 200, Array.isArray(data) ? data : []);
  }

  if (method === 'POST') {
    // Only admins can create instructors
    if (!isAdmin) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const validation = validateInstructorCreate(body);
    if (validation.error) {
      return respond(context, 400, { message: validation.error });
    }

    const targetUserId = validation.userId;

    // Verify target user is a member of the org in control DB
    const { data: membership, error: membershipError } = await supabase
      .from('org_memberships')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (membershipError) {
      context.log?.error?.('instructors failed to verify target membership', { message: membershipError.message });
      return respond(context, 500, { message: 'failed_to_verify_target_membership' });
    }

    if (!membership) {
      return respond(context, 400, { message: 'user_not_in_organization' });
    }

    // Fetch profile defaults if name/email not provided
    const providedFirstName = validation.firstName;
    const providedMiddleName = validation.middleName;
    const providedLastName = validation.lastName;
    const providedEmail = validation.email;
    const providedPhone = validation.phone;
    const notes = validation.notes;

    let profileName = '';
    let profileEmail = '';
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .eq('id', targetUserId)
        .maybeSingle();
      profileName = normalizeString(profile?.full_name);
      profileEmail = normalizeString(profile?.email).toLowerCase();
    } catch {
      // Intentionally ignore profile fetch errors; fallback to provided values.
    }

    // Split profile name if we need fallback for first/last
    const nameParts = profileName ? profileName.split(' ') : [];
    const fallbackFirst = nameParts[0] || providedEmail || profileEmail || 'משתמש';
    const fallbackLast = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

    const insertPayload = {
      id: targetUserId,
      first_name: providedFirstName || fallbackFirst,
      middle_name: providedMiddleName || (nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : null),
      last_name: providedLastName || fallbackLast || targetUserId,
      email: providedEmail || profileEmail || null,
      phone: providedPhone || null,
      notes: notes || null,
      is_active: true,
      employee_type: 'instructor',
    };

    const { data, error } = await tenantClient
      .from('Employees')
      .upsert(insertPayload, { onConflict: 'id' })
      .select('id, first_name, middle_name, last_name, email, phone, is_active, notes, metadata, instructor_types')
      .single();

    if (error) {
      context.log?.error?.('instructors failed to upsert instructor', { message: error.message });
      return respond(context, 500, { message: 'failed_to_save_instructor' });
    }

    // Audit log: instructor created
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.INSTRUCTOR_CREATED,
      actionCategory: AUDIT_CATEGORIES.INSTRUCTORS,
      resourceType: 'instructor',
      resourceId: data.id,
      details: {
        instructor_name: `${data.first_name} ${data.last_name}`.trim(),
        instructor_email: data.email,
      },
    });

    return respond(context, 200, data);
  }

  if (method === 'PUT') {
    // Fetch org permissions for preanswers cap enforcement
    const { data: orgSettings, error: permError } = await supabase
      .from('org_settings')
      .select('permissions')
      .eq('org_id', orgId)
      .maybeSingle();

    if (permError) {
      context.log?.error?.('instructors failed to load permissions', { message: permError.message });
      return respond(context, 500, { message: 'failed_to_load_permissions' });
    }

    let permissions = orgSettings?.permissions;
    if (typeof permissions === 'string') {
      try {
        permissions = JSON.parse(permissions);
      } catch (parseError) {
        context.log?.warn?.('instructors permissions JSON parse failed', { message: parseError?.message });
        permissions = {};
      }
    }

    if (!permissions || typeof permissions !== 'object') {
      permissions = {};
    }

    const validation = validateInstructorUpdate(body, permissions);
    if (validation.error) {
      return respond(context, 400, { message: validation.error });
    }

    const instructorId = validation.instructorId;
    const updates = validation.updates;

    const isSelf = instructorId === userId;
    if (!isAdmin) {
      const allowedKeys = ['__metadata_custom_preanswers'];
      const disallowed = Object.keys(updates).filter((key) => !allowedKeys.includes(key));
      if (disallowed.length || !isSelf) {
        return respond(context, 403, { message: 'forbidden' });
      }
    }

    if (Object.keys(updates).length === 0) {
      return respond(context, 400, { message: 'no updates provided' });
    }

    // Fetch existing instructor to compare changes
    const { data: existingInstructor, error: fetchError } = await tenantClient
      .from('Employees')
      .select('*')
      .eq('id', instructorId)
      .maybeSingle();

    if (fetchError) {
      context.log?.error?.('instructors failed to fetch existing instructor', { message: fetchError.message, instructorId });
      return respond(context, 500, { message: 'failed_to_fetch_instructor' });
    }

    if (!existingInstructor) {
      return respond(context, 404, { message: 'instructor_not_found' });
    }

    const metadataPatch = updates.__metadata_custom_preanswers;
    if (metadataPatch) {
      delete updates.__metadata_custom_preanswers;
      const existingMeta = existingInstructor.metadata && typeof existingInstructor.metadata === 'object'
        ? existingInstructor.metadata
        : {};
      const nextMeta = { ...existingMeta, custom_preanswers: metadataPatch };
      updates.metadata = nextMeta;
    }

    // Determine which fields actually changed
    const changedFields = [];
    for (const [key, newValue] of Object.entries(updates)) {
      const oldValue = existingInstructor[key];
      const normalizedOld = oldValue === null || oldValue === undefined ? null : oldValue;
      const normalizedNew = newValue === null || newValue === undefined ? null : newValue;
      if (JSON.stringify(normalizedOld) !== JSON.stringify(normalizedNew)) {
        changedFields.push(key);
      }
    }

    const { data, error } = await tenantClient
      .from('Employees')
      .update(updates)
      .eq('id', instructorId)
      .select('id, first_name, middle_name, last_name, email, phone, is_active, notes, metadata, instructor_types')
      .maybeSingle();

    if (error) {
      context.log?.error?.('instructors failed to update instructor', { message: error.message, instructorId });
      return respond(context, 500, { message: 'failed_to_update_instructor' });
    }

    if (!data) {
      return respond(context, 404, { message: 'instructor_not_found' });
    }

    // Audit log: instructor updated
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.INSTRUCTOR_UPDATED,
      actionCategory: AUDIT_CATEGORIES.INSTRUCTORS,
      resourceType: 'instructor',
      resourceId: instructorId,
      details: {
        updated_fields: changedFields,
        instructor_name: `${data.first_name} ${data.last_name}`.trim(),
      },
    });

    return respond(context, 200, data);
  }

  if (method === 'DELETE') {
    // Only admins can delete instructors
    if (!isAdmin) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const instructorId = normalizeString(body?.id || body?.instructor_id || body?.instructorId || '');
    if (!instructorId) {
      return respond(context, 400, { message: 'missing instructor id' });
    }

    const { data, error } = await tenantClient
      .from('Employees')
      .update({ is_active: false })
      .eq('id', instructorId)
      .select('id, name, email, phone, is_active, notes, metadata, instructor_types')
      .maybeSingle();

    if (error) {
      context.log?.error?.('instructors failed to disable instructor', { message: error.message, instructorId });
      return respond(context, 500, { message: 'failed_to_disable_instructor' });
    }

    if (!data) {
      return respond(context, 404, { message: 'instructor_not_found' });
    }

    return respond(context, 200, data);
  }

  return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PUT,DELETE' });
}
