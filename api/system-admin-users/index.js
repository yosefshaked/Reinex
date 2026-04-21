/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';
import { buildAccountDisplayName } from '../_shared/account-profile.js';

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;

function normalizePerPage(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PER_PAGE;
  return Math.min(Math.floor(parsed), MAX_PER_PAGE);
}

function normalizePage(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

/**
 * Fetch auth users matching a search string (by email/phone) using the admin
 * listUsers filter. Returns up to 5 pages of 200 to find all matches.
 */
async function searchAuthUsersByEmail(supabase, q) {
  const found = new Map();
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
      filter: q,
    });
    if (error) throw error;
    const users = Array.isArray(data?.users) ? data.users : [];
    if (users.length === 0) break;
    users.forEach((u) => { if (u?.id) found.set(u.id, u); });
    if (users.length < 200) break;
  }
  return Array.from(found.values());
}

/**
 * Fetch a page of ALL auth users (no filter).
 * Returns { users, total_count, has_more }.
 */
async function listAuthUsersPage(supabase, page, perPage) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page,
    perPage,
  });
  if (error) throw error;
  const users = Array.isArray(data?.users) ? data.users : [];
  const total = data?.total ?? null;
  return { users, total, has_more: users.length === perPage };
}

/**
 * Enrich a list of auth users with profiles data (full_name, is_system_admin)
 * and org membership count.
 */
async function enrichUsers(supabase, authUsers) {
  if (authUsers.length === 0) return [];

  const ids = authUsers.map((u) => u.id).filter(Boolean);

  const [profilesResult, membershipsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, first_name, last_name, is_system_admin')
      .in('id', ids),
    supabase
      .from('org_memberships')
      .select('user_id, org_id')
      .in('user_id', ids),
  ]);

  const profileById = {};
  (Array.isArray(profilesResult.data) ? profilesResult.data : []).forEach((p) => {
    profileById[p.id] = p;
  });

  const orgCountByUser = {};
  (Array.isArray(membershipsResult.data) ? membershipsResult.data : []).forEach((m) => {
    if (!m?.user_id) return;
    orgCountByUser[m.user_id] = (orgCountByUser[m.user_id] || 0) + 1;
  });

  return authUsers.map((u) => {
    const profile = profileById[u.id] || {};
    return {
      id: u.id,
      email: u.email || '',
      full_name: buildAccountDisplayName({
        profile,
        authUser: u,
        email: u.email,
      }) || null,
      is_system_admin: profile.is_system_admin || false,
      created_at: u.created_at || null,
      last_sign_in_at: u.last_sign_in_at || null,
      org_count: orgCountByUser[u.id] || 0,
    };
  });
}

export default async function systemAdminUsers(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-users: missing supabase admin credentials');
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

  const q = normalizeString(req?.query?.q).toLowerCase();
  const page = normalizePage(req?.query?.page);
  const perPage = normalizePerPage(req?.query?.per_page);

  try {
    let authUsers;
    let total = null;
    let hasMore = false;

    if (q) {
      // Search mode: filter by email via auth admin API, also by full_name via profiles
      const [emailMatches, profileMatches] = await Promise.all([
        searchAuthUsersByEmail(supabase, q).catch(() => []),
        supabase
          .from('profiles')
          .select('id')
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
          .limit(100),
      ]);

      const nameMatchIds = (Array.isArray(profileMatches.data) ? profileMatches.data : [])
        .map((p) => p.id)
        .filter(Boolean);

      // Merge the two sets, avoiding duplicates
      const seen = new Set(emailMatches.map((u) => u.id));
      let combined = [...emailMatches];

      if (nameMatchIds.length > 0) {
        // Fetch auth records for name matches not already in email results
        const missing = nameMatchIds.filter((id) => !seen.has(id));
        if (missing.length > 0) {
          // Fetch auth users by ID — we scan pages to find them (max 3 pages)
          const authById = new Map(emailMatches.map((u) => [u.id, u]));
          for (let p = 1; p <= 3 && authById.size < emailMatches.length + missing.length; p += 1) {
            const { data } = await supabase.auth.admin.listUsers({ page: p, perPage: 200 });
            const users = Array.isArray(data?.users) ? data.users : [];
            users.forEach((u) => {
              if (missing.includes(u.id) && !authById.has(u.id)) {
                authById.set(u.id, u);
              }
            });
            if (users.length < 200) break;
          }
          missing.forEach((id) => {
            if (authById.has(id)) combined.push(authById.get(id));
          });
        }
      }

      // Sort email-exact matches first
      combined.sort((a, b) => {
        const aExact = String(a.email || '').toLowerCase().startsWith(q) ? 0 : 1;
        const bExact = String(b.email || '').toLowerCase().startsWith(q) ? 0 : 1;
        return aExact - bExact;
      });

      authUsers = combined.slice(0, perPage);
      total = combined.length;
      hasMore = combined.length > perPage;
    } else {
      // Pagination mode
      const result = await listAuthUsersPage(supabase, page, perPage);
      authUsers = result.users;
      total = result.total;
      hasMore = result.has_more;
    }

    const users = await enrichUsers(supabase, authUsers);

    return respond(context, 200, {
      users,
      total,
      page,
      per_page: perPage,
      has_more: hasMore,
      query: { q: q || null, page, per_page: perPage },
      requested_at: new Date().toISOString(),
      admin: { user_id: admin.userId, email: admin.email },
    });
  } catch (error) {
    context.log?.error?.('system-admin-users: failed', {
      message: error?.message,
      code: error?.code,
      userId: admin?.userId,
    });
    return respond(context, 500, { message: 'failed_to_load_users' });
  }
}
