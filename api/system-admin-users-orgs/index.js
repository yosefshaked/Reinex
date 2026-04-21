/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';
import { buildAccountDisplayName } from '../_shared/account-profile.js';

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

async function fetchAuthEmailsByUserId(supabase, userIds) {
  const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean)));
  if (ids.length === 0) {
    return {};
  }

  const emailByUserId = {};
  const pageSize = 200;
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: pageSize });
    if (error) {
      throw error;
    }

    const users = Array.isArray(data?.users) ? data.users : [];
    if (users.length === 0) {
      break;
    }

    users.forEach((user) => {
      const userId = String(user?.id || '');
      if (!userId || !ids.includes(userId)) {
        return;
      }
      emailByUserId[userId] = String(user?.email || '').trim();
    });

    if (ids.every((id) => Object.prototype.hasOwnProperty.call(emailByUserId, id))) {
      break;
    }
  }

  return emailByUserId;
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
        .select('id, first_name, last_name, is_system_admin, updated_at, metadata')
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
    const systemAdminProfiles = Array.isArray(systemAdminsResult.data) ? systemAdminsResult.data : [];
    const authEmailByUserId = await fetchAuthEmailsByUserId(
      supabase,
      systemAdminProfiles.map((row) => row.id),
    );
    const systemAdminsWithEmail = systemAdminProfiles.map((row) => {
      const email =
        authEmailByUserId[row.id] ||
        normalizeString(row?.metadata?.email) ||
        normalizeString(row?.metadata?.user_email) ||
        '';
      return {
        ...row,
        email,
        full_name: buildAccountDisplayName({
          profile: row,
          email,
        }) || null,
      };
    });
    const filteredSystemAdmins = applySearchFilter(
      systemAdminsWithEmail,
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
