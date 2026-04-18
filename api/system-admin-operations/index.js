/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, readEnv, respond } from '../_shared/org-bff.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function normalizeFilter(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export default async function systemAdminOperations(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-operations: missing Supabase admin credentials');
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
  const filterAction = normalizeFilter(req?.query?.action_type);
  const filterCategory = normalizeFilter(req?.query?.action_category);
  const filterRetention = normalizeFilter(req?.query?.retention_category);
  const filterOrgId = normalizeFilter(req?.query?.org_id);
  const filterBefore = normalizeFilter(req?.query?.before);
  const now = new Date();
  const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  let recentEventsQuery = supabase
    .from('audit_log')
    .select('id, org_id, user_email, action_type, action_category, resource_type, resource_id, retention_category, performed_at')
    .order('performed_at', { ascending: false })
    .limit(limit);

  if (filterAction) {
    recentEventsQuery = recentEventsQuery.eq('action_type', filterAction);
  }
  if (filterCategory) {
    recentEventsQuery = recentEventsQuery.eq('action_category', filterCategory);
  }
  if (filterRetention) {
    recentEventsQuery = recentEventsQuery.eq('retention_category', filterRetention);
  }
  if (filterOrgId) {
    recentEventsQuery = recentEventsQuery.eq('org_id', filterOrgId);
  }
  if (filterBefore) {
    recentEventsQuery = recentEventsQuery.lt('performed_at', filterBefore);
  }

  try {
    const [criticalCountResult, standardCountResult, recentEventsResult] = await Promise.all([
      supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('retention_category', 'critical')
        .gte('performed_at', last24hStart),
      supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('retention_category', 'standard')
        .gte('performed_at', last24hStart),
      recentEventsQuery,
    ]);

    if (criticalCountResult.error || standardCountResult.error || recentEventsResult.error) {
      throw criticalCountResult.error || standardCountResult.error || recentEventsResult.error;
    }

    const recentEvents = Array.isArray(recentEventsResult.data) ? recentEventsResult.data : [];

    const topActions = Object.entries(
      recentEvents.reduce((acc, event) => {
        const key = String(event.action_type || 'unknown');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([action, count]) => ({ action, count }));

    return respond(context, 200, {
      summary: {
        critical_events_24h: criticalCountResult.count || 0,
        standard_events_24h: standardCountResult.count || 0,
      },
      filters: {
        action_type: filterAction,
        action_category: filterCategory,
        retention_category: filterRetention,
        org_id: filterOrgId,
        before: filterBefore,
        limit,
      },
      recent_events: recentEvents,
      top_actions: topActions,
      requested_at: now.toISOString(),
      admin: {
        user_id: admin.userId,
        email: admin.email,
      },
    });
  } catch (error) {
    context.log?.error?.('system-admin-operations: failed to load operations data', {
      message: error?.message,
      code: error?.code,
      userId: admin.userId,
    });
    return respond(context, 500, { message: 'failed_to_load_operations' });
  }
}
