/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import {
  createSupabaseAdminClient,
  readSupabaseAdminConfig,
} from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';

/**
 * GET /api/system-admin-audit-log
 *
 * Query params (all optional):
 *   - q              full-text-ish filter against event_type/resource_type/actor_email
 *   - event_type     exact match on event_type
 *   - category       exact match on action_category
 *   - actor_user_id  filter by actor
 *   - org_id         filter by org
 *   - resource_type  filter by resource_type
 *   - since          ISO timestamp; created_at >= since
 *   - until          ISO timestamp; created_at < until
 *   - limit          default 100, max 500
 *   - offset         default 0
 *
 * Returns full audit rows (system admin sees everything, including null-org
 * control-plane events). Use the Drawer in the UI to inspect details/metadata.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function normalizeOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeIsoOrNull(value) {
  const text = normalizeString(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export default async function systemAdminAuditLog(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-audit-log: missing Supabase admin credentials');
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

  const q = normalizeString(req?.query?.q);
  const excludePrefix = normalizeString(req?.query?.exclude_prefix);
  const eventType = normalizeString(req?.query?.event_type);
  const category = normalizeString(req?.query?.category);
  const actorUserId = normalizeString(req?.query?.actor_user_id);
  const orgId = normalizeString(req?.query?.org_id);
  const resourceType = normalizeString(req?.query?.resource_type);
  const since = normalizeIsoOrNull(req?.query?.since);
  const until = normalizeIsoOrNull(req?.query?.until);
  const limit = normalizeLimit(req?.query?.limit);
  const offset = normalizeOffset(req?.query?.offset);

  try {
    let query = supabase
      .from('audit_log')
      .select(
        'id, org_id, actor_user_id, actor_email, actor_role, event_type, action_category, retention_category, resource_type, resource_id, details, metadata, created_at, correlation_id',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (excludePrefix) query = query.not('event_type', 'ilike', `${excludePrefix}%`);
    if (eventType) query = query.eq('event_type', eventType);
    if (category) query = query.eq('action_category', category);
    if (actorUserId) query = query.eq('actor_user_id', actorUserId);
    if (orgId) query = query.eq('org_id', orgId);
    if (resourceType) query = query.eq('resource_type', resourceType);
    if (since) query = query.gte('created_at', since);
    if (until) query = query.lt('created_at', until);
    if (q) {
      const escaped = q.replace(/[%_,]/g, (m) => `\\${m}`);
      query = query.or(
        `event_type.ilike.%${escaped}%,resource_type.ilike.%${escaped}%,actor_email.ilike.%${escaped}%,resource_id.ilike.%${escaped}%`,
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return respond(context, 200, {
      rows: Array.isArray(data) ? data : [],
      total: typeof count === 'number' ? count : null,
      limit,
      offset,
      filters: {
        q,
        event_type: eventType || null,
        category: category || null,
        actor_user_id: actorUserId || null,
        org_id: orgId || null,
        resource_type: resourceType || null,
        since,
        until,
      },
      requested_at: new Date().toISOString(),
      admin: { user_id: admin.userId, email: admin.email },
    });
  } catch (error) {
    context.log?.error?.('system-admin-audit-log: query failed', {
      message: error?.message,
      code: error?.code,
      userId: admin.userId,
    });
    return respond(context, 500, { message: 'failed_to_query_audit_log' });
  }
}
