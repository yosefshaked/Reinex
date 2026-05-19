/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ALLOWED_SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);

function isTableMissingError(error) {
  if (!error) return false;
  const msg = String(error.message || error.details || '').toLowerCase();
  return String(error.code || '') === '42P01' || (msg.includes('relation') && msg.includes('error_events'));
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, parsed), MAX_LIMIT);
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(value ?? '0', 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function normalizeStatus(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 400 || parsed > 599) return null;
  return parsed;
}

function normalizeIsoOrNull(value) {
  const text = normalizeString(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function handleGet(context, req, supabase) {
  const limit = normalizeLimit(req?.query?.limit);
  const offset = normalizeOffset(req?.query?.offset);
  const q = normalizeString(req?.query?.q);
  const supportCode = normalizeString(req?.query?.support_code);
  const route = normalizeString(req?.query?.route);
  const orgId = normalizeString(req?.query?.org_id);
  const actorUserId = normalizeString(req?.query?.actor_user_id);
  const severity = normalizeString(req?.query?.severity);
  const status = normalizeStatus(req?.query?.status);
  const since = normalizeIsoOrNull(req?.query?.since);
  const until = normalizeIsoOrNull(req?.query?.until);

  let query = supabase
    .from('error_events')
    .select(
      'id, support_code, status, public_message, route, method, org_id, actor_user_id, severity, request_context, internal_error, metadata, created_at, expires_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (supportCode) query = query.eq('support_code', supportCode);
  if (route) query = query.ilike('route', `%${route.replace(/[%_]/g, (m) => `\\${m}`)}%`);
  if (orgId) query = query.eq('org_id', orgId);
  if (actorUserId) query = query.eq('actor_user_id', actorUserId);
  if (ALLOWED_SEVERITIES.has(severity)) query = query.eq('severity', severity);
  if (status) query = query.eq('status', status);
  if (since) query = query.gte('created_at', since);
  if (until) query = query.lt('created_at', until);
  if (q) {
    const escaped = q.replace(/[%_,]/g, (m) => `\\${m}`);
    query = query.or(
      `support_code.ilike.%${escaped}%,public_message.ilike.%${escaped}%,route.ilike.%${escaped}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) {
    if (isTableMissingError(error)) {
      return respond(context, 501, {
        message: 'table_not_found',
        hint: 'Re-run setup-sql.js to create the error_events table.',
      });
    }
    context.log?.error?.('system-admin-error-events query failed', { message: error.message });
    return respond(context, 500, { message: 'query_failed' });
  }

  return respond(context, 200, {
    errors: Array.isArray(data) ? data : [],
    total: count ?? 0,
    limit,
    offset,
    requested_at: new Date().toISOString(),
  });
}

export default async function systemAdminErrorEvents(context, req) {
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

  try {
    return await handleGet(context, req, supabase);
  } catch (error) {
    context.log?.error?.('system-admin-error-events unexpected error', { message: error?.message });
    return respond(context, 500, { message: 'internal_error' });
  }
}
