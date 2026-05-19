/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, readEnv, respond } from '../_shared/org-bff.js';

async function readCount(supabase, tableName, options = {}) {
  let query = supabase.from(tableName).select('id', { count: 'exact', head: true });

  if (typeof options.eqColumn === 'string' && options.eqValue !== undefined) {
    query = query.eq(options.eqColumn, options.eqValue);
  }

  if (typeof options.gteColumn === 'string' && typeof options.gteValue === 'string') {
    query = query.gte(options.gteColumn, options.gteValue);
  }

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  return typeof count === 'number' ? count : 0;
}

export default async function systemAdminOverview(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-overview: missing Supabase admin credentials');
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

  const now = new Date();
  const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const [organizationsCount, membershipsCount, systemAdminsCount, criticalAuditIn24h] = await Promise.all([
      readCount(supabase, 'organizations'),
      readCount(supabase, 'org_memberships'),
      readCount(supabase, 'profiles', { eqColumn: 'is_system_admin', eqValue: true }),
      readCount(supabase, 'audit_log', {
        eqColumn: 'retention_category',
        eqValue: 'critical',
        gteColumn: 'performed_at',
        gteValue: last24hStart,
      }),
    ]);

    return respond(context, 200, {
      platform: {
        organizations: organizationsCount,
        memberships: membershipsCount,
        system_admins: systemAdminsCount,
        critical_audit_events_24h: criticalAuditIn24h,
      },
      requested_at: now.toISOString(),
      admin: {
        user_id: admin.userId,
        email: admin.email,
      },
    });
  } catch (error) {
    context.log?.error?.('system-admin-overview: failed to assemble summary', {
      message: error?.message,
      code: error?.code,
      userId: admin.userId,
    });
    return respond(context, 500, { message: 'failed_to_load_overview' });
  }
}
