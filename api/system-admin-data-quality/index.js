/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, readEnv, respond } from '../_shared/org-bff.js';

export default async function systemAdminDataQuality(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('admin/data-quality: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let admin;
  try {
    admin = await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (err) {
    const status = err.statusCode || 403;
    return respond(context, status, { message: err.message || 'forbidden' });
  }

  // ── Run all queries in parallel ──────────────────────────────────────────
  const [
    orgsCountResult,
    profilesCountResult,
    membershipsCountResult,
    auditLogCountResult,
    impersonationSessionsCountResult,
    orgIdsResult,
    membershipOrgIdsResult,
    orgIdsForMemberCheckResult,
    membershipOrgIdsForMemberCheckResult,
    profileIdsResult,
    membershipUserIdsResult,
  ] = await Promise.allSettled([
    // Table counts (head: true → count only, no rows returned)
    supabase.from('organizations').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('org_memberships').select('*', { count: 'exact', head: true }),
    supabase.from('audit_log').select('*', { count: 'exact', head: true }),
    supabase.from('impersonation_sessions').select('*', { count: 'exact', head: true }),

    // Orphaned memberships — step 1: all org IDs (up to 1000)
    supabase.from('organizations').select('id').limit(1000),
    // Orphaned memberships — step 2: all org_id values in memberships (up to 1000)
    supabase.from('org_memberships').select('org_id').limit(1000),

    // Orgs without members — all org IDs (up to 500)
    supabase.from('organizations').select('id').limit(500),
    // Orgs without members — org_id values present in memberships (up to 500)
    supabase.from('org_memberships').select('org_id').limit(500),

    // Profiles without org — all profile IDs (up to 500)
    supabase.from('profiles').select('id').limit(500),
    // Profiles without org — user_id values present in memberships (up to 500)
    supabase.from('org_memberships').select('user_id').limit(500),
  ]);

  // ── Table counts ─────────────────────────────────────────────────────────
  function resolveCountResult(settled, tableName) {
    if (settled.status === 'rejected') {
      return { table: tableName, count: null, status: 'error' };
    }
    const { count, error } = settled.value;
    if (error) {
      return { table: tableName, count: null, status: 'error' };
    }
    return { table: tableName, count: count ?? 0, status: 'ok' };
  }

  const table_counts = [
    resolveCountResult(orgsCountResult, 'organizations'),
    resolveCountResult(profilesCountResult, 'profiles'),
    resolveCountResult(membershipsCountResult, 'org_memberships'),
    resolveCountResult(auditLogCountResult, 'audit_log'),
    resolveCountResult(impersonationSessionsCountResult, 'impersonation_sessions'),
  ];

  // ── Integrity checks ─────────────────────────────────────────────────────

  // 1. Orphaned memberships — memberships whose org_id has no matching org
  let orphanedMembershipsCount = null;
  let orphanedMembershipsStatus = 'ok';
  let orphanedMembershipsError;
  if (orgIdsResult.status === 'fulfilled' && membershipOrgIdsResult.status === 'fulfilled') {
    const orgIdsQueryError = orgIdsResult.value.error;
    const membershipOrgIdsQueryError = membershipOrgIdsResult.value.error;
    if (orgIdsQueryError || membershipOrgIdsQueryError) {
      orphanedMembershipsCount = null;
      orphanedMembershipsStatus = 'error';
      orphanedMembershipsError = 'query_failed';
    } else {
      const validOrgIds = new Set(
        (orgIdsResult.value.data || []).map((row) => row.id),
      );
      const membershipRows = membershipOrgIdsResult.value.data || [];
      const orphaned = membershipRows.filter((row) => !validOrgIds.has(row.org_id));
      orphanedMembershipsCount = orphaned.length;
      orphanedMembershipsStatus = orphanedMembershipsCount > 0 ? 'error' : 'ok';
    }
  } else {
    orphanedMembershipsCount = null;
    orphanedMembershipsStatus = 'error';
    orphanedMembershipsError = 'query_failed';
  }

  // 2. Orgs without members
  let orgsWithoutMembersCount = null;
  let orgsWithoutMembersStatus = 'ok';
  let orgsWithoutMembersError;
  if (
    orgIdsForMemberCheckResult.status === 'fulfilled' &&
    membershipOrgIdsForMemberCheckResult.status === 'fulfilled'
  ) {
    const orgsQueryError = orgIdsForMemberCheckResult.value.error;
    const membershipsQueryError = membershipOrgIdsForMemberCheckResult.value.error;
    if (orgsQueryError || membershipsQueryError) {
      orgsWithoutMembersCount = null;
      orgsWithoutMembersStatus = 'error';
      orgsWithoutMembersError = 'query_failed';
    } else {
      const orgIdsWithMembers = new Set(
        (membershipOrgIdsForMemberCheckResult.value.data || []).map((row) => row.org_id),
      );
      const allOrgs = orgIdsForMemberCheckResult.value.data || [];
      const withoutMembers = allOrgs.filter((row) => !orgIdsWithMembers.has(row.id));
      orgsWithoutMembersCount = withoutMembers.length;
      orgsWithoutMembersStatus = orgsWithoutMembersCount > 0 ? 'warning' : 'ok';
    }
  } else {
    orgsWithoutMembersCount = null;
    orgsWithoutMembersStatus = 'error';
    orgsWithoutMembersError = 'query_failed';
  }

  // 3. Profiles without org
  let profilesWithoutOrgCount = null;
  let profilesWithoutOrgStatus = 'ok';
  let profilesWithoutOrgError;
  if (profileIdsResult.status === 'fulfilled' && membershipUserIdsResult.status === 'fulfilled') {
    const profilesQueryError = profileIdsResult.value.error;
    const membershipUsersQueryError = membershipUserIdsResult.value.error;
    if (profilesQueryError || membershipUsersQueryError) {
      profilesWithoutOrgCount = null;
      profilesWithoutOrgStatus = 'error';
      profilesWithoutOrgError = 'query_failed';
    } else {
      const userIdsWithOrg = new Set(
        (membershipUserIdsResult.value.data || []).map((row) => row.user_id),
      );
      const allProfiles = profileIdsResult.value.data || [];
      const withoutOrg = allProfiles.filter((row) => !userIdsWithOrg.has(row.id));
      profilesWithoutOrgCount = withoutOrg.length;
      profilesWithoutOrgStatus = profilesWithoutOrgCount > 0 ? 'warning' : 'ok';
    }
  } else {
    profilesWithoutOrgCount = null;
    profilesWithoutOrgStatus = 'error';
    profilesWithoutOrgError = 'query_failed';
  }

  const checks = [
    {
      name: 'orphaned_memberships',
      display_name: 'Orphaned memberships',
      count: orphanedMembershipsCount,
      status: orphanedMembershipsStatus,
      description: 'Membership rows pointing to a deleted org',
      ...(orphanedMembershipsError ? { error: orphanedMembershipsError } : {}),
    },
    {
      name: 'orgs_without_members',
      display_name: 'Orgs without members',
      count: orgsWithoutMembersCount,
      status: orgsWithoutMembersStatus,
      description: 'Organizations with no team members',
      ...(orgsWithoutMembersError ? { error: orgsWithoutMembersError } : {}),
    },
    {
      name: 'profiles_without_org',
      display_name: 'Profiles without org',
      count: profilesWithoutOrgCount,
      status: profilesWithoutOrgStatus,
      description: 'User profiles not belonging to any organization',
      ...(profilesWithoutOrgError ? { error: profilesWithoutOrgError } : {}),
    },
  ];

  return respond(context, 200, {
    table_counts,
    checks,
    checked_at: new Date().toISOString(),
    admin: {
      user_id: admin.userId,
      email: admin.email,
    },
  });
}
