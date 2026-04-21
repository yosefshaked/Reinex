/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, isValidOrgId, readEnv, respond } from '../_shared/org-bff.js';

export default async function handler(req, context) {
  const authorization = resolveBearerAuthorization(req);
  const adminConfig = readSupabaseAdminConfig(readEnv);
  const supabase = createSupabaseAdminClient(adminConfig);

  const orgId = normalizeString(req.query?.org_id);

  if (!isValidOrgId(orgId)) {
    return respond(400, { error: 'org_id_required' });
  }

  try {
    await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (err) {
    context.log?.error('[system-admin-org-detail] ensureSystemAdmin failed', err);
    return err;
  }

  // Step 3: Parallel fetch — org, members, recent audit
  let orgRow, memberRows, auditRows;
  try {
    const [orgResult, membersResult, auditResult] = await Promise.all([
      supabase
        .from('organizations')
        .select('id, name, slug, created_at, updated_at')
        .eq('id', orgId)
        .maybeSingle(),
      supabase
        .from('org_memberships')
        .select('user_id, role, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('audit_log')
        .select('id, event_type, action_category, actor_email, actor_role, resource_type, resource_id, created_at, details')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    if (orgResult.error) throw orgResult.error;
    if (membersResult.error) throw membersResult.error;
    if (auditResult.error) throw auditResult.error;

    orgRow = orgResult.data;
    memberRows = membersResult.data ?? [];
    auditRows = auditResult.data ?? [];
  } catch (err) {
    context.log?.error('[system-admin-org-detail] parallel fetch failed', err);
    return respond(500, { error: 'fetch_failed', message: err.message });
  }

  // Step 4: Org not found
  if (!orgRow) {
    return respond(404, { error: 'org_not_found' });
  }

  // Step 5: Enrich members with email and full_name
  let members = [];
  if (memberRows.length > 0) {
    const userIds = memberRows.map((m) => m.user_id);

    // Build emailById map by scanning up to 5 pages of 200 auth users
    const emailById = {};
    try {
      for (let page = 1; page <= 5; page++) {
        const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (listError) throw listError;
        const users = listData?.users ?? [];
        for (const u of users) {
          emailById[u.id] = u.email ?? null;
        }
        if (users.length < 200) break;
      }
    } catch (err) {
      context.log?.error('[system-admin-org-detail] listUsers failed', err);
      return respond(500, { error: 'list_users_failed', message: err.message });
    }

    // Fetch profiles for full_name
    let profilesById = {};
    try {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      if (profilesError) throw profilesError;
      for (const p of profiles ?? []) {
        profilesById[p.id] = p.full_name ?? null;
      }
    } catch (err) {
      context.log?.error('[system-admin-org-detail] profiles fetch failed', err);
      return respond(500, { error: 'profiles_fetch_failed', message: err.message });
    }

    members = memberRows.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      joined_at: m.created_at,
      full_name: profilesById[m.user_id] ?? null,
      email: emailById[m.user_id] ?? null,
    }));
  }

  return respond(200, {
    org: orgRow,
    members,
    recent_audit: auditRows,
    requested_at: new Date().toISOString(),
  });
}
