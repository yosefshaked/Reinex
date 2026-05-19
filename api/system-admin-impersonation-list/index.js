/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import {
  createSupabaseAdminClient,
  readSupabaseAdminConfig,
} from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';

/**
 * GET /api/system-admin-impersonation-list
 *
 * Query params:
 *   status: 'active' | 'ended' | 'all' (default 'all')
 *   limit: number (1..200, default 50)
 *   admin_user_id: optional uuid filter
 *   target_email: optional case-insensitive contains filter
 *
 * Response: { sessions: [...], active_count, requested_at }
 */

function parseLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(Math.max(Math.round(n), 1), 200);
}

export default async function adminImpersonationList(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  try {
    await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (error) {
    return respond(context, error?.statusCode || 403, { message: error?.message || 'forbidden' });
  }

  const query = req?.query || {};
  const status = normalizeString(query.status).toLowerCase() || 'all';
  const limit = parseLimit(query.limit);
  const adminFilter = normalizeString(query.admin_user_id);
  const targetFilter = normalizeString(query.target_email).toLowerCase();

  let q = supabase
    .from('impersonation_sessions')
    .select(`
      id, admin_user_id, admin_email, target_user_id, target_email,
      target_org_id, target_org_name, reason, status, started_at,
      ended_at, expires_at, ended_reason
    `)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (status === 'active') q = q.eq('status', 'active');
  if (status === 'ended') q = q.in('status', ['ended', 'expired', 'revoked']);
  if (adminFilter) q = q.eq('admin_user_id', adminFilter);
  if (targetFilter) q = q.ilike('target_email', `%${targetFilter}%`);

  let sessions = [];
  try {
    const { data, error } = await q;
    if (error) {
      if (String(error.code) === '42P01') {
        return respond(context, 501, {
          message: 'impersonation_table_missing',
          hint: 'Run the SSOT setup script at src/lib/setup-sql.js against your database',
        });
      }
      throw error;
    }
    sessions = Array.isArray(data) ? data : [];
  } catch (error) {
    context.log?.error?.('system-admin-impersonation-list: query failed', { message: error?.message });
    return respond(context, 500, { message: 'list_failed' });
  }

  const activeCount = sessions.filter((s) => s.status === 'active').length;

  return respond(context, 200, {
    sessions,
    active_count: activeCount,
    requested_at: new Date().toISOString(),
  });
}
