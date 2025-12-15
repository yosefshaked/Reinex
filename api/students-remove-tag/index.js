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

export default async function (context, req) {
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }
  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch {
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (String(req.method || 'POST').toUpperCase() !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'POST' });
  }

  const body = parseJsonBodyWithLimit(req, 16 * 1024, { mode: 'observe', context, endpoint: 'students-remove-tag' });
  const orgId = resolveOrgId(req, body);
  const tagId = (body?.tag_id || body?.tagId || '').trim();

  if (!orgId || !tagId) {
    return respond(context, 400, { message: 'missing_org_or_tag' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, authResult.data.user.id);
  } catch {
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // Try RPC first (SECURITY DEFINER expected)
  const { error: rpcError } = await tenantClient.rpc('remove_tag_from_students', { tag_to_remove: tagId });
  if (!rpcError) {
    return respond(context, 200, { message: 'tag_removed_via_rpc', tag_id: tagId });
  }

  context.log?.warn?.('students-remove-tag: RPC failed, falling back', { message: rpcError.message });

  // Fallback: manually update affected students using service key
  const { data: students, error: fetchError } = await tenantClient
    .from('Students')
    .select('id, tags')
    .contains('tags', [tagId]);

  if (fetchError) {
    context.log?.error?.('students-remove-tag: failed to fetch students', { message: fetchError.message });
    return respond(context, 500, { message: 'failed_to_fetch_students' });
  }
  if (!students || students.length === 0) {
    return respond(context, 200, { message: 'tag_removed_no_students', tag_id: tagId, students_updated: 0 });
  }

  let updated = 0;
  const failures = [];
  for (const student of students) {
    const updatedTags = (student.tags || []).filter((id) => id !== tagId);
    const { error } = await tenantClient.from('Students').update({ tags: updatedTags }).eq('id', student.id);
    if (error) {
      failures.push({ student_id: student.id, message: error.message });
    } else {
      updated++;
    }
  }

  if (updated === 0 && failures.length > 0) {
    return respond(context, 500, { message: 'failed_to_update_students', failures });
  }

  return respond(context, 200, { message: 'tag_removed_fallback', tag_id: tagId, students_updated: updated, failures });
}
