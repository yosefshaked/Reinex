/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function normalizeSearch(value) {
  return normalizeString(value).toLowerCase();
}

function applySearchFilter(collection, search, fields) {
  if (!search) {
    return collection;
  }

  return collection.filter((item) =>
    fields.some((field) => String(item?.[field] || '').toLowerCase().includes(search)),
  );
}

export default async function systemAdminUsersOrgs(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-users-orgs: missing Supabase admin credentials');
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
  } catch (error) {
    return respond(context, error?.statusCode || 403, { message: error?.message || 'forbidden' });
  }

  const limit = normalizeLimit(req?.query?.limit);
  const search = normalizeSearch(req?.query?.q);

  try {
    const [organizationsResult, systemAdminsResult] = await Promise.all([
      supabase
        .from('organizations')
        .select('id, name, slug, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('profiles')
        .select('id, email, full_name, is_system_admin, updated_at')
        .eq('is_system_admin', true)
        .order('updated_at', { ascending: false })
        .limit(limit),
    ]);

    if (organizationsResult.error || systemAdminsResult.error) {
      throw organizationsResult.error || systemAdminsResult.error;
    }

    const organizations = Array.isArray(organizationsResult.data) ? organizationsResult.data : [];
    const organizationIds = organizations.map((org) => org.id).filter(Boolean);

    let membershipCountByOrg = {};
    if (organizationIds.length > 0) {
      const membershipsResult = await supabase
        .from('org_memberships')
        .select('org_id')
        .in('org_id', organizationIds)
        .limit(5000);

      if (membershipsResult.error) {
        throw membershipsResult.error;
      }

      membershipCountByOrg = (Array.isArray(membershipsResult.data) ? membershipsResult.data : []).reduce(
        (acc, row) => {
          const orgId = String(row.org_id || '');
          if (!orgId) {
            return acc;
          }
          acc[orgId] = (acc[orgId] || 0) + 1;
          return acc;
        },
        {},
      );
    }

    const organizationsWithCounts = organizations.map((org) => ({
      ...org,
      membership_count: membershipCountByOrg[org.id] || 0,
    }));

    const filteredOrganizations = applySearchFilter(organizationsWithCounts, search, ['name', 'slug', 'id']);
    const filteredSystemAdmins = applySearchFilter(
      Array.isArray(systemAdminsResult.data) ? systemAdminsResult.data : [],
      search,
      ['email', 'full_name', 'id'],
    );

    return respond(context, 200, {
      organizations: filteredOrganizations,
      system_admins: filteredSystemAdmins,
      query: {
        q: search,
        limit,
      },
      requested_at: new Date().toISOString(),
      admin: {
        user_id: admin.userId,
        email: admin.email,
      },
    });
  } catch (error) {
    context.log?.error?.('system-admin-users-orgs: failed to load data', {
      message: error?.message,
      code: error?.code,
      userId: admin.userId,
    });
    return respond(context, 500, { message: 'failed_to_load_user_org_data' });
  }
}
