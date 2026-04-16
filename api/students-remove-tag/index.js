import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
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

  const { data: clientProfiles, error: fetchError } = await withOrgScope(supabase, 'client_profiles', orgId)
    .select('id, tags')
    .contains('tags', [tagId]);

  if (fetchError) {
    context.log?.error?.('students-remove-tag: failed to fetch client profiles', { message: fetchError.message });
    return respond(context, 500, { message: 'failed_to_fetch_students' });
  }
  if (!clientProfiles || clientProfiles.length === 0) {
    return respond(context, 200, { message: 'tag_removed_no_students', tag_id: tagId, students_updated: 0 });
  }

  let updated = 0;
  const failures = [];
  for (const profile of clientProfiles) {
    const updatedTags = (profile.tags || []).filter((id) => id !== tagId);
    const { error } = await withOrgScope(supabase, 'client_profiles', orgId)
      .update({ tags: updatedTags })
      .eq('id', profile.id);
    if (error) {
      failures.push({ client_profile_id: profile.id, message: error.message });
    } else {
      updated++;
    }
  }

  if (updated === 0 && failures.length > 0) {
    return respond(context, 500, { message: 'failed_to_update_students', failures });
  }

  return respond(context, 200, { message: 'tag_removed_profiles', tag_id: tagId, students_updated: updated, failures });
}
