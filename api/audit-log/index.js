/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
} from '../_shared/org-bff.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const SENSITIVE_KEY_PATTERN = /(secret|token|password|authorization|api[_-]?key|service[_-]?role|dedicated[_-]?key|anon[_-]?key|encryption)/i;

function normalizeLimit(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(num), MAX_LIMIT);
}

function normalizeIsoTimestamp(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return '';
  }

  return new Date(parsed).toISOString();
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizeValue(entryValue);
      }
    }
    return result;
  }

  return value;
}

export default async function auditLog(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('audit-log missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('audit-log failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('audit-log failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const limit = normalizeLimit(req?.query?.limit || body?.limit);
  const before = normalizeIsoTimestamp(req?.query?.before || body?.before);
  const actionCategory = normalizeString(req?.query?.action_category || body?.action_category).toLowerCase();
  const resourceId = normalizeString(req?.query?.resource_id || req?.query?.student_id || body?.resource_id || body?.student_id);

  if ((req?.query?.before || body?.before) && !before) {
    return respond(context, 400, { message: 'invalid_before_cursor' });
  }

  let query = supabase
    .from('audit_log')
    .select('id, actor_email, actor_role, event_type, action_category, resource_type, resource_id, details, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (before) {
    query = query.lt('created_at', before);
  }

  if (actionCategory) {
    query = query.eq('action_category', actionCategory);
  }

  if (resourceId) {
    query = query.eq('resource_id', resourceId);
  }

  const { data, error } = await query;

  if (error) {
    context.log?.error?.('audit-log failed to load logs', {
      message: error.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_load_audit_logs' });
  }

  const rows = Array.isArray(data) ? data : [];
  const hasMore = rows.length > limit;
  const logs = (hasMore ? rows.slice(0, limit) : rows).map((entry) => ({
    id: entry.id,
    user_email: entry.actor_email || null,
    user_role: entry.actor_role || null,
    action_type: entry.event_type || null,
    action_category: entry.action_category || null,
    resource_type: entry.resource_type || null,
    resource_id: entry.resource_id || null,
    details: sanitizeValue(entry.details),
    performed_at: entry.created_at || null,
  }));
  const nextCursor = hasMore ? logs[logs.length - 1]?.performed_at || null : null;

  return respond(context, 200, {
    logs,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  });
}
